"use client";

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  useSyncExternalStore,
  type ReactNode,
} from "react";
import { useAuth } from "@clerk/nextjs";
import { useConvexAuth, useMutation, useQuery } from "convex/react";
import { api } from "@/convex/_generated/api";
import { type Id } from "@/convex/_generated/dataModel";
import { useTtsProfile } from "@/lib/tts-audience";
import type { TtsProvider } from "@/lib/tts-profile";
import {
  ArticleAudioExportTray,
  type TrayJob,
} from "@/components/ArticleAudioExportTray";
import { getTtsMetadata } from "@/lib/tts-profile";

const CLIENT_ID_STORAGE_KEY = "cg-article-audio-export-client-id";

type ArticleAudioExportJob = {
  _id: string;
  articleId: string;
  title: string;
  status: "queued" | "running" | "ready" | "failed";
  stage?: "queued" | "rendering_audio" | "packaging";
  sectionCount: number;
  completedSectionCount: number;
  narrationHash?: string;
  ttsCacheKey?: string;
  ttsProvider?: TtsProvider;
  lastError?: string;
  audioUrl?: string | null;
  createdAt: number;
  updatedAt: number;
};

type StartingJob = {
  articleId: string;
  title: string;
  ttsProvider: TtsProvider;
  startedAt: number;
};

type DirectDownloadToast = {
  _id: string;
  title: string;
  href: string;
  createdAt: number;
  updatedAt: number;
};

type ArticleAudioExportContextValue = {
  jobs: ArticleAudioExportJob[];
  queueExport: (args: {
    articleId: string;
    title: string;
  }) => Promise<{ exportId: string; status: ArticleAudioExportJob["status"] }>;
  dismissExport: (exportId: string) => Promise<void>;
  isStartingArticle: (articleId: string, ttsProvider: TtsProvider) => boolean;
  registerDirectDownload: (args: { title: string; href: string }) => void;
};

const ArticleAudioExportContext =
  createContext<ArticleAudioExportContextValue | null>(null);

const emptySubscribe = () => () => {};

let fallbackClientId: string | null = null;

const createClientId = (): string => {
  if (
    typeof window !== "undefined" &&
    typeof window.crypto?.randomUUID === "function"
  ) {
    return window.crypto.randomUUID();
  }

  return `client-${Date.now()}-${Math.random().toString(36).slice(2)}`;
};

const readClientIdSnapshot = (): string | null => {
  if (typeof window === "undefined") return null;

  try {
    return (
      window.localStorage.getItem(CLIENT_ID_STORAGE_KEY) ?? fallbackClientId
    );
  } catch {
    return fallbackClientId;
  }
};

const ensureClientId = (): string => {
  const existing = readClientIdSnapshot();
  if (existing) return existing;

  const created = createClientId();
  fallbackClientId = created;
  try {
    window.localStorage.setItem(CLIENT_ID_STORAGE_KEY, created);
  } catch {
    // Restricted storage contexts can still use the in-memory ID for this tab.
  }
  return created;
};

export const ArticleAudioExportProvider = ({
  children,
}: {
  children: ReactNode;
}) => {
  const ttsProfile = useTtsProfile();
  const { isLoaded: isClerkLoaded, isSignedIn } = useAuth();
  const { isLoading: isConvexAuthLoading } = useConvexAuth();
  const isAuthBridgePending =
    !isClerkLoaded || (isSignedIn === true && isConvexAuthLoading);
  const hasMounted = useSyncExternalStore(
    emptySubscribe,
    () => true,
    () => false,
  );
  const [clientId, setClientId] = useState<string | null>(readClientIdSnapshot);
  const [startingJobs, setStartingJobs] = useState<StartingJob[]>([]);
  const [directDownloads, setDirectDownloads] = useState<DirectDownloadToast[]>(
    [],
  );
  const [announcements, setAnnouncements] = useState({
    polite: "",
    assertive: "",
  });
  const previousStatusesRef = useRef<Record<string, string>>({});
  const activeTtsMetadata = useMemo(
    () => getTtsMetadata(ttsProfile),
    [ttsProfile],
  );
  const activeTtsCacheKey = activeTtsMetadata.ttsCacheKey;

  useEffect(() => {
    let cancelled = false;
    queueMicrotask(() => {
      if (cancelled) return;
      setClientId((current) => current ?? ensureClientId());
    });

    return () => {
      cancelled = true;
    };
  }, []);

  const queriedJobs = useQuery(
    api.articleExports.getRecentArticleAudioExports,
    clientId ? { clientId, limit: 4, ttsCacheKey: activeTtsCacheKey } : "skip",
  );
  const jobs = useMemo(
    () =>
      (queriedJobs ?? []).filter(
        (job) =>
          job.ttsCacheKey === activeTtsCacheKey &&
          job.ttsProvider === ttsProfile.provider,
      ),
    [activeTtsCacheKey, queriedJobs, ttsProfile.provider],
  );
  const mergedJobs = useMemo(() => {
    const activeJobKeys = new Set<string>(
      jobs.map(
        (job) => `${job.articleId as string}::${job.ttsProvider ?? "legacy"}`,
      ),
    );
    const optimisticJobs = startingJobs
      .filter(
        (job) =>
          job.ttsProvider === ttsProfile.provider &&
          !activeJobKeys.has(`${job.articleId}::${job.ttsProvider}`),
      )
      .map(
        (job) =>
          ({
            _id: `pending-${job.articleId}`,
            articleId: job.articleId,
            title: job.title,
            status: "queued",
            stage: "queued",
            sectionCount: 0,
            completedSectionCount: 0,
            ttsCacheKey: activeTtsCacheKey,
            ttsProvider: job.ttsProvider,
            createdAt: job.startedAt,
            updatedAt: job.startedAt,
          }) satisfies ArticleAudioExportJob,
      );

    return [...optimisticJobs, ...(jobs as ArticleAudioExportJob[])]
      .sort((a, b) => b.createdAt - a.createdAt)
      .slice(0, 4);
  }, [activeTtsCacheKey, jobs, startingJobs, ttsProfile.provider]);
  const trayJobs = useMemo<TrayJob[]>(() => {
    const exportJobs = mergedJobs.map(
      (job) =>
        ({
          ...job,
          kind: "export",
          downloadHref:
            job.status === "ready"
              ? `/api/article/audio-export/${job._id}?download=1`
              : undefined,
        }) satisfies TrayJob,
    );
    const downloadJobs = directDownloads.map(
      (job) =>
        ({
          _id: job._id,
          title: job.title,
          status: "ready",
          sectionCount: 0,
          completedSectionCount: 0,
          createdAt: job.createdAt,
          updatedAt: job.updatedAt,
          downloadHref: job.href,
          kind: "download",
          statusLabelOverride: "Download started",
          progressLabelOverride:
            "Your browser should start the download. If it does not, download it again here.",
        }) satisfies TrayJob,
    );

    return [...downloadJobs, ...exportJobs]
      .sort((a, b) => b.createdAt - a.createdAt)
      .slice(0, 4);
  }, [directDownloads, mergedJobs]);

  const startExport = useMutation(api.articleExports.startArticleAudioExport);
  const dismissExportMutation = useMutation(
    api.articleExports.dismissArticleAudioExport,
  );

  useEffect(() => {
    if (trayJobs.length === 0) {
      previousStatusesRef.current = {};
      return;
    }

    let nextPolite = "";
    let nextAssertive = "";
    const nextStatuses: Record<string, string> = {};

    for (const job of trayJobs) {
      nextStatuses[job._id] = job.status;
      const previousStatus = previousStatusesRef.current[job._id];

      if (!previousStatus && job.kind === "download") {
        nextPolite = `Download started for ${job.title}.`;
        continue;
      }

      if (!previousStatus && job.status === "queued") {
        nextPolite = `Article audio queued for ${job.title}.`;
        continue;
      }

      if (previousStatus !== job.status) {
        if (job.status === "ready") {
          nextPolite = `Article audio for ${job.title} is ready to download.`;
        } else if (job.status === "failed") {
          nextAssertive = `Article audio export failed for ${job.title}.`;
        }
      }
    }

    previousStatusesRef.current = nextStatuses;

    if (!nextPolite && !nextAssertive) return;

    let cancelled = false;
    queueMicrotask(() => {
      if (cancelled) return;
      setAnnouncements((current) => ({
        polite: nextPolite || current.polite,
        assertive: nextAssertive || current.assertive,
      }));
    });

    return () => {
      cancelled = true;
    };
  }, [trayJobs]);

  const queueExport = useCallback(
    async ({ articleId, title }: { articleId: string; title: string }) => {
      if (isAuthBridgePending) {
        throw new Error(
          "Article audio exports are still connecting to your account. Try again in a moment.",
        );
      }

      const requestedTtsProvider = ttsProfile.provider;
      const resolvedClientId =
        clientId ?? (typeof window === "undefined" ? "" : ensureClientId());

      if (!resolvedClientId) {
        throw new Error("Article export client is not ready yet.");
      }

      if (!clientId) {
        setClientId((current) => current ?? resolvedClientId);
      }

      setStartingJobs((current) =>
        current.some(
          (job) =>
            job.articleId === articleId &&
            job.ttsProvider === requestedTtsProvider,
        )
          ? current
          : [
              ...current,
              {
                articleId,
                title,
                ttsProvider: requestedTtsProvider,
                startedAt: Date.now(),
              },
            ],
      );

      try {
        const result = await startExport({
          clientId: resolvedClientId,
          articleId: articleId as Id<"articles">,
          expectedTtsProvider: requestedTtsProvider,
        });
        if (result.ttsProvider !== requestedTtsProvider) {
          throw new Error(
            "Article audio voice changed. Please try the export again.",
          );
        }
        return {
          exportId: result.exportId as string,
          status: result.status as ArticleAudioExportJob["status"],
        };
      } finally {
        setStartingJobs((current) =>
          current.filter(
            (job) =>
              job.articleId !== articleId ||
              job.ttsProvider !== requestedTtsProvider,
          ),
        );
      }
    },
    [clientId, isAuthBridgePending, startExport, ttsProfile.provider],
  );

  const dismissExport = useCallback(
    async (exportId: string) => {
      if (!clientId) return;
      await dismissExportMutation({
        exportId: exportId as Id<"articleAudioExports">,
        clientId,
      });
    },
    [clientId, dismissExportMutation],
  );

  const isStartingArticle = useCallback(
    (articleId: string, ttsProvider: TtsProvider) =>
      startingJobs.some(
        (job) => job.articleId === articleId && job.ttsProvider === ttsProvider,
      ),
    [startingJobs],
  );

  const registerDirectDownload = useCallback(
    ({ title, href }: { title: string; href: string }) => {
      setDirectDownloads((current) => {
        const next = [
          {
            _id: `download-${title}-${href}`,
            title,
            href,
            createdAt: Date.now(),
            updatedAt: Date.now(),
          },
          ...current.filter((job) => job.href !== href),
        ];
        return next.slice(0, 4);
      });
    },
    [],
  );

  const value = useMemo<ArticleAudioExportContextValue>(
    () => ({
      jobs: mergedJobs,
      queueExport,
      dismissExport,
      isStartingArticle,
      registerDirectDownload,
    }),
    [
      mergedJobs,
      queueExport,
      dismissExport,
      isStartingArticle,
      registerDirectDownload,
    ],
  );

  return (
    <ArticleAudioExportContext.Provider value={value}>
      {children}
      {hasMounted ? (
        <ArticleAudioExportTray
          jobs={trayJobs}
          onDismiss={(exportId) => {
            if (exportId.startsWith("download-")) {
              setDirectDownloads((current) =>
                current.filter((job) => job._id !== exportId),
              );
              return;
            }
            if (exportId.startsWith("pending-")) {
              const articleId = exportId.slice("pending-".length);
              setStartingJobs((current) =>
                current.filter(
                  (job) =>
                    job.articleId !== articleId ||
                    job.ttsProvider !== ttsProfile.provider,
                ),
              );
              return;
            }
            void dismissExport(exportId);
          }}
          onRetry={(articleId) => {
            const matchingJob = mergedJobs.find(
              (job) =>
                job.articleId === articleId &&
                job.ttsProvider === ttsProfile.provider,
            );
            void queueExport({
              articleId,
              title: matchingJob?.title ?? "Wikipedia article",
            });
          }}
          politeAnnouncement={announcements.polite}
          assertiveAnnouncement={announcements.assertive}
        />
      ) : null}
    </ArticleAudioExportContext.Provider>
  );
};

export const ArticleAudioExportFallbackProvider = ({
  children,
}: {
  children: ReactNode;
}) => {
  const value = useMemo<ArticleAudioExportContextValue>(
    () => ({
      jobs: [],
      queueExport: async () => {
        throw new Error("Article audio exports are unavailable in local mode.");
      },
      dismissExport: async () => {},
      isStartingArticle: () => false,
      registerDirectDownload: () => {},
    }),
    [],
  );

  return (
    <ArticleAudioExportContext.Provider value={value}>
      {children}
    </ArticleAudioExportContext.Provider>
  );
};

export const useArticleAudioExports = () => {
  const value = useContext(ArticleAudioExportContext);
  if (!value) {
    throw new Error(
      "useArticleAudioExports() must be used within ArticleAudioExportProvider.",
    );
  }
  return value;
};
