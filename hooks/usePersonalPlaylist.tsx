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
import { getTtsMetadata, getTtsProfile } from "@/lib/tts-profile";

const isLocal = process.env.NEXT_PUBLIC_LOCAL_MODE === "true";

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
};

type PersonalFeedStatus = "not_created" | "active" | "revoked";

type PersonalFeedState = {
  status: PersonalFeedStatus;
  feedToken: string | null;
  updatedAt: number | null;
};

type PersonalPlaylistContextValue = {
  entries: PlaylistEntry[];
  feedStatus: PersonalFeedStatus;
  feedUrl: string | null;
  isAvailable: boolean;
  isFeedUpdating: boolean;
  isLoaded: boolean;
  addBySlug: (args: { slug: string; title: string }) => Promise<void>;
  rotateFeed: () => Promise<void>;
  revokeFeed: () => Promise<void>;
  remove: (episodeId: string, title: string) => Promise<void>;
  moveUp: (episodeId: string, title: string) => Promise<void>;
  moveDown: (episodeId: string, title: string) => Promise<void>;
  retry: (episodeId: string, title: string) => Promise<void>;
  isAdding: (slug: string) => boolean;
  isInPlaylist: (slug: string) => boolean;
};

const PersonalPlaylistContext =
  createContext<PersonalPlaylistContextValue | null>(null);

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
  const { isLoading: isConvexAuthLoading, isAuthenticated } = useConvexAuth();
  const canUseAccountApi = Boolean(isSignedIn && isAuthenticated);

  const [addingSlugs, setAddingSlugs] = useState<Set<string>>(new Set());
  const [isFeedUpdating, setIsFeedUpdating] = useState(false);
  const [politeMessage, setPoliteMessage] = useState("");
  const [alertMessage, setAlertMessage] = useState("");
  const personalPlaylistTtsMetadata = useMemo(
    () => getTtsMetadata(getTtsProfile("openai")),
    [],
  );

  const entries = useQuery(
    api.personalPlaylist.listViewerPlaylistEpisodes,
    canUseAccountApi ? {} : "skip",
  ) as PlaylistEntry[] | undefined;
  const feedState = useQuery(
    api.personalPlaylist.getViewerFeedState,
    canUseAccountApi ? {} : "skip",
  ) as PersonalFeedState | undefined;

  const addEpisodeBySlug = useAction(
    api.personalPlaylist.addViewerPlaylistEpisodeBySlug,
  );
  const removeEpisode = useMutation(
    api.personalPlaylist.removeViewerPlaylistEpisode,
  );
  const moveEpisode = useMutation(
    api.personalPlaylist.moveViewerPlaylistEpisode,
  );
  const retryEpisode = useMutation(
    api.personalPlaylist.retryViewerPlaylistEpisode,
  );
  const rotateFeedToken = useMutation(
    api.personalPlaylist.rotateViewerFeedToken,
  );
  const revokeFeedToken = useMutation(
    api.personalPlaylist.revokeViewerFeedToken,
  );

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
          ttsMetadata: personalPlaylistTtsMetadata,
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
    [
      addEpisodeBySlug,
      canUseAccountApi,
      isSignedIn,
      personalPlaylistTtsMetadata,
    ],
  );

  const remove = useCallback(
    async (episodeId: string, title: string) => {
      await removeEpisode({
        episodeId: episodeId as Id<"personalPlaylistEpisodes">,
      });
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
      try {
        const result = await retryEpisode({
          episodeId: episodeId as Id<"personalPlaylistEpisodes">,
          ttsMetadata: personalPlaylistTtsMetadata,
        });

        if (result.queued) {
          setPoliteMessage(`${title} is queued for regeneration.`);
          return;
        }

        setAlertMessage(`Could not retry ${title} right now.`);
      } catch (error) {
        setAlertMessage(
          error instanceof Error
            ? error.message
            : `Could not retry ${title} right now.`,
        );
      }
    },
    [personalPlaylistTtsMetadata, retryEpisode],
  );

  const rotateFeed = useCallback(async () => {
    if (!canUseAccountApi) {
      throw new Error("Private feeds are only available for signed-in users.");
    }

    setIsFeedUpdating(true);
    try {
      await rotateFeedToken({});
      setPoliteMessage(
        feedState?.status === "active"
          ? "Your private feed URL was replaced. The old address no longer works. Copy the new address into your podcast app."
          : "A new private feed URL is ready.",
      );
    } catch (error) {
      const message =
        error instanceof Error
          ? error.message
          : "Could not update your private feed URL.";
      setAlertMessage(message);
      throw error;
    } finally {
      setIsFeedUpdating(false);
    }
  }, [canUseAccountApi, feedState, rotateFeedToken]);

  const revokeFeed = useCallback(async () => {
    if (!canUseAccountApi) {
      throw new Error("Private feeds are only available for signed-in users.");
    }

    setIsFeedUpdating(true);
    try {
      await revokeFeedToken({});
      setPoliteMessage(
        "Your private feed is off. Your playlist is still here.",
      );
    } catch (error) {
      const message =
        error instanceof Error
          ? error.message
          : "Could not turn off your private feed.";
      setAlertMessage(message);
      throw error;
    } finally {
      setIsFeedUpdating(false);
    }
  }, [canUseAccountApi, revokeFeedToken]);

  const value = useMemo<PersonalPlaylistContextValue>(
    () => ({
      entries: entries ?? [],
      feedStatus: feedState?.status ?? "not_created",
      feedUrl:
        feedState?.status === "active"
          ? buildFeedUrl(feedState.feedToken)
          : null,
      isAvailable: canUseAccountApi,
      isFeedUpdating,
      isLoaded:
        isLocal ||
        (isClerkLoaded &&
          !isConvexAuthLoading &&
          (!canUseAccountApi ||
            (entries !== undefined && feedState !== undefined))),
      addBySlug,
      rotateFeed,
      revokeFeed,
      remove,
      moveUp,
      moveDown,
      retry,
      isAdding: (slug) => addingSlugs.has(slug),
      isInPlaylist: (slug) =>
        (entries ?? []).some((entry) => entry.slug === slug),
    }),
    [
      addBySlug,
      addingSlugs,
      canUseAccountApi,
      entries,
      feedState,
      isClerkLoaded,
      isFeedUpdating,
      isConvexAuthLoading,
      moveDown,
      moveUp,
      remove,
      revokeFeed,
      retry,
      rotateFeed,
    ],
  );

  return (
    <PersonalPlaylistContext.Provider value={value}>
      {children}
      <div className="sr-only" aria-live="polite" role="status">
        {politeMessage}
      </div>
      <div
        className="sr-only"
        aria-live="assertive"
        aria-atomic="true"
        role="alert"
      >
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
      feedStatus: "not_created",
      feedUrl: null,
      isAvailable: false,
      isFeedUpdating: false,
      isLoaded: true,
      addBySlug: async () => {},
      rotateFeed: async () => {},
      revokeFeed: async () => {},
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
