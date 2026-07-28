"use client";

import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  type RefObject,
} from "react";
import type { Id } from "@/convex/_generated/dataModel";
import type { Section } from "@/lib/data-context";
import type {
  AwardedBadgeProgress,
  BadgeKey,
  BadgeListenProgressResult,
} from "@/lib/badges";
import {
  getPlayableArticleDurationSeconds,
  getResolvedDurationSeconds,
  type SectionDurationMap,
} from "@/lib/article-audio-duration";
import { buildArticleNarrationTracks } from "@/lib/section-narration";
import {
  detectContinuousPlaybackWindow,
  mergeHeardRanges,
  normalizeHeardRanges,
  type HeardRange,
} from "@/lib/listen-progress";

const SAMPLE_INTERVAL_MS = 1_000;
const FLUSH_INTERVAL_MS = 5_000;
const isLocal = process.env.NEXT_PUBLIC_LOCAL_MODE === "true";
const useBrowserLayoutEffect =
  typeof window === "undefined" ? useEffect : useLayoutEffect;

type ProgressReportArgs = {
  articleId: Id<"articles">;
  wikiPageId: string;
  slug: string;
  title: string;
  totalDurationSeconds: number;
  sectionKey: string;
  sectionDurationSeconds: number;
  heardRanges: HeardRange[];
  listeningSessionStartedAt: number;
  progressStartedAt: number;
};

type ProgressReportContext = Omit<
  ProgressReportArgs,
  "heardRanges" | "listeningSessionStartedAt" | "progressStartedAt"
>;

type ReportProgressFn = (args: ProgressReportArgs) => Promise<unknown>;

const hasSameProgressTarget = (
  left: ProgressReportContext | null,
  right: ProgressReportContext | null,
): boolean =>
  left?.articleId === right?.articleId &&
  left?.wikiPageId === right?.wikiPageId &&
  left?.slug === right?.slug &&
  left?.title === right?.title &&
  left?.sectionKey === right?.sectionKey &&
  left?.totalDurationSeconds === right?.totalDurationSeconds &&
  left?.sectionDurationSeconds === right?.sectionDurationSeconds;

const enqueueProgressBatch = (
  batches: ProgressReportArgs[],
  batch: ProgressReportArgs,
): ProgressReportArgs[] => {
  const existingIndex = batches.findIndex(
    (existing) =>
      hasSameProgressTarget(existing, batch) &&
      existing.listeningSessionStartedAt === batch.listeningSessionStartedAt &&
      existing.progressStartedAt === batch.progressStartedAt,
  );
  if (existingIndex === -1) {
    return [...batches, batch];
  }

  return batches.map((existing, index) =>
    index === existingIndex
      ? {
          ...existing,
          heardRanges: mergeHeardRanges([
            ...existing.heardRanges,
            ...batch.heardRanges,
          ]),
        }
      : existing,
  );
};

type UseBadgeListenTrackingArgs = {
  articleId?: Id<"articles">;
  wikiPageId?: string;
  revisionId?: string;
  narrationVersion?: number;
  slug: string;
  title?: string;
  summaryText?: string;
  sections: Section[];
  sectionDurations?: SectionDurationMap;
  trackingSectionKey: string | null;
  audioDurationSeconds: number;
  isPlaying: boolean;
  enabled?: boolean;
  audioRef: RefObject<HTMLAudioElement | null>;
  reportProgress: ReportProgressFn;
  onBadgesAwarded?: (args: {
    articleTitle: string;
    badges: AwardedBadgeProgress[];
  }) => void;
  resolveAwardedBadges?: (
    awardedBadgeKeys: BadgeKey[],
  ) => Promise<AwardedBadgeProgress[]>;
};

const isUnauthorizedError = (error: unknown): boolean =>
  error instanceof Error && /unauthorized/i.test(error.message);

const coerceBadgeListenProgressResult = (
  value: unknown,
  fallbackTotalDurationSeconds: number,
): BadgeListenProgressResult => {
  const candidate =
    value && typeof value === "object"
      ? (value as Partial<BadgeListenProgressResult>)
      : null;

  return {
    heardSeconds:
      typeof candidate?.heardSeconds === "number" ? candidate.heardSeconds : 0,
    totalDurationSeconds:
      typeof candidate?.totalDurationSeconds === "number"
        ? candidate.totalDurationSeconds
        : fallbackTotalDurationSeconds,
    qualified: candidate?.qualified === true,
    awardedBadgeKeys: Array.isArray(candidate?.awardedBadgeKeys)
      ? candidate.awardedBadgeKeys
      : [],
    awardedBadges: Array.isArray(candidate?.awardedBadges)
      ? candidate.awardedBadges
      : [],
  };
};

export const useBadgeListenTracking = ({
  articleId,
  wikiPageId,
  revisionId,
  narrationVersion,
  slug,
  title,
  summaryText,
  sections,
  sectionDurations,
  trackingSectionKey,
  audioDurationSeconds,
  isPlaying,
  enabled = true,
  audioRef,
  reportProgress,
  onBadgesAwarded,
  resolveAwardedBadges,
}: UseBadgeListenTrackingArgs) => {
  const unauthorizedRef = useRef(false);
  const enabledRef = useRef(!isLocal && enabled);
  const isPlayingRef = useRef(isPlaying);
  const currentSectionKeyRef = useRef<string | null>(trackingSectionKey);
  const pendingBatchRef = useRef<ProgressReportArgs | null>(null);
  const queuedBatchesRef = useRef<ProgressReportArgs[]>([]);
  const activeProgressContextRef = useRef<ProgressReportContext | null>(null);
  const lastSampleRef = useRef<{
    currentTime: number;
    observedAt: number;
  } | null>(null);
  const knownDurationsRef = useRef<Record<string, number>>({});
  const previousPlayingRef = useRef(false);
  const listeningSessionStartedAtRef = useRef<number | null>(null);
  const progressStartedAtRef = useRef<number | null>(null);
  const narrationTracks = useMemo(
    () =>
      buildArticleNarrationTracks({
        title: title ?? slug,
        revisionId,
        narrationVersion,
        summary: summaryText,
        sections,
      }),
    [narrationVersion, revisionId, sections, slug, summaryText, title],
  );

  const resolveSectionText = useCallback(
    (sectionKey: string): string => {
      return (
        narrationTracks.find((track) => track.sectionKey === sectionKey)
          ?.text ?? ""
      );
    },
    [narrationTracks],
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
      getPlayableArticleDurationSeconds(
        {
          title: title ?? slug,
          revisionId,
          narrationVersion,
          summary: summaryText,
          sections,
        },
        {
          ...sectionDurations,
          ...knownDurationsRef.current,
        },
      ),
    [
      narrationVersion,
      revisionId,
      sectionDurations,
      sections,
      slug,
      summaryText,
      title,
    ],
  );

  const createProgressContext = useCallback(
    (sectionKey: string | null): ProgressReportContext | null => {
      if (!articleId || !wikiPageId || !title || !sectionKey) {
        return null;
      }

      return {
        articleId,
        wikiPageId,
        slug,
        title,
        totalDurationSeconds: resolveTotalDuration(),
        sectionKey,
        sectionDurationSeconds: resolveSectionDuration(sectionKey),
      };
    },
    [
      articleId,
      resolveSectionDuration,
      resolveTotalDuration,
      slug,
      title,
      wikiPageId,
    ],
  );

  const flushPendingRanges = useCallback(
    async (sectionKeyOverride?: string | null) => {
      if (!enabledRef.current) {
        pendingBatchRef.current = null;
        queuedBatchesRef.current = [];
        lastSampleRef.current = null;
        listeningSessionStartedAtRef.current = null;
        progressStartedAtRef.current = null;
        return;
      }

      const sectionKey = sectionKeyOverride ?? currentSectionKeyRef.current;
      if (!sectionKey) return;

      const batches = queuedBatchesRef.current.filter(
        (batch) => batch.sectionKey === sectionKey,
      );
      queuedBatchesRef.current = queuedBatchesRef.current.filter(
        (batch) => batch.sectionKey !== sectionKey,
      );
      const pendingBatch = pendingBatchRef.current;
      if (pendingBatch?.sectionKey === sectionKey) {
        batches.push(pendingBatch);
        pendingBatchRef.current = null;
      }
      if (batches.length === 0) return;

      await Promise.all(
        batches.map(async (batch) => {
          try {
            const rawResult = await reportProgress(batch);
            const result = coerceBadgeListenProgressResult(
              rawResult,
              batch.totalDurationSeconds,
            );
            let awardedBadges = result.awardedBadges;

            // Some environments may return the award keys without the expanded
            // badge payload. Fall back to a query so the UI can still show a toast.
            if (
              awardedBadges.length === 0 &&
              result.awardedBadgeKeys.length > 0 &&
              resolveAwardedBadges
            ) {
              awardedBadges = await resolveAwardedBadges(
                result.awardedBadgeKeys,
              );
            }

            if (awardedBadges.length > 0) {
              onBadgesAwarded?.({
                articleTitle: batch.title,
                badges: awardedBadges,
              });
            }
          } catch (error) {
            if (isUnauthorizedError(error)) {
              unauthorizedRef.current = true;
              enabledRef.current = false;
              pendingBatchRef.current = null;
              queuedBatchesRef.current = [];
              lastSampleRef.current = null;
              listeningSessionStartedAtRef.current = null;
              progressStartedAtRef.current = null;
              return;
            }

            if (enabledRef.current) {
              queuedBatchesRef.current = enqueueProgressBatch(
                queuedBatchesRef.current,
                batch,
              );
            }
          }
        }),
      );
    },
    [onBadgesAwarded, reportProgress, resolveAwardedBadges],
  );

  const flushAllPendingRanges = useCallback(async () => {
    const sectionKeys = new Set(
      queuedBatchesRef.current.map((batch) => batch.sectionKey),
    );
    if (pendingBatchRef.current) {
      sectionKeys.add(pendingBatchRef.current.sectionKey);
    }
    await Promise.all(
      [...sectionKeys].map((sectionKey) => flushPendingRanges(sectionKey)),
    );
  }, [flushPendingRanges]);

  const samplePlayback = useCallback(
    (allowPaused = false) => {
      if (!enabledRef.current) {
        pendingBatchRef.current = null;
        lastSampleRef.current = null;
        return;
      }

      const sectionKey = currentSectionKeyRef.current;
      const audio = audioRef.current;
      if (!sectionKey || !audio) {
        lastSampleRef.current = null;
        return;
      }

      if (!allowPaused && audio.paused) {
        return;
      }

      const startedAt = Date.now();
      listeningSessionStartedAtRef.current ??= startedAt;
      progressStartedAtRef.current ??= startedAt;

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
          const normalized = normalizeHeardRanges(
            [windowRange],
            durationSeconds,
          );
          if (normalized.length > 0) {
            const progressContext = activeProgressContextRef.current;
            if (progressContext && progressContext.sectionKey === sectionKey) {
              const pendingBatch = pendingBatchRef.current;
              const nextBatch = {
                ...progressContext,
                heardRanges: normalized,
                listeningSessionStartedAt:
                  listeningSessionStartedAtRef.current ?? startedAt,
                progressStartedAt: progressStartedAtRef.current ?? startedAt,
              };
              if (
                pendingBatch &&
                hasSameProgressTarget(pendingBatch, nextBatch) &&
                pendingBatch.listeningSessionStartedAt ===
                  nextBatch.listeningSessionStartedAt &&
                pendingBatch.progressStartedAt === nextBatch.progressStartedAt
              ) {
                pendingBatchRef.current = {
                  ...pendingBatch,
                  heardRanges: mergeHeardRanges([
                    ...pendingBatch.heardRanges,
                    ...normalized,
                  ]),
                };
              } else {
                if (pendingBatch) {
                  queuedBatchesRef.current = enqueueProgressBatch(
                    queuedBatchesRef.current,
                    pendingBatch,
                  );
                }
                pendingBatchRef.current = {
                  ...progressContext,
                  heardRanges: normalized,
                  listeningSessionStartedAt:
                    listeningSessionStartedAtRef.current ?? startedAt,
                  progressStartedAt: progressStartedAtRef.current ?? startedAt,
                };
              }
            }
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
  const flushPendingRangesRef = useRef(flushPendingRanges);
  const flushAllPendingRangesRef = useRef(flushAllPendingRanges);
  const samplePlaybackRef = useRef(samplePlayback);
  useBrowserLayoutEffect(() => {
    flushPendingRangesRef.current = flushPendingRanges;
    flushAllPendingRangesRef.current = flushAllPendingRanges;
    samplePlaybackRef.current = samplePlayback;
  }, [flushAllPendingRanges, flushPendingRanges, samplePlayback]);

  useEffect(() => {
    isPlayingRef.current = isPlaying;
  }, [isPlaying]);

  useBrowserLayoutEffect(() => {
    if (!enabled) {
      unauthorizedRef.current = false;
    }

    enabledRef.current = !isLocal && enabled && !unauthorizedRef.current;

    if (!enabledRef.current) {
      pendingBatchRef.current = null;
      queuedBatchesRef.current = [];
      activeProgressContextRef.current = null;
      lastSampleRef.current = null;
      listeningSessionStartedAtRef.current = null;
      progressStartedAtRef.current = null;
      return;
    }

    const audio = audioRef.current;
    if (isPlaying && currentSectionKeyRef.current && audio) {
      activeProgressContextRef.current ??= createProgressContext(
        currentSectionKeyRef.current,
      );
      const startedAt = Date.now();
      listeningSessionStartedAtRef.current ??= startedAt;
      progressStartedAtRef.current ??= startedAt;
      lastSampleRef.current = {
        currentTime: audio.currentTime,
        observedAt: performance.now(),
      };
    }
  }, [audioRef, createProgressContext, enabled, isPlaying]);

  useEffect(() => {
    if (!trackingSectionKey || audioDurationSeconds <= 0) return;
    knownDurationsRef.current[trackingSectionKey] = Math.max(
      1,
      Math.ceil(audioDurationSeconds),
    );
  }, [audioDurationSeconds, trackingSectionKey]);

  useEffect(() => {
    const previousSectionKey = currentSectionKeyRef.current;
    const previousProgressContext = activeProgressContextRef.current;
    const nextProgressContext = createProgressContext(trackingSectionKey);
    if (
      trackingSectionKey === previousSectionKey &&
      hasSameProgressTarget(previousProgressContext, nextProgressContext)
    ) {
      activeProgressContextRef.current = nextProgressContext;
      return;
    }

    samplePlayback(true);
    void flushPendingRanges(previousSectionKey);

    currentSectionKeyRef.current = trackingSectionKey;
    activeProgressContextRef.current = nextProgressContext;
    if (enabledRef.current && trackingSectionKey && isPlayingRef.current) {
      listeningSessionStartedAtRef.current ??= Date.now();
    }
    progressStartedAtRef.current =
      enabledRef.current && trackingSectionKey && isPlayingRef.current
        ? Date.now()
        : null;

    const audio = audioRef.current;
    lastSampleRef.current =
      enabledRef.current && trackingSectionKey && audio
        ? {
            currentTime: audio.currentTime,
            observedAt: performance.now(),
          }
        : null;
  }, [
    audioRef,
    createProgressContext,
    flushPendingRanges,
    samplePlayback,
    trackingSectionKey,
  ]);

  useEffect(() => {
    const wasPlaying = previousPlayingRef.current;
    previousPlayingRef.current = isPlaying;

    if (!enabledRef.current) {
      lastSampleRef.current = null;
      return;
    }

    if (!wasPlaying && isPlaying) {
      const startedAt = Date.now();
      listeningSessionStartedAtRef.current ??= startedAt;
      progressStartedAtRef.current ??= startedAt;
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
      listeningSessionStartedAtRef.current = null;
      progressStartedAtRef.current = null;
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
  }, [enabled, isPlaying, samplePlayback, trackingSectionKey]);

  useEffect(() => {
    if (!trackingSectionKey || !enabledRef.current) return;

    const intervalId = window.setInterval(() => {
      if (isPlayingRef.current) {
        samplePlayback(false);
      }
      if (pendingBatchRef.current || queuedBatchesRef.current.length > 0) {
        void flushAllPendingRanges();
      }
    }, FLUSH_INTERVAL_MS);

    return () => {
      window.clearInterval(intervalId);
    };
  }, [enabled, flushAllPendingRanges, samplePlayback, trackingSectionKey]);

  useEffect(() => {
    const handlePageExit = () => {
      samplePlaybackRef.current(true);
      void flushAllPendingRangesRef.current();
      listeningSessionStartedAtRef.current = null;
      progressStartedAtRef.current = null;
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
  }, []);
};
