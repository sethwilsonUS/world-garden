"use client";

import { useAuth } from "@clerk/nextjs";
import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from "react";
import { useAction, useConvexAuth, useMutation, useQuery } from "convex/react";
import { api } from "@/convex/_generated/api";
import { type Id } from "@/convex/_generated/dataModel";

const isLocal = process.env.NEXT_PUBLIC_LOCAL_MODE === "true";
const LOCAL_HOSTNAMES = new Set(["localhost", "127.0.0.1", "0.0.0.0", "[::1]"]);

type PlaylistEntry = {
  _id: string;
  slug: string;
  title: string;
  description?: string;
  imageUrl?: string;
  position: number;
  publishedAt: number;
  status: "queued" | "running" | "ready" | "failed";
  stage?: "queued" | "rendering_audio" | "packaging";
  sectionCount?: number;
  completedSectionCount?: number;
  durationSeconds?: number;
  byteLength?: number;
  lastError?: string;
  audioUrl?: string | null;
};

type PersonalPlaylistContextValue = {
  entries: PlaylistEntry[];
  feedToken: string | null;
  feedUrl: string | null;
  isAvailable: boolean;
  isLoaded: boolean;
  addBySlug: (args: { slug: string; title: string }) => Promise<void>;
  remove: (episodeId: string, title: string) => Promise<void>;
  moveUp: (episodeId: string, title: string) => Promise<void>;
  moveDown: (episodeId: string, title: string) => Promise<void>;
  retry: (episodeId: string, title: string) => Promise<void>;
  isAdding: (slug: string) => boolean;
  isInPlaylist: (slug: string) => boolean;
};

const PersonalPlaylistContext = createContext<PersonalPlaylistContextValue | null>(
  null,
);

const resolveServerBaseUrl = (origin: string): string => {
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
      // Ignore invalid configuration.
    }
  }

  return "https://curiogarden.org";
};

const buildFeedUrl = (feedToken: string | null): string | null => {
  if (!feedToken || typeof window === "undefined") {
    return null;
  }

  const url = new URL("/api/podcast/personal.xml", window.location.origin);
  url.searchParams.set("token", feedToken);
  return url.toString();
};

export const PersonalPlaylistProvider = ({
  children,
}: {
  children: ReactNode;
}) => {
  const { isLoaded: isClerkLoaded, isSignedIn } = useAuth();
  const {
    isLoading: isConvexAuthLoading,
    isAuthenticated,
  } = useConvexAuth();
  const canUseAccountApi = Boolean(isSignedIn && isAuthenticated);

  const [addingSlugs, setAddingSlugs] = useState<Set<string>>(new Set());
  const [politeMessage, setPoliteMessage] = useState("");
  const [alertMessage, setAlertMessage] = useState("");

  const entries = useQuery(
    api.personalPlaylist.listViewerPlaylistEpisodes,
    canUseAccountApi ? {} : "skip",
  ) as PlaylistEntry[] | undefined;
  const feedToken = useQuery(
    api.personalPlaylist.getViewerFeedToken,
    canUseAccountApi ? {} : "skip",
  ) as string | null | undefined;

  const addEpisodeBySlug = useAction(
    api.personalPlaylist.addViewerPlaylistEpisodeBySlug,
  );
  const removeEpisode = useMutation(api.personalPlaylist.removeViewerPlaylistEpisode);
  const moveEpisode = useMutation(api.personalPlaylist.moveViewerPlaylistEpisode);
  const retryEpisode = useMutation(api.personalPlaylist.retryViewerPlaylistEpisode);

  useEffect(() => {
    if (!politeMessage && !alertMessage) return;
    const timeout = window.setTimeout(() => {
      setPoliteMessage("");
      setAlertMessage("");
    }, 2400);
    return () => window.clearTimeout(timeout);
  }, [politeMessage, alertMessage]);

  const addBySlug = useCallback(
    async ({ slug, title }: { slug: string; title: string }) => {
      if (!canUseAccountApi) {
        throw new Error(
          isSignedIn
            ? "Playlist sync is still connecting to your account. Refresh in a moment and make sure Clerk is connected to Convex."
            : "Playlist is only available for signed-in users.",
        );
      }

      setAddingSlugs((current) => new Set(current).add(slug));

      try {
        const result = await addEpisodeBySlug({
          slug,
          baseUrl: resolveServerBaseUrl(window.location.origin),
        });

        setPoliteMessage(
          result.added
            ? `${title} added to your playlist. Episode generation started in the background.`
            : `${title} is already in your playlist.`,
        );
      } catch (error) {
        setAlertMessage(
          error instanceof Error
            ? error.message
            : `Could not add ${title} to your playlist.`,
        );
        throw error;
      } finally {
        setAddingSlugs((current) => {
          const next = new Set(current);
          next.delete(slug);
          return next;
        });
      }
    },
    [addEpisodeBySlug, canUseAccountApi, isSignedIn],
  );

  const remove = useCallback(
    async (episodeId: string, title: string) => {
      await removeEpisode({ episodeId: episodeId as Id<"personalPlaylistEpisodes"> });
      setPoliteMessage(`${title} removed from your playlist.`);
    },
    [removeEpisode],
  );

  const moveUp = useCallback(
    async (episodeId: string, title: string) => {
      const result = await moveEpisode({
        episodeId: episodeId as Id<"personalPlaylistEpisodes">,
        direction: "up",
      });
      if (result.moved) {
        setPoliteMessage(`${title} moved earlier in your playlist.`);
      }
    },
    [moveEpisode],
  );

  const moveDown = useCallback(
    async (episodeId: string, title: string) => {
      const result = await moveEpisode({
        episodeId: episodeId as Id<"personalPlaylistEpisodes">,
        direction: "down",
      });
      if (result.moved) {
        setPoliteMessage(`${title} moved later in your playlist.`);
      }
    },
    [moveEpisode],
  );

  const retry = useCallback(
    async (episodeId: string, title: string) => {
      const result = await retryEpisode({
        episodeId: episodeId as Id<"personalPlaylistEpisodes">,
        baseUrl: resolveServerBaseUrl(window.location.origin),
      });

      if (result.queued) {
        setPoliteMessage(`${title} is queued for regeneration.`);
        return;
      }

      setAlertMessage(`Could not retry ${title} right now.`);
    },
    [retryEpisode],
  );

  const value = useMemo<PersonalPlaylistContextValue>(
    () => ({
      entries: entries ?? [],
      feedToken: feedToken ?? null,
      feedUrl: buildFeedUrl(feedToken ?? null),
      isAvailable: canUseAccountApi,
      isLoaded:
        isLocal ||
        (isClerkLoaded &&
          !isConvexAuthLoading &&
          (!canUseAccountApi || entries !== undefined)),
      addBySlug,
      remove,
      moveUp,
      moveDown,
      retry,
      isAdding: (slug) => addingSlugs.has(slug),
      isInPlaylist: (slug) => (entries ?? []).some((entry) => entry.slug === slug),
    }),
    [
      addBySlug,
      addingSlugs,
      canUseAccountApi,
      entries,
      feedToken,
      isClerkLoaded,
      isConvexAuthLoading,
      moveDown,
      moveUp,
      remove,
      retry,
    ],
  );

  return (
    <PersonalPlaylistContext.Provider value={value}>
      {children}
      <div className="sr-only" aria-live="polite" role="status">
        {politeMessage}
      </div>
      <div className="sr-only" aria-live="assertive" aria-atomic="true" role="alert">
        {alertMessage}
      </div>
    </PersonalPlaylistContext.Provider>
  );
};

export const PersonalPlaylistFallbackProvider = ({
  children,
}: {
  children: ReactNode;
}) => {
  const value = useMemo<PersonalPlaylistContextValue>(
    () => ({
      entries: [],
      feedToken: null,
      feedUrl: null,
      isAvailable: false,
      isLoaded: true,
      addBySlug: async () => {},
      remove: async () => {},
      moveUp: async () => {},
      moveDown: async () => {},
      retry: async () => {},
      isAdding: () => false,
      isInPlaylist: () => false,
    }),
    [],
  );

  return (
    <PersonalPlaylistContext.Provider value={value}>
      {children}
    </PersonalPlaylistContext.Provider>
  );
};

export const usePersonalPlaylist = () => {
  const value = useContext(PersonalPlaylistContext);
  if (!value) {
    throw new Error(
      "usePersonalPlaylist() must be used within PersonalPlaylistProvider.",
    );
  }
  return value;
};
