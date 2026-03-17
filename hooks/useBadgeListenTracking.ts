"use client";

import { useCallback, useEffect, useRef, type RefObject } from "react";
import type { Id } from "@/convex/_generated/dataModel";
import type { Section } from "@/lib/data-context";
import type {
  AwardedBadgeProgress,
  BadgeListenProgressResult,
} from "@/lib/badges";
import {
  getPlayableArticleDurationSeconds,
  getResolvedDurationSeconds,
  type SectionDurationMap,
} from "@/lib/article-audio-duration";
import {
  detectContinuousPlaybackWindow,
  mergeHeardRanges,
  normalizeHeardRanges,
  type HeardRange,
} from "@/lib/listen-progress";

const SAMPLE_INTERVAL_MS = 1_000;
const FLUSH_INTERVAL_MS = 5_000;
const isLocal = process.env.NEXT_PUBLIC_LOCAL_MODE === "true";

type ReportProgressFn = (args: {
  articleId: Id<"articles">;
  wikiPageId: string;
  slug: string;
  title: string;
  totalDurationSeconds: number;
  sectionKey: string;
  sectionDurationSeconds: number;
  heardRanges: HeardRange[];
}) => Promise<unknown>;

type UseBadgeListenTrackingArgs = {
  articleId?: Id<"articles">;
  wikiPageId?: string;
  slug: string;
  title?: string;
  summaryText?: string;
  sections: Section[];
  sectionDurations?: SectionDurationMap;
  trackingSectionKey: string | null;
  audioDurationSeconds: number;
  isPlaying: boolean;
  audioRef: RefObject<HTMLAudioElement | null>;
  reportProgress: ReportProgressFn;
  onBadgesAwarded?: (args: {
    articleTitle: string;
    badges: AwardedBadgeProgress[];
  }) => void;
};

const isUnauthorizedError = (error: unknown): boolean =>
  error instanceof Error && /unauthorized/i.test(error.message);

export const useBadgeListenTracking = ({
  articleId,
  wikiPageId,
  slug,
  title,
  summaryText,
  sections,
  sectionDurations,
  trackingSectionKey,
  audioDurationSeconds,
  isPlaying,
  audioRef,
  reportProgress,
  onBadgesAwarded,
}: UseBadgeListenTrackingArgs) => {
  const enabledRef = useRef(!isLocal);
  const isPlayingRef = useRef(isPlaying);
  const currentSectionKeyRef = useRef<string | null>(trackingSectionKey);
  const pendingRangesRef = useRef<HeardRange[]>([]);
  const lastSampleRef = useRef<{ currentTime: number; observedAt: number } | null>(
    null,
  );
  const knownDurationsRef = useRef<Record<string, number>>({});
  const previousPlayingRef = useRef(false);

  const resolveSectionText = useCallback(
    (sectionKey: string): string => {
      if (sectionKey === "summary") {
        return summaryText ?? "";
      }

      const index = Number.parseInt(sectionKey.replace("section-", ""), 10);
      const section = sections[index];
      return section?.content ?? "";
    },
    [sections, summaryText],
  );

  const resolveSectionDuration = useCallback(
    (sectionKey: string): number => {
      const known = knownDurationsRef.current[sectionKey];
      if (known != null) {
        return known;
      }

      return getResolvedDurationSeconds(
        sectionKey,
        resolveSectionText(sectionKey),
        sectionDurations,
      );
    },
    [resolveSectionText, sectionDurations],
  );

  const resolveTotalDuration = useCallback(
    () =>
      getPlayableArticleDurationSeconds(summaryText, sections, {
        ...sectionDurations,
        ...knownDurationsRef.current,
      }),
    [sectionDurations, sections, summaryText],
  );

  const flushPendingRanges = useCallback(
    async (sectionKeyOverride?: string | null) => {
      if (!enabledRef.current) return;

      const sectionKey = sectionKeyOverride ?? currentSectionKeyRef.current;
      if (!articleId || !wikiPageId || !title || !sectionKey) {
        pendingRangesRef.current = [];
        return;
      }

      const heardRanges = pendingRangesRef.current;
      if (heardRanges.length === 0) return;

      pendingRangesRef.current = [];

      try {
        const result = await reportProgress({
          articleId,
          wikiPageId,
          slug,
          title,
          totalDurationSeconds: resolveTotalDuration(),
          sectionKey,
          sectionDurationSeconds: resolveSectionDuration(sectionKey),
          heardRanges,
        }) as BadgeListenProgressResult;

        if (result.awardedBadges.length > 0) {
          onBadgesAwarded?.({
            articleTitle: title,
            badges: result.awardedBadges,
          });
        }
      } catch (error) {
        if (isUnauthorizedError(error)) {
          enabledRef.current = false;
          pendingRangesRef.current = [];
          return;
        }

        pendingRangesRef.current = mergeHeardRanges([
          ...heardRanges,
          ...pendingRangesRef.current,
        ]);
      }
    },
    [
      articleId,
      reportProgress,
      resolveSectionDuration,
      resolveTotalDuration,
      slug,
      title,
      wikiPageId,
      onBadgesAwarded,
    ],
  );

  const samplePlayback = useCallback(
    (allowPaused = false) => {
      const sectionKey = currentSectionKeyRef.current;
      const audio = audioRef.current;
      if (!sectionKey || !audio) {
        lastSampleRef.current = null;
        return;
      }

      if (!allowPaused && audio.paused) {
        return;
      }

      const observedAt = performance.now();
      const currentTime = audio.currentTime;
      const previous = lastSampleRef.current;

      if (previous) {
        const windowRange = detectContinuousPlaybackWindow({
          previousTime: previous.currentTime,
          currentTime,
          elapsedMs: observedAt - previous.observedAt,
          playbackRate: audio.playbackRate || 1,
        });

        if (windowRange) {
          const durationSeconds = resolveSectionDuration(sectionKey);
          const normalized = normalizeHeardRanges([windowRange], durationSeconds);
          if (normalized.length > 0) {
            pendingRangesRef.current = mergeHeardRanges([
              ...pendingRangesRef.current,
              ...normalized,
            ]);
          }
        }
      }

      lastSampleRef.current = {
        currentTime,
        observedAt,
      };
    },
    [audioRef, resolveSectionDuration],
  );

  useEffect(() => {
    isPlayingRef.current = isPlaying;
  }, [isPlaying]);

  useEffect(() => {
    if (!trackingSectionKey || audioDurationSeconds <= 0) return;
    knownDurationsRef.current[trackingSectionKey] = Math.max(
      1,
      Math.ceil(audioDurationSeconds),
    );
  }, [audioDurationSeconds, trackingSectionKey]);

  useEffect(() => {
    const previousSectionKey = currentSectionKeyRef.current;
    if (trackingSectionKey === previousSectionKey) return;

    samplePlayback(true);
    void flushPendingRanges(previousSectionKey);

    pendingRangesRef.current = [];
    currentSectionKeyRef.current = trackingSectionKey;

    const audio = audioRef.current;
    lastSampleRef.current =
      trackingSectionKey && audio
        ? {
            currentTime: audio.currentTime,
            observedAt: performance.now(),
          }
        : null;
  }, [audioRef, flushPendingRanges, samplePlayback, trackingSectionKey]);

  useEffect(() => {
    const wasPlaying = previousPlayingRef.current;
    previousPlayingRef.current = isPlaying;

    if (!wasPlaying && isPlaying) {
      const audio = audioRef.current;
      lastSampleRef.current =
        currentSectionKeyRef.current && audio
          ? {
              currentTime: audio.currentTime,
              observedAt: performance.now(),
            }
          : null;
      return;
    }

    if (wasPlaying && !isPlaying) {
      samplePlayback(true);
      void flushPendingRanges();
    }
  }, [audioRef, flushPendingRanges, isPlaying, samplePlayback]);

  useEffect(() => {
    if (!trackingSectionKey || !isPlaying || !enabledRef.current) return;

    const intervalId = window.setInterval(() => {
      samplePlayback(false);
    }, SAMPLE_INTERVAL_MS);

    return () => {
      window.clearInterval(intervalId);
    };
  }, [isPlaying, samplePlayback, trackingSectionKey]);

  useEffect(() => {
    if (!trackingSectionKey || !enabledRef.current) return;

    const intervalId = window.setInterval(() => {
      if (isPlayingRef.current) {
        samplePlayback(false);
      }
      if (pendingRangesRef.current.length > 0) {
        void flushPendingRanges();
      }
    }, FLUSH_INTERVAL_MS);

    return () => {
      window.clearInterval(intervalId);
    };
  }, [flushPendingRanges, samplePlayback, trackingSectionKey]);

  useEffect(() => {
    const handlePageExit = () => {
      samplePlayback(true);
      void flushPendingRanges();
    };

    const handleVisibilityChange = () => {
      if (document.visibilityState === "hidden") {
        handlePageExit();
      }
    };

    window.addEventListener("pagehide", handlePageExit);
    document.addEventListener("visibilitychange", handleVisibilityChange);

    return () => {
      document.removeEventListener("visibilitychange", handleVisibilityChange);
      window.removeEventListener("pagehide", handlePageExit);
      handlePageExit();
    };
  }, [flushPendingRanges, samplePlayback]);
};
