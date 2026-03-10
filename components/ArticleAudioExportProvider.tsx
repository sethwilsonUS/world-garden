"use client";

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from "react";
import { useMutation, useQuery } from "convex/react";
import { api } from "@/convex/_generated/api";
import { type Id } from "@/convex/_generated/dataModel";

const CLIENT_ID_STORAGE_KEY = "cg-article-audio-export-client-id";

type ArticleAudioExportJob = {
  _id: string;
  articleId: string;
  title: string;
  status: "queued" | "running" | "ready" | "failed";
  stage?: "queued" | "rendering_audio" | "packaging";
  sectionCount: number;
  completedSectionCount: number;
  lastError?: string;
  audioUrl?: string | null;
  updatedAt: number;
};

type StartingJob = {
  articleId: string;
  title: string;
  startedAt: number;
};

type ArticleAudioExportContextValue = {
  jobs: ArticleAudioExportJob[];
  queueExport: (args: {
    articleId: string;
    title: string;
  }) => Promise<{ exportId: string; status: ArticleAudioExportJob["status"] }>;
  dismissExport: (exportId: string) => Promise<void>;
  isStartingArticle: (articleId: string) => boolean;
};

const ArticleAudioExportContext =
  createContext<ArticleAudioExportContextValue | null>(null);

const LOCAL_HOSTNAMES = new Set(["localhost", "127.0.0.1", "0.0.0.0", "[::1]"]);

const ensureClientId = (): string => {
  const existing = window.localStorage.getItem(CLIENT_ID_STORAGE_KEY);
  if (existing) return existing;

  const created = window.crypto.randomUUID();
  window.localStorage.setItem(CLIENT_ID_STORAGE_KEY, created);
  return created;
};

const resolveArticleExportBaseUrl = (origin: string): string => {
  try {
    const url = new URL(origin);
    if (!LOCAL_HOSTNAMES.has(url.hostname)) {
      return url.origin;
    }
  } catch {
    return origin;
  }

  const configuredSiteUrl = process.env.NEXT_PUBLIC_SITE_URL?.trim();
  if (configuredSiteUrl) {
    try {
      const configuredUrl = new URL(configuredSiteUrl);
      if (!LOCAL_HOSTNAMES.has(configuredUrl.hostname)) {
        return configuredUrl.origin;
      }
    } catch {
      // Ignore invalid configuration and fall back to the public site origin.
    }
  }

  return "https://curiogarden.org";
};

const statusLabel = (job: ArticleAudioExportJob): string => {
  if (job.status === "ready") return "Ready to download";
  if (job.status === "failed") return "Export failed";
  if (job.stage === "packaging") return "Packaging MP3";
  if (job.status === "running") return "Preparing article audio";
  return "Queued for export";
};

const progressLabel = (job: ArticleAudioExportJob): string => {
  if (job.status === "ready") return "Your article audio file is ready.";
  if (job.status === "failed") {
    return job.lastError || "Something went wrong while exporting this article.";
  }
  if (job.stage === "packaging") return "Finalizing the download package.";
  if (job.sectionCount <= 0) return "Preparing your export.";
  return `${Math.min(job.completedSectionCount, job.sectionCount)} of ${job.sectionCount} sections ready`;
};

const ExportIcon = ({
  status,
}: {
  status: ArticleAudioExportJob["status"];
}) => {
  if (status === "ready") {
    return (
      <svg
        viewBox="0 0 24 24"
        fill="none"
        stroke="currentColor"
        strokeWidth={2}
        strokeLinecap="round"
        strokeLinejoin="round"
        width={18}
        height={18}
        aria-hidden="true"
      >
        <path d="M20 6 9 17l-5-5" />
      </svg>
    );
  }

  if (status === "failed") {
    return (
      <svg
        viewBox="0 0 24 24"
        fill="none"
        stroke="currentColor"
        strokeWidth={2}
        strokeLinecap="round"
        strokeLinejoin="round"
        width={18}
        height={18}
        aria-hidden="true"
      >
        <path d="M12 9v4" />
        <path d="M12 17h.01" />
        <path d="M10.29 3.86 1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0Z" />
      </svg>
    );
  }

  return (
    <svg
      className="animate-spin"
      fill="none"
      viewBox="0 0 24 24"
      width={18}
      height={18}
      aria-hidden="true"
    >
      <circle
        className="opacity-25"
        cx="12"
        cy="12"
        r="10"
        stroke="currentColor"
        strokeWidth="4"
      />
      <path
        className="opacity-75"
        fill="currentColor"
        d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"
      />
    </svg>
  );
};

const ArticleAudioExportTray = ({
  jobs,
  onDismiss,
  onRetry,
  politeAnnouncement,
  assertiveAnnouncement,
}: {
  jobs: ArticleAudioExportJob[];
  onDismiss: (exportId: string) => void;
  onRetry: (articleId: string) => void;
  politeAnnouncement: string;
  assertiveAnnouncement: string;
}) => {
  if (jobs.length === 0) {
    return (
      <>
        <div className="sr-only" aria-live="polite" role="status">
          {politeAnnouncement}
        </div>
        <div className="sr-only" aria-live="assertive">
          {assertiveAnnouncement}
        </div>
      </>
    );
  }

  return (
    <>
      <div className="sr-only" aria-live="polite" role="status">
        {politeAnnouncement}
      </div>
      <div className="sr-only" aria-live="assertive">
        {assertiveAnnouncement}
      </div>

      <section
        aria-label="Article audio exports"
        className="pointer-events-none fixed inset-x-4 bottom-4 z-[70] flex flex-col items-end gap-3"
        style={{ paddingBottom: "env(safe-area-inset-bottom)" }}
      >
        {jobs.map((job) => {
          const progressPercent =
            job.sectionCount > 0
              ? Math.max(
                  8,
                  Math.min(
                    100,
                    Math.round(
                      (job.completedSectionCount / job.sectionCount) * 100,
                    ),
                  ),
                )
              : 12;

          const accentClasses =
            job.status === "failed"
              ? "text-serious bg-[color:var(--color-surface)] border-[color:var(--color-serious)]/25"
              : job.status === "ready"
                ? "text-accent bg-accent-bg border-accent-border"
                : "text-accent bg-accent-bg border-accent-border";

          return (
            <article
              key={job._id}
              className="pointer-events-auto garden-bed w-full max-w-[26rem] overflow-hidden shadow-[0_20px_50px_rgba(0,0,0,0.16)]"
            >
              <div className="h-1.5 bg-surface-3" aria-hidden="true">
                <div
                  className={`h-full rounded-r-full ${
                    job.status === "failed"
                      ? "bg-serious"
                      : job.status === "ready"
                        ? "bg-accent"
                        : "bg-accent"
                  }`}
                  style={{
                    width:
                      job.status === "failed"
                        ? "100%"
                        : job.status === "ready"
                          ? "100%"
                          : `${progressPercent}%`,
                  }}
                />
              </div>

              <div className="p-4 sm:p-4.5">
                <div className="flex items-start gap-3">
                  <div
                    className={`mt-0.5 inline-flex min-h-11 min-w-11 items-center justify-center rounded-2xl border ${accentClasses}`}
                  >
                    <ExportIcon status={job.status} />
                  </div>

                  <div className="min-w-0 flex-1">
                    <p className="text-[0.72rem] font-semibold uppercase tracking-[0.16em] text-muted">
                      {statusLabel(job)}
                    </p>
                    <h2 className="mt-1 font-display text-[1.02rem] leading-[1.2] text-foreground">
                      {job.title}
                    </h2>
                    <p className="mt-2 text-sm leading-[1.6] text-foreground-2">
                      {progressLabel(job)}
                    </p>
                  </div>

                  <button
                    type="button"
                    onClick={() => onDismiss(job._id)}
                    className="inline-flex min-h-11 min-w-11 items-center justify-center rounded-xl border border-border bg-surface-2 text-muted transition-colors duration-200 hover:bg-surface-3 hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent focus-visible:ring-offset-2 focus-visible:ring-offset-background"
                    aria-label={`Dismiss export status for ${job.title}`}
                  >
                    <svg
                      viewBox="0 0 24 24"
                      fill="none"
                      stroke="currentColor"
                      strokeWidth={2}
                      strokeLinecap="round"
                      strokeLinejoin="round"
                      width={16}
                      height={16}
                      aria-hidden="true"
                    >
                      <path d="M18 6 6 18" />
                      <path d="m6 6 12 12" />
                    </svg>
                  </button>
                </div>

                {job.status !== "ready" && job.status !== "failed" && (
                  <div className="mt-4 rounded-full bg-surface-3 p-1" aria-hidden="true">
                    <div
                      className="h-2 rounded-full bg-accent transition-[width] duration-300"
                      style={{
                        width:
                          job.stage === "packaging"
                            ? "100%"
                            : `${progressPercent}%`,
                      }}
                    />
                  </div>
                )}

                <div className="mt-4 flex flex-wrap items-center gap-2">
                  {job.status === "ready" ? (
                    <a
                      href={`/api/article/audio-export/${job._id}?download=1`}
                      className="btn-primary min-h-11 px-4 py-2 text-sm no-underline"
                      aria-label={`Download article audio for ${job.title}`}
                    >
                      Download MP3
                    </a>
                  ) : job.status === "failed" ? (
                    <button
                      type="button"
                      onClick={() => onRetry(job.articleId)}
                      className="btn-primary min-h-11 px-4 py-2 text-sm"
                    >
                      Retry export
                    </button>
                  ) : (
                    <span className="inline-flex min-h-11 items-center rounded-xl border border-accent-border bg-accent-bg px-4 py-2 text-sm font-semibold text-accent">
                      Working in the background
                    </span>
                  )}

                  <span className="text-xs text-muted">
                    {new Date(job.updatedAt).toLocaleTimeString([], {
                      hour: "numeric",
                      minute: "2-digit",
                    })}
                  </span>
                </div>
              </div>
            </article>
          );
        })}
      </section>
    </>
  );
};

export const ArticleAudioExportProvider = ({
  children,
}: {
  children: ReactNode;
}) => {
  const [clientId, setClientId] = useState<string | null>(null);
  const [startingJobs, setStartingJobs] = useState<StartingJob[]>([]);
  const [politeAnnouncement, setPoliteAnnouncement] = useState("");
  const [assertiveAnnouncement, setAssertiveAnnouncement] = useState("");
  const previousStatusesRef = useRef<Record<string, string>>({});

  useEffect(() => {
    setClientId(ensureClientId());
  }, []);

  const queriedJobs = useQuery(
    api.articleExports.getRecentArticleAudioExports,
    clientId ? { clientId, limit: 4 } : "skip",
  );
  const jobs = useMemo(() => queriedJobs ?? [], [queriedJobs]);
  const mergedJobs = useMemo(() => {
    const activeArticleIds = new Set<string>(
      jobs.map((job) => job.articleId as string),
    );
    const optimisticJobs = startingJobs
      .filter((job) => !activeArticleIds.has(job.articleId))
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
            updatedAt: job.startedAt,
          }) satisfies ArticleAudioExportJob,
      );

    return [...optimisticJobs, ...(jobs as ArticleAudioExportJob[])]
      .sort((a, b) => b.updatedAt - a.updatedAt)
      .slice(0, 4);
  }, [jobs, startingJobs]);

  const startExport = useMutation(api.articleExports.startArticleAudioExport);
  const dismissExportMutation = useMutation(
    api.articleExports.dismissArticleAudioExport,
  );

  useEffect(() => {
    if (mergedJobs.length === 0) {
      previousStatusesRef.current = {};
      return;
    }

    let nextPolite = "";
    let nextAssertive = "";
    const nextStatuses: Record<string, string> = {};

    for (const job of mergedJobs) {
      nextStatuses[job._id] = job.status;
      const previousStatus = previousStatusesRef.current[job._id];

      if (!previousStatus && job.status === "queued") {
        nextPolite = `Preparing article audio for ${job.title}.`;
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

    if (nextPolite) setPoliteAnnouncement(nextPolite);
    if (nextAssertive) setAssertiveAnnouncement(nextAssertive);
  }, [mergedJobs]);

  const queueExport = useCallback(
    async ({ articleId, title }: { articleId: string; title: string }) => {
      const resolvedClientId =
        clientId ??
        (typeof window === "undefined" ? "" : ensureClientId());

      if (!resolvedClientId) {
        throw new Error("Article export client is not ready yet.");
      }

      setClientId((current) => current ?? resolvedClientId);
      setStartingJobs((current) =>
        current.some((job) => job.articleId === articleId)
          ? current
          : [...current, { articleId, title, startedAt: Date.now() }],
      );

      try {
        const result = await startExport({
          clientId: resolvedClientId,
          articleId: articleId as Id<"articles">,
          baseUrl: resolveArticleExportBaseUrl(window.location.origin),
        });
        return {
          exportId: result.exportId as string,
          status: result.status as ArticleAudioExportJob["status"],
        };
      } finally {
        setStartingJobs((current) =>
          current.filter((job) => job.articleId !== articleId),
        );
      }
    },
    [clientId, startExport],
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
    (articleId: string) =>
      startingJobs.some((job) => job.articleId === articleId),
    [startingJobs],
  );

  const value = useMemo<ArticleAudioExportContextValue>(
    () => ({
      jobs: mergedJobs,
      queueExport,
      dismissExport,
      isStartingArticle,
    }),
    [mergedJobs, queueExport, dismissExport, isStartingArticle],
  );

  return (
    <ArticleAudioExportContext.Provider value={value}>
      {children}
      <ArticleAudioExportTray
        jobs={mergedJobs}
        onDismiss={(exportId) => {
          if (exportId.startsWith("pending-")) {
            const articleId = exportId.slice("pending-".length);
            setStartingJobs((current) =>
              current.filter((job) => job.articleId !== articleId),
            );
            return;
          }
          void dismissExport(exportId);
        }}
        onRetry={(articleId) => {
          const matchingJob = mergedJobs.find((job) => job.articleId === articleId);
          void queueExport({
            articleId,
            title: matchingJob?.title ?? "Wikipedia article",
          });
        }}
        politeAnnouncement={politeAnnouncement}
        assertiveAnnouncement={assertiveAnnouncement}
      />
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
