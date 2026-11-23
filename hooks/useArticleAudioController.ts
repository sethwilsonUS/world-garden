"use client";

import {
  useCallback,
  useEffect,
  useEffectEvent,
  useMemo,
  useRef,
  useState,
} from "react";
import { useConvex, useMutation, useQuery } from "convex/react";
import { api } from "@/convex/_generated/api";
import type { Id } from "@/convex/_generated/dataModel";
import type { Article } from "@/lib/data-context";
import { useArticleAudioExports } from "@/components/ArticleAudioExportProvider";
import { useBadgeProgressToasts } from "@/components/BadgeProgressToastProvider";
import { useAudioElement } from "@/hooks/useAudioElement";
import { useBadgeListenTracking } from "@/hooks/useBadgeListenTracking";
import { useMediaSession } from "@/hooks/useMediaSession";
import {
  formatRate,
  usePlaybackRate,
  type PlaybackRate,
} from "@/hooks/usePlaybackRate";
import { analytics } from "@/lib/analytics";
import { getQuotaFallbackNoticeForPlayback } from "@/lib/audio-fallback-notice";
import {
  awaitSummaryAudioWithMetadata,
  getCachedSummaryAudio,
  preloadAudioUrl,
  primeSummaryAudio,
  warmSummaryAudioFromText,
} from "@/lib/audio-prefetch";
import {
  awaitAudioRequest,
  bucketAudioStartupMs,
  clearAudioRequest,
  createAudioRequestCache,
  getAudioRequestResult,
  primeAudioRequest,
  resolveAudioStartup,
  selectNextWarmQueueItems,
  startAudioRequest,
  type AudioRequestOwner,
  type AudioStartupPath,
  type AudioStartupScope,
  type AudioStartupSource,
} from "@/lib/audio-startup";
import {
  buildCachedTtsResult,
  buildPlayAllQueue,
  createIdleAudioPlayback,
  getAudioRetryTarget,
  type AudioPlaybackMode,
  type AudioPlaybackState,
  type QueueItem,
} from "@/lib/article-audio-playback";
import { buildAwardedBadgeProgress } from "@/lib/badges";
import {
  getPlayAllSecondsRemaining,
  getSectionNavigation,
} from "@/lib/article-section-navigation";
import {
  buildArticleNarrationHash,
  buildArticleNarrationTracks,
} from "@/lib/section-narration";
import { TTS_NORM_VERSION } from "@/lib/tts-normalize";
import type { TtsAudioUrlResult } from "@/lib/tts-client";
import { getTtsMetadata } from "@/lib/tts-profile";
import { useTtsProfile } from "@/lib/tts-audience";
import { generateArticleSectionAudioUrlWithMetadata } from "@/lib/article-section-audio-client";

const PLAY_ALL_WARM_WINDOW = 2;
const PLAY_ALL_PREFETCH_WAIT_TIMEOUT_MS = 5_000;
const SLOW_TTS_LOADING_NUDGE_MS = 8_000;

type ArticleAudioArticle = Article & {
  _id?: string;
};

type GenerateAudio = (
  sectionKey: string,
  label: string,
  sectionIdx: number | null,
  source?: AudioStartupSource,
) => void;

type UpdateProgress = (
  slug: string,
  sectionKey: string,
  sectionIndex: number | null,
) => void;

type UseArticleAudioControllerArgs = {
  claimPlayback?: () => void;
  ownsMediaSession?: boolean;
  slug: string;
  article: ArticleAudioArticle | null;
  badgeTrackingEnabled: boolean;
  updateProgress: UpdateProgress;
};

const getStartupNow = (): number =>
  typeof performance !== "undefined" && typeof performance.now === "function"
    ? performance.now()
    : Date.now();

const awaitAudioResultWithTimeout = (
  promise: Promise<TtsAudioUrlResult | null> | null,
  timeoutMs: number,
): Promise<TtsAudioUrlResult | null> | null => {
  if (!promise) return null;

  let timeoutId: ReturnType<typeof setTimeout> | null = null;
  const timeout = new Promise<null>((resolve) => {
    timeoutId = setTimeout(() => resolve(null), timeoutMs);
  });

  return Promise.race([promise.catch(() => null), timeout]).finally(() => {
    if (timeoutId) clearTimeout(timeoutId);
  });
};

const shouldBypassAudioCacheForStress = (): boolean =>
  process.env.NODE_ENV !== "production" &&
  typeof window !== "undefined" &&
  new URLSearchParams(window.location.search).get("ttsStress") === "1";

const shouldDisableViewportWarmForStress = (): boolean =>
  process.env.NODE_ENV !== "production" &&
  typeof window !== "undefined" &&
  new URLSearchParams(window.location.search).get("ttsStress") === "1" &&
  new URLSearchParams(window.location.search).get("ttsViewportWarm") !== "1";

type NavigatorConnectionLike = {
  saveData?: boolean;
  effectiveType?: string;
};

const canUseViewportAudioWarm = (): boolean => {
  if (typeof navigator === "undefined") return false;
  const connection = (
    navigator as Navigator & {
      connection?: NavigatorConnectionLike;
    }
  ).connection;
  if (connection?.saveData) return false;
  return (
    connection?.effectiveType !== "slow-2g" &&
    connection?.effectiveType !== "2g"
  );
};

export const useArticleAudioController = ({
  slug,
  article,
  badgeTrackingEnabled,
  updateProgress,
  claimPlayback,
  ownsMediaSession = true,
}: UseArticleAudioControllerArgs) => {
  const bypassAudioCacheForStress = shouldBypassAudioCacheForStress();
  const convex = useConvex();
  const { showBadgeProgressToasts } = useBadgeProgressToasts();
  const {
    jobs: articleAudioExports,
    queueExport,
    isStartingArticle,
  } = useArticleAudioExports();
  const { rate: playbackRate, setRate: setPlaybackRate } = usePlaybackRate();
  const activeTtsProfile = useTtsProfile();

  const articleId = article?._id as Id<"articles"> | undefined;
  const activeTtsCacheKey = activeTtsProfile.ttsCacheKey;
  const activeTtsMetadata = useMemo(
    () => getTtsMetadata(activeTtsProfile),
    [activeTtsProfile],
  );
  const narrationTracks = useMemo(
    () => (article ? buildArticleNarrationTracks(article) : []),
    [article],
  );
  const activeNarrationHash = useMemo(
    () => (article ? buildArticleNarrationHash(article) : null),
    [article],
  );
  const summarySourceHash = narrationTracks.find(
    (track) => track.sectionKey === "summary",
  )?.sourceHash;
  const cachedAudio = useQuery(
    api.audio.getAllSectionAudio,
    articleId && activeTtsProfile.provider === "edge"
      ? {
          articleId,
          ttsNormVersion: TTS_NORM_VERSION,
          ttsCacheKey: activeTtsCacheKey,
          sourceHashes: narrationTracks.map(({ sectionKey, sourceHash }) => ({
            sectionKey,
            sourceHash,
          })),
        }
      : "skip",
  );
  const reportBadgeListenProgress = useMutation(
    api.badges.recordViewerArticleListenProgress,
  );

  const [audioError, setAudioError] = useState<string | null>(null);
  const [audioPlayback, setAudioPlayback] = useState<AudioPlaybackState>(
    createIdleAudioPlayback,
  );
  const [audioUrl, setAudioUrl] = useState<string | null>(null);
  // The URL in the element, readable from async completions, and a counter
  // that re-runs autoplay even when a track reloads the URL already there.
  const audioUrlRef = useRef<string | null>(null);
  const [audioLoadId, setAudioLoadId] = useState(0);
  const [pausedForOtherMedia, setPausedForOtherMedia] = useState(false);
  const [finishedPlaying, setFinishedPlaying] = useState(false);
  const [trackingSectionKey, setTrackingSectionKey] = useState<string | null>(
    null,
  );
  const [fallbackVoiceNotice, setFallbackVoiceNotice] = useState<string | null>(
    null,
  );

  const activeSectionIndex = audioPlayback.sectionIdx;
  const isPaused = audioPlayback.status === "paused";
  const isSpeaking =
    audioPlayback.status === "playing" || audioPlayback.status === "paused";
  const isPlayingAll =
    audioPlayback.mode === "play_all" &&
    audioPlayback.status !== "idle" &&
    audioPlayback.status !== "error";

  const requestId = useRef(0);
  const playAllQueue = useRef<QueueItem[]>([]);
  const playbackRateTrackRef = useRef<ReturnType<typeof setTimeout> | null>(
    null,
  );
  const pendingAutoPlay = useRef(false);
  const [warmRegion, setWarmRegion] = useState<HTMLDivElement | null>(null);
  const viewportWarmedArticleKey = useRef<string | null>(null);
  const fallbackNoticeArticleKey = useRef<string | null>(null);
  const activeAudioRequestKey = useRef<string | null>(null);
  const slowLoadingTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const isPlayingAllRef = useRef(isPlayingAll);
  const ttsCache = useRef<Map<string, TtsAudioUrlResult>>(new Map());
  const ttsRequestCache = useRef(createAudioRequestCache());
  const seededStartupPath = useRef<Map<string, AudioStartupPath>>(new Map());
  const activeAudioIdentityRef = useRef<string | null>(null);

  const clearSlowLoadingTimer = useCallback(() => {
    if (!slowLoadingTimer.current) return;
    clearTimeout(slowLoadingTimer.current);
    slowLoadingTimer.current = null;
  }, []);

  const startSlowLoadingTimer = useCallback(
    (currentRequest: number) => {
      clearSlowLoadingTimer();
      slowLoadingTimer.current = setTimeout(() => {
        if (requestId.current !== currentRequest) return;
        setAudioPlayback((current) =>
          current.status === "loading"
            ? { ...current, slowLoading: true }
            : current,
        );
        slowLoadingTimer.current = null;
      }, SLOW_TTS_LOADING_NUDGE_MS);
    },
    [clearSlowLoadingTimer],
  );

  const resetAudioPlayback = useCallback(() => {
    clearSlowLoadingTimer();
    audioUrlRef.current = null;
    setAudioUrl(null);
    setAudioPlayback(createIdleAudioPlayback());
  }, [clearSlowLoadingTimer]);

  const currentArticleExport =
    articleAudioExports.find(
      (job) =>
        job.articleId === articleId &&
        job.narrationHash === activeNarrationHash &&
        job.ttsCacheKey === activeTtsCacheKey &&
        job.ttsProvider === activeTtsProfile.provider,
    ) ?? null;
  const isExportStarting = articleId
    ? isStartingArticle(articleId, activeTtsProfile.provider)
    : false;
  const isExportRunning =
    currentArticleExport?.status === "queued" ||
    currentArticleExport?.status === "running";
  const downloading = isExportStarting || isExportRunning;
  const downloadProgress = downloading
    ? {
        current: currentArticleExport?.completedSectionCount ?? 0,
        total: Math.max(currentArticleExport?.sectionCount ?? 1, 1),
      }
    : { current: 0, total: 0 };
  const downloadStatus = currentArticleExport?.status ?? null;
  const downloadStage = currentArticleExport?.stage ?? null;
  const readyDownloadHref =
    currentArticleExport?.status === "ready"
      ? `/api/article/audio-export/${currentArticleExport._id}?download=1`
      : undefined;

  useEffect(
    () => () => {
      requestId.current += 1;
      clearSlowLoadingTimer();
      if (playbackRateTrackRef.current) {
        clearTimeout(playbackRateTrackRef.current);
        playbackRateTrackRef.current = null;
      }
      if (activeAudioRequestKey.current) {
        clearAudioRequest(
          ttsRequestCache.current,
          activeAudioRequestKey.current,
        );
      }
      activeAudioRequestKey.current = null;
      pendingAutoPlay.current = false;
      isPlayingAllRef.current = false;
    },
    [clearSlowLoadingTimer],
  );

  const generateTtsFromApi = useCallback(
    async (
      text: string,
      sectionKey: string,
      options: { force?: boolean; owner?: AudioRequestOwner } = {},
    ): Promise<TtsAudioUrlResult> => {
      if (!options.force && ttsCache.current.has(sectionKey)) {
        return ttsCache.current.get(sectionKey)!;
      }

      const narrationTrack = narrationTracks.find(
        (track) => track.sectionKey === sectionKey,
      );
      if (!narrationTrack) {
        throw new Error("Article narration changed; refresh and try again.");
      }

      const generationRequestId = requestId.current;
      const requestCache = ttsRequestCache.current;
      const result = await startAudioRequest(
        requestCache,
        sectionKey,
        () =>
          generateArticleSectionAudioUrlWithMetadata({
            slug,
            sectionKey,
            sourceHash: narrationTrack.sourceHash,
            provider: activeTtsProfile.provider,
            localText: text,
          }),
        {
          force: options.force,
          owner: options.owner,
        },
      );

      if (
        requestId.current === generationRequestId &&
        ttsRequestCache.current === requestCache
      ) {
        ttsCache.current.set(sectionKey, result);
      }
      return result;
    },
    [activeTtsProfile.provider, narrationTracks, slug],
  );

  const getTextForSection = useCallback(
    (sectionKey: string): string =>
      narrationTracks.find((track) => track.sectionKey === sectionKey)?.text ??
      "",
    [narrationTracks],
  );

  const getCachedAudioResult = useCallback(
    (sectionKey: string): TtsAudioUrlResult | null => {
      if (bypassAudioCacheForStress) return null;
      return buildCachedTtsResult(
        cachedAudio?.urls[sectionKey],
        cachedAudio?.metadata?.[sectionKey],
        activeTtsMetadata,
      );
    },
    [activeTtsMetadata, bypassAudioCacheForStress, cachedAudio],
  );

  const seedAudioResult = useCallback(
    (
      sectionKey: string,
      result: TtsAudioUrlResult,
      startupPath?: AudioStartupPath,
    ) => {
      ttsCache.current.set(sectionKey, result);
      primeAudioRequest(ttsRequestCache.current, sectionKey, result);
      if (sectionKey === "summary") {
        primeSummaryAudio(slug, result, activeTtsProfile, summarySourceHash);
      }
      preloadAudioUrl(result.url);
      if (startupPath) {
        seededStartupPath.current.set(sectionKey, startupPath);
      }
    },
    [activeTtsProfile, slug, summarySourceHash],
  );

  const seedSummaryAudio = useCallback(
    (result: TtsAudioUrlResult) => {
      seedAudioResult("summary", result);
    },
    [seedAudioResult],
  );

  const showFallbackNoticeForPlayback = useCallback(
    (result: TtsAudioUrlResult) => {
      const notice = getQuotaFallbackNoticeForPlayback({
        articleKey: slug,
        announcedArticleKey: fallbackNoticeArticleKey.current,
        fallbackReason: result.fallbackReason,
      });
      if (!notice) return;
      fallbackNoticeArticleKey.current = notice.articleKey;
      setFallbackVoiceNotice(notice.message);
    },
    [slug],
  );

  const trackAudioStartup = useCallback(
    (
      scope: AudioStartupScope,
      source: AudioStartupSource,
      path: AudioStartupPath,
      result: TtsAudioUrlResult,
      startedAt: number,
    ) => {
      analytics.audioStartup({
        scope,
        source,
        path,
        provider: result.metadata.provider,
        fallback: result.metadata.provider !== activeTtsProfile.provider,
        timing: bucketAudioStartupMs(getStartupNow() - startedAt),
      });
    },
    [activeTtsProfile.provider],
  );

  useEffect(() => {
    const cachedSummary = getCachedAudioResult("summary");
    if (!cachedSummary) return;
    seedSummaryAudio(cachedSummary);
  }, [getCachedAudioResult, seedSummaryAudio]);

  const warmSummaryForIntent = useCallback(() => {
    const memorySummary = ttsCache.current.get("summary");
    if (memorySummary) {
      seedSummaryAudio(memorySummary);
      return;
    }

    const convexSummary = getCachedAudioResult("summary");
    if (convexSummary) {
      seedSummaryAudio(convexSummary);
      return;
    }

    const prefetchedSummary = getCachedSummaryAudio(
      slug,
      activeTtsProfile,
      summarySourceHash,
    );
    if (prefetchedSummary) {
      seedSummaryAudio(prefetchedSummary);
      return;
    }

    const summaryText = getTextForSection("summary");
    if (!summaryText) return;

    const warmRequestId = requestId.current;
    warmSummaryAudioFromText(
      slug,
      summaryText,
      activeTtsProfile,
      summarySourceHash,
    )
      .then((result) => {
        if (result && requestId.current === warmRequestId) {
          seedSummaryAudio(result);
        }
      })
      .catch(() => {});
  }, [
    activeTtsProfile,
    getCachedAudioResult,
    getTextForSection,
    seedSummaryAudio,
    slug,
    summarySourceHash,
  ]);

  const warmAudioForSection = useCallback(
    async (sectionKey: string): Promise<TtsAudioUrlResult | null> => {
      const memoryAudio = ttsCache.current.get(sectionKey);
      if (memoryAudio) {
        primeAudioRequest(ttsRequestCache.current, sectionKey, memoryAudio);
        preloadAudioUrl(memoryAudio.url);
        return memoryAudio;
      }

      const convexAudio = getCachedAudioResult(sectionKey);
      if (convexAudio) {
        seedAudioResult(sectionKey, convexAudio, "convex");
        return convexAudio;
      }

      const requestResult = getAudioRequestResult(
        ttsRequestCache.current,
        sectionKey,
      );
      if (requestResult) return requestResult;

      const text = getTextForSection(sectionKey);
      if (!text) return null;

      try {
        const warmRequestId = requestId.current;
        const result = await generateTtsFromApi(text, sectionKey, {
          owner: "warm",
        });
        if (requestId.current !== warmRequestId) return null;
        seedAudioResult(sectionKey, result, "prefetch");
        return result;
      } catch {
        seededStartupPath.current.delete(sectionKey);
        return null;
      }
    },
    [
      generateTtsFromApi,
      getCachedAudioResult,
      getTextForSection,
      seedAudioResult,
    ],
  );

  const hasWarmAudioCached = useCallback(
    (sectionKey: string): boolean => {
      if (ttsCache.current.has(sectionKey)) return true;
      if (getAudioRequestResult(ttsRequestCache.current, sectionKey))
        return true;
      if (
        sectionKey === "summary" &&
        getCachedSummaryAudio(slug, activeTtsProfile, summarySourceHash)
      ) {
        return true;
      }
      return getCachedAudioResult(sectionKey) !== null;
    },
    [activeTtsProfile, getCachedAudioResult, slug, summarySourceHash],
  );

  const warmPlayAllQueue = useCallback(
    (queue: QueueItem[]) => {
      for (const item of selectNextWarmQueueItems(
        queue,
        PLAY_ALL_WARM_WINDOW,
      )) {
        void warmAudioForSection(item.sectionKey);
      }
    },
    [warmAudioForSection],
  );

  const warmPlayAllForIntent = useCallback(() => {
    warmSummaryForIntent();
    if (!article) return;
    warmPlayAllQueue(buildPlayAllQueue(article));
  }, [article, warmPlayAllQueue, warmSummaryForIntent]);

  const audioEndedRef = useRef<() => void>(() => {});
  const generateAudioRef = useRef<GenerateAudio>(() => {});

  const {
    audioRef,
    playing: audioElPlaying,
    currentTime: audioElCurrentTime,
    duration: audioElDuration,
    play: audioElPlay,
    pause: audioElPause,
    seek: audioElSeek,
    skip: audioElSkip,
  } = useAudioElement({
    url: audioUrl,
    onEnded: () => audioEndedRef.current(),
    onPlayingChange: (playing) => {
      if (playing) {
        setPausedForOtherMedia(false);
        clearSlowLoadingTimer();
        setAudioPlayback((current) =>
          current.status === "idle" || current.status === "error"
            ? current
            : { ...current, status: "playing", slowLoading: false },
        );
      } else {
        setAudioPlayback((current) =>
          current.status === "playing"
            ? { ...current, status: "paused", slowLoading: false }
            : current,
        );
      }
    },
    playbackRate,
  });

  useEffect(() => {
    isPlayingAllRef.current = isPlayingAll;
  }, [isPlayingAll]);

  /**
   * Put a track's audio in the element. Returning to the URL that is already
   * loaded (Next, then Previous before the next section arrives) changes no
   * state, so start it from the beginning and count the load to re-run the
   * autoplay effect.
   */
  const loadAudioUrl = useCallback(
    (url: string) => {
      if (audioUrlRef.current === url) audioElSeek(0);
      audioUrlRef.current = url;
      setAudioUrl(url);
      setAudioLoadId((id) => id + 1);
    },
    [audioElSeek],
  );

  const pauseForOtherMedia = useCallback(() => {
    setPausedForOtherMedia(true);
    audioElPause();
  }, [audioElPause]);

  const startReadyAudio = useEffectEvent((audio: HTMLAudioElement) => {
    const currentRequest = requestId.current;
    const leavePaused = () => {
      if (requestId.current !== currentRequest) return;
      clearSlowLoadingTimer();
      setAudioPlayback((current) =>
        current.status === "loading" || current.status === "playing"
          ? { ...current, status: "paused", slowLoading: false }
          : current,
      );
    };

    // A sample or podcast can start while this track is still generating.
    // Keep the resulting source and queue ready for an explicit resume.
    if (pausedForOtherMedia) leavePaused();
    else audio.play()?.catch(leavePaused);
  });

  useEffect(() => {
    if (!audioUrl || !pendingAutoPlay.current) return;
    pendingAutoPlay.current = false;
    if (audioRef.current) startReadyAudio(audioRef.current);

    if (isPlayingAll && playAllQueue.current.length > 0) {
      warmPlayAllQueue(playAllQueue.current);
    }
  }, [audioLoadId, audioUrl, audioRef, isPlayingAll, warmPlayAllQueue]);

  const activeAudioIdentity = activeNarrationHash
    ? `${activeNarrationHash}::${activeTtsCacheKey}`
    : null;

  useEffect(() => {
    if (
      activeAudioIdentityRef.current &&
      activeAudioIdentityRef.current !== activeAudioIdentity
    ) {
      requestId.current += 1;
      clearSlowLoadingTimer();
      ttsCache.current.clear();
      ttsRequestCache.current = createAudioRequestCache();
      seededStartupPath.current.clear();
      playAllQueue.current = [];
      activeAudioRequestKey.current = null;
      pendingAutoPlay.current = false;
      isPlayingAllRef.current = false;
      viewportWarmedArticleKey.current = null;
      fallbackNoticeArticleKey.current = null;
      setTrackingSectionKey(null);
      setAudioError(null);
      setFallbackVoiceNotice(null);
      setFinishedPlaying(false);
      audioRef.current?.pause();
      resetAudioPlayback();
    }
    activeAudioIdentityRef.current = activeAudioIdentity;
  }, [
    activeAudioIdentity,
    audioRef,
    clearSlowLoadingTimer,
    resetAudioPlayback,
  ]);

  useEffect(() => {
    if (!article) return;
    if (shouldDisableViewportWarmForStress()) return;
    if (!canUseViewportAudioWarm()) return;
    const viewportWarmKey = `${activeTtsCacheKey}::${slug}`;
    if (viewportWarmedArticleKey.current === viewportWarmKey) return;
    if (typeof IntersectionObserver === "undefined") return;

    if (!warmRegion) return;

    const observer = new IntersectionObserver(
      (entries) => {
        if (!entries.some((entry) => entry.isIntersecting)) return;

        observer.disconnect();
        viewportWarmedArticleKey.current = viewportWarmKey;

        const queue = buildPlayAllQueue(article);
        const firstSection = queue.find((item) => item.sectionIdx !== null);
        const summaryText = article.summary ?? "";
        const firstSectionText = firstSection
          ? getTextForSection(firstSection.sectionKey)
          : "";

        if (!summaryText.trim() && !firstSectionText.trim()) return;

        const warmTargets = [
          summaryText.trim() ? "summary" : null,
          firstSection && firstSectionText.trim()
            ? firstSection.sectionKey
            : null,
        ].filter((sectionKey): sectionKey is string => sectionKey !== null);

        if (warmTargets.length === 0) return;
        if (warmTargets.every((sectionKey) => hasWarmAudioCached(sectionKey))) {
          return;
        }

        if (summaryText.trim() && !hasWarmAudioCached("summary")) {
          warmSummaryForIntent();
        }
        if (firstSection && !hasWarmAudioCached(firstSection.sectionKey)) {
          void warmAudioForSection(firstSection.sectionKey);
        }
      },
      { rootMargin: "160px 0px" },
    );

    observer.observe(warmRegion);
    return () => observer.disconnect();
  }, [
    article,
    activeTtsCacheKey,
    getTextForSection,
    hasWarmAudioCached,
    slug,
    warmAudioForSection,
    warmSummaryForIntent,
    warmRegion,
  ]);

  const generateAudio = useCallback(
    (
      sectionKey: string,
      label: string,
      sectionIdx: number | null,
      source: AudioStartupSource = sectionKey === "summary"
        ? "summary"
        : "section",
    ) => {
      const currentRequest = ++requestId.current;
      const startupStartedAt = getStartupNow();
      const scope: AudioStartupScope =
        sectionKey === "summary" ? "summary" : "section";
      const playbackMode: AudioPlaybackMode =
        source === "play_all" || source === "auto_next" ? "play_all" : "single";
      const narrationTrack = narrationTracks.find(
        (track) => track.sectionKey === sectionKey,
      );

      if (
        narrationTrack &&
        !narrationTrack.individuallyPlayable &&
        source !== "play_all" &&
        source !== "auto_next"
      ) {
        setAudioError("Section is not available for audio.");
        setAudioPlayback({
          status: "error",
          sectionKey,
          sectionIdx,
          label,
          mode: playbackMode,
          slowLoading: false,
        });
        return;
      }

      if (source !== "auto_next") {
        setPausedForOtherMedia(false);
        claimPlayback?.();
      }
      const previousRequestKey = activeAudioRequestKey.current;
      if (previousRequestKey && previousRequestKey !== sectionKey) {
        clearAudioRequest(ttsRequestCache.current, previousRequestKey);
      }
      activeAudioRequestKey.current = sectionKey;
      setAudioError(null);
      setAudioPlayback({
        status: "loading",
        sectionKey,
        sectionIdx,
        label,
        mode: playbackMode,
        slowLoading: false,
      });
      setTrackingSectionKey(
        narrationTrack?.countsTowardProgress === false ? null : sectionKey,
      );
      setFinishedPlaying(false);
      if (narrationTrack?.countsTowardProgress !== false) {
        updateProgress(slug, sectionKey, sectionIdx);
      }

      const memoryCached = ttsCache.current.get(sectionKey);
      if (memoryCached) {
        const startupPath =
          seededStartupPath.current.get(sectionKey) ?? "memory";
        seededStartupPath.current.delete(sectionKey);
        showFallbackNoticeForPlayback(memoryCached);
        loadAudioUrl(memoryCached.url);
        pendingAutoPlay.current = true;
        trackAudioStartup(
          scope,
          source,
          startupPath,
          memoryCached,
          startupStartedAt,
        );
        return;
      }

      const convexCached = getCachedAudioResult(sectionKey);
      if (convexCached) {
        seedAudioResult(sectionKey, convexCached);
        showFallbackNoticeForPlayback(convexCached);
        loadAudioUrl(convexCached.url);
        pendingAutoPlay.current = true;
        trackAudioStartup(
          scope,
          source,
          "convex",
          convexCached,
          startupStartedAt,
        );
        return;
      }

      const textContent = getTextForSection(sectionKey);
      if (!textContent) {
        setAudioError("Section does not contain source text to read aloud.");
        setAudioPlayback({
          status: "error",
          sectionKey,
          sectionIdx,
          label,
          mode: playbackMode,
          slowLoading: false,
        });
        return;
      }

      startSlowLoadingTimer(currentRequest);
      pendingAutoPlay.current = true;

      const finishWithAudio = (
        path: AudioStartupPath,
        result: TtsAudioUrlResult,
      ) => {
        if (requestId.current !== currentRequest) return;
        clearSlowLoadingTimer();
        seedAudioResult(sectionKey, result);
        seededStartupPath.current.delete(sectionKey);
        showFallbackNoticeForPlayback(result);
        loadAudioUrl(result.url);
        trackAudioStartup(scope, source, path, result, startupStartedAt);
      };

      const prefetchedAudio =
        sectionKey === "summary"
          ? (getCachedSummaryAudio(slug, activeTtsProfile, summarySourceHash) ??
            getAudioRequestResult(ttsRequestCache.current, sectionKey))
          : getAudioRequestResult(ttsRequestCache.current, sectionKey);
      const inflightAudio =
        sectionKey === "summary"
          ? (awaitAudioResultWithTimeout(
              awaitSummaryAudioWithMetadata(
                slug,
                activeTtsProfile,
                summarySourceHash,
              ),
              PLAY_ALL_PREFETCH_WAIT_TIMEOUT_MS,
            ) ??
            awaitAudioRequest(ttsRequestCache.current, sectionKey, {
              staleAfterMs: PLAY_ALL_PREFETCH_WAIT_TIMEOUT_MS,
              clearOnTimeout: true,
            }))
          : awaitAudioRequest(ttsRequestCache.current, sectionKey, {
              staleAfterMs: PLAY_ALL_PREFETCH_WAIT_TIMEOUT_MS,
              clearOnTimeout: true,
            });

      resolveAudioStartup({
        memory: null,
        convex: null,
        prefetched: prefetchedAudio,
        inflight: inflightAudio,
        generate: () =>
          generateTtsFromApi(textContent, sectionKey, {
            force:
              isPlayingAllRef.current &&
              (source === "play_all" || source === "auto_next"),
          }),
      })
        .then(({ path, result }) => {
          finishWithAudio(path, result);
        })
        .catch((error) => {
          if (requestId.current !== currentRequest) return;
          clearSlowLoadingTimer();
          seededStartupPath.current.delete(sectionKey);
          clearAudioRequest(ttsRequestCache.current, sectionKey);
          pendingAutoPlay.current = false;

          if (isPlayingAllRef.current) {
            const next = playAllQueue.current.shift();
            if (next) {
              generateAudioRef.current(
                next.sectionKey,
                next.label,
                next.sectionIdx,
                "auto_next",
              );
              return;
            }

            isPlayingAllRef.current = false;
            activeAudioRequestKey.current = null;
            setTrackingSectionKey(null);
            resetAudioPlayback();
            setFinishedPlaying(true);
            return;
          }

          setAudioPlayback({
            status: "error",
            sectionKey,
            sectionIdx,
            label,
            mode: playbackMode,
            slowLoading: false,
          });
          setAudioError(
            error instanceof Error ? error.message : "Audio generation failed",
          );
        });
    },
    [
      activeTtsProfile,
      claimPlayback,
      clearSlowLoadingTimer,
      generateTtsFromApi,
      getCachedAudioResult,
      getTextForSection,
      loadAudioUrl,
      narrationTracks,
      resetAudioPlayback,
      seedAudioResult,
      showFallbackNoticeForPlayback,
      slug,
      startSlowLoadingTimer,
      summarySourceHash,
      trackAudioStartup,
      updateProgress,
    ],
  );

  useEffect(() => {
    generateAudioRef.current = generateAudio;
  }, [generateAudio]);

  const handleAudioEnded = useCallback(() => {
    if (isPlayingAll && playAllQueue.current.length > 0) {
      const next = playAllQueue.current.shift()!;
      generateAudio(next.sectionKey, next.label, next.sectionIdx, "auto_next");
      return;
    }

    activeAudioRequestKey.current = null;
    pendingAutoPlay.current = false;
    setTrackingSectionKey(null);
    resetAudioPlayback();
    if (isPlayingAll) {
      setFinishedPlaying(true);
    }
  }, [generateAudio, isPlayingAll, resetAudioPlayback]);

  useEffect(() => {
    audioEndedRef.current = handleAudioEnded;
  });

  const handlePlayAll = useCallback(() => {
    if (!article) return;
    const summaryOnly = narrationTracks.every(
      (track) => track.mode === "summary",
    );
    analytics.playAll(summaryOnly ? "summary" : "full");
    const queue = buildPlayAllQueue(article);
    if (queue.length === 0) return;
    warmPlayAllQueue(queue);

    const first = queue.shift()!;
    playAllQueue.current = queue;
    isPlayingAllRef.current = true;
    generateAudio(first.sectionKey, first.label, first.sectionIdx, "play_all");
  }, [article, generateAudio, narrationTracks, warmPlayAllQueue]);

  const handleStopPlayAll = useCallback(() => {
    requestId.current += 1;
    if (activeAudioRequestKey.current) {
      clearAudioRequest(ttsRequestCache.current, activeAudioRequestKey.current);
    }
    activeAudioRequestKey.current = null;
    playAllQueue.current = [];
    pendingAutoPlay.current = false;
    isPlayingAllRef.current = false;
    setTrackingSectionKey(null);
    resetAudioPlayback();
    audioElPause();
  }, [audioElPause, resetAudioPlayback]);

  const handleSkipSection = useCallback(() => {
    if (!isPlayingAll) return;
    requestId.current += 1;
    if (activeAudioRequestKey.current) {
      clearAudioRequest(ttsRequestCache.current, activeAudioRequestKey.current);
    }
    activeAudioRequestKey.current = null;
    pendingAutoPlay.current = false;
    clearSlowLoadingTimer();
    // Skipping is an explicit request to hear this article again.
    setPausedForOtherMedia(false);
    audioElPause();
    if (playAllQueue.current.length > 0) {
      const next = playAllQueue.current.shift()!;
      // "auto_next" does not claim on its own; a listener's skip does.
      claimPlayback?.();
      generateAudio(next.sectionKey, next.label, next.sectionIdx, "auto_next");
    } else {
      isPlayingAllRef.current = false;
      setTrackingSectionKey(null);
      resetAudioPlayback();
      setFinishedPlaying(true);
    }
  }, [
    audioElPause,
    claimPlayback,
    clearSlowLoadingTimer,
    generateAudio,
    isPlayingAll,
    resetAudioPlayback,
  ]);

  const sectionNavigation = useMemo(
    () => getSectionNavigation(narrationTracks, audioPlayback.sectionKey),
    [audioPlayback.sectionKey, narrationTracks],
  );

  /**
   * Start a different track from the player. Play all keeps going from the
   * new place; a single section stays a single section.
   */
  const navigateToTrack = useCallback(
    (trackIndex: number, continuePlayAll: boolean) => {
      const target = narrationTracks[trackIndex];
      if (!target) return;
      requestId.current += 1;
      if (activeAudioRequestKey.current) {
        clearAudioRequest(
          ttsRequestCache.current,
          activeAudioRequestKey.current,
        );
      }
      activeAudioRequestKey.current = null;
      pendingAutoPlay.current = false;
      clearSlowLoadingTimer();
      // Choosing a section is an explicit request to hear this article.
      setPausedForOtherMedia(false);
      audioElPause();

      if (continuePlayAll) {
        playAllQueue.current = narrationTracks
          .slice(trackIndex + 1)
          .map((track) => ({ ...track, label: track.title }));
        isPlayingAllRef.current = true;
        claimPlayback?.();
        generateAudio(
          target.sectionKey,
          target.title,
          target.sectionIdx,
          "auto_next",
        );
        return;
      }

      playAllQueue.current = [];
      isPlayingAllRef.current = false;
      generateAudio(
        target.sectionKey,
        target.title,
        target.sectionIdx,
        target.sectionKey === "summary" ? "summary" : "section",
      );
    },
    [
      audioElPause,
      claimPlayback,
      clearSlowLoadingTimer,
      generateAudio,
      narrationTracks,
    ],
  );

  const handlePreviousSection = useCallback(() => {
    const { previousIndex, previousStartIndex } = sectionNavigation;
    if (previousIndex === null) return;
    if (isPlayingAll) navigateToTrack(previousStartIndex ?? previousIndex, true);
    else navigateToTrack(previousIndex, false);
  }, [isPlayingAll, navigateToTrack, sectionNavigation]);

  const handleNextSection = useCallback(() => {
    // Play all already has its queue; skipping past the end finishes it.
    if (isPlayingAll) {
      handleSkipSection();
      return;
    }
    const { nextIndex } = sectionNavigation;
    if (nextIndex !== null) navigateToTrack(nextIndex, false);
  }, [handleSkipSection, isPlayingAll, navigateToTrack, sectionNavigation]);

  const canGoToPreviousSection = sectionNavigation.previousIndex !== null;
  const canGoToNextSection =
    isPlayingAll || sectionNavigation.nextIndex !== null;

  const navigationTarget = (trackIndex: number | null) => {
    const track = trackIndex === null ? undefined : narrationTracks[trackIndex];
    if (!track) return null;
    return {
      sectionKey: track.sectionKey,
      title:
        track.sectionIdx === null
          ? "Summary"
          : (article?.sections?.[track.sectionIdx]?.title ?? track.title),
    };
  };

  const playAllSecondsRemaining = isPlayingAll
    ? getPlayAllSecondsRemaining({
        tracks: narrationTracks,
        sectionKey: audioPlayback.sectionKey,
        // The element still holds the previous track while the next loads.
        currentTime:
          audioPlayback.status === "loading" ? 0 : audioElCurrentTime,
        duration:
          audioPlayback.status === "loading" ? Number.NaN : audioElDuration,
        durations: cachedAudio?.durations,
        playbackRate,
      })
    : null;

  const mediaSessionTitle =
    isSpeaking || audioElPlaying
      ? (audioPlayback.label ??
        (activeSectionIndex != null && article?.sections?.[activeSectionIndex]
          ? `${article.sections[activeSectionIndex].title} — ${article.title}`
          : article
            ? `Summary — ${article.title}`
            : null))
      : null;

  useMediaSession({
    enabled:
      ownsMediaSession &&
      !pausedForOtherMedia &&
      audioPlayback.status !== "error",
    title: mediaSessionTitle,
    artworkUrl: article?.thumbnailUrl,
    playing: audioElPlaying,
    currentTime: audioElCurrentTime,
    duration: audioElDuration,
    playbackRate,
    onPlay: audioElPlay,
    onPause: audioElPause,
    onSeekForward: () => audioElSkip(10),
    onSeekBackward: () => audioElSkip(-10),
    onSeekTo: audioElSeek,
    onStop: handleStopPlayAll,
    onPreviousTrack: canGoToPreviousSection ? handlePreviousSection : undefined,
    onNextTrack: canGoToNextSection ? handleNextSection : undefined,
  });

  useBadgeListenTracking({
    enabled: badgeTrackingEnabled,
    articleId,
    wikiPageId: article?.wikiPageId,
    revisionId: article?.revisionId,
    narrationVersion: article?.narrationVersion,
    slug,
    title: article?.title,
    summaryText: article?.summary,
    sections: article?.sections ?? [],
    sectionDurations: cachedAudio?.durations,
    trackingSectionKey,
    audioDurationSeconds: audioElDuration,
    isPlaying: audioElPlaying,
    audioRef,
    reportProgress: reportBadgeListenProgress,
    resolveAwardedBadges: async (awardedBadgeKeys) => {
      const viewerBadgeProgress = await convex.query(
        api.badges.getViewerBadgeProgress,
        {},
      );

      return viewerBadgeProgress.badges
        .filter((badge) => awardedBadgeKeys.includes(badge.key))
        .map((badge) => buildAwardedBadgeProgress(badge.key, badge.exp));
    },
    onBadgesAwarded: ({ articleTitle, badges }) => {
      showBadgeProgressToasts({ articleTitle, badges });
    },
  });

  const handlePlaybackRateChange = useCallback(
    (rate: PlaybackRate) => {
      setPlaybackRate(rate);
      if (playbackRateTrackRef.current) {
        clearTimeout(playbackRateTrackRef.current);
      }
      playbackRateTrackRef.current = setTimeout(() => {
        analytics.playbackSpeed(formatRate(rate));
        playbackRateTrackRef.current = null;
      }, 2_000);
    },
    [setPlaybackRate],
  );

  const handleTogglePlayAll = useCallback(() => {
    if (isPaused) {
      audioElPlay();
      setAudioPlayback((current) =>
        current.status === "paused"
          ? { ...current, status: "playing", slowLoading: false }
          : current,
      );
    } else {
      audioElPause();
      setAudioPlayback((current) =>
        current.status === "playing"
          ? { ...current, status: "paused", slowLoading: false }
          : current,
      );
    }
  }, [audioElPause, audioElPlay, isPaused]);

  const handleListenSection = useCallback(
    (index: number) => {
      if (!article) return;
      if (activeSectionIndex === index && isSpeaking) {
        if (audioElPlaying) {
          audioElPause();
          setAudioPlayback((current) =>
            current.status === "playing"
              ? { ...current, status: "paused", slowLoading: false }
              : current,
          );
        } else {
          audioElPlay();
          setAudioPlayback((current) =>
            current.status === "paused"
              ? { ...current, status: "playing", slowLoading: false }
              : current,
          );
        }
        return;
      }
      playAllQueue.current = [];
      isPlayingAllRef.current = false;
      pendingAutoPlay.current = false;
      clearSlowLoadingTimer();
      audioElPause();
      analytics.listenSection();
      const section = (article.sections ?? [])[index];
      if (!section) return;
      generateAudio(
        `section-${index}`,
        `${section.title} — ${article.title}`,
        index,
        "section",
      );
    },
    [
      activeSectionIndex,
      article,
      audioElPause,
      audioElPlay,
      audioElPlaying,
      clearSlowLoadingTimer,
      generateAudio,
      isSpeaking,
    ],
  );

  const handleListenSummary = useCallback(() => {
    if (!article) return;
    warmSummaryForIntent();
    if (audioPlayback.sectionKey === "summary" && isSpeaking) {
      if (audioElPlaying) {
        audioElPause();
        setAudioPlayback((current) =>
          current.status === "playing"
            ? { ...current, status: "paused", slowLoading: false }
            : current,
        );
      } else {
        audioElPlay();
        setAudioPlayback((current) =>
          current.status === "paused"
            ? { ...current, status: "playing", slowLoading: false }
            : current,
        );
      }
      return;
    }
    playAllQueue.current = [];
    isPlayingAllRef.current = false;
    pendingAutoPlay.current = false;
    clearSlowLoadingTimer();
    audioElPause();
    analytics.listenSection();
    generateAudio("summary", `${article.title} — Summary`, null, "summary");
  }, [
    article,
    audioElPause,
    audioElPlay,
    audioElPlaying,
    audioPlayback.sectionKey,
    clearSlowLoadingTimer,
    generateAudio,
    isSpeaking,
    warmSummaryForIntent,
  ]);

  const handleWarmSection = useCallback(
    (index: number) => {
      void warmAudioForSection(`section-${index}`);
    },
    [warmAudioForSection],
  );

  const handleDownloadAll = useCallback(async () => {
    if (!article || !articleId || downloading) return;
    const summaryOnly = narrationTracks.every(
      (track) => track.mode === "summary",
    );
    analytics.downloadAll(summaryOnly ? "summary" : "full");

    try {
      await queueExport({ articleId, title: article.title });
    } catch (error) {
      setAudioError(
        error instanceof Error
          ? error.message
          : "Could not queue article download",
      );
    }
  }, [article, articleId, downloading, narrationTracks, queueExport]);

  const handleRetry = useCallback(() => {
    if (!article) return;
    const target = getAudioRetryTarget(audioPlayback, article.title);
    if (target.sectionKey === "summary") {
      warmSummaryForIntent();
    }
    generateAudio(target.sectionKey, target.label, target.sectionIdx, "retry");
  }, [article, audioPlayback, generateAudio, warmSummaryForIntent]);

  const handleResume = useCallback(
    (sectionKey: string, sectionIndex: number | null) => {
      if (!article) return;
      const requestedSection =
        sectionIndex !== null ? (article.sections ?? [])[sectionIndex] : null;
      const requestedTrack = narrationTracks.find(
        (track) => track.sectionKey === sectionKey,
      );
      const nextPlayableTrack =
        requestedTrack && !requestedTrack.individuallyPlayable
          ? narrationTracks.find(
              (track) =>
                track.sectionIdx !== null &&
                track.sectionIdx > (sectionIndex ?? -1) &&
                track.individuallyPlayable,
            )
          : requestedTrack;
      const index =
        requestedSection && nextPlayableTrack?.individuallyPlayable
          ? nextPlayableTrack.sectionIdx
          : null;
      const section = index !== null ? (article.sections ?? [])[index] : null;
      const label = section
        ? `${section.title} — ${article.title}`
        : `${article.title} — Summary`;
      if (index === null) {
        warmSummaryForIntent();
      }
      generateAudio(
        index !== null ? nextPlayableTrack!.sectionKey : "summary",
        label,
        index,
        "resume",
      );
    },
    [article, generateAudio, narrationTracks, warmSummaryForIntent],
  );

  const handleStartFromBeginning = useCallback(() => {
    if (!article) return;
    warmSummaryForIntent();
    generateAudio("summary", `${article.title} — Summary`, null, "start_over");
  }, [article, generateAudio, warmSummaryForIntent]);

  const retryTarget = getAudioRetryTarget(
    audioPlayback,
    article?.title ?? "Article",
  );

  return {
    state: {
      playback: audioPlayback,
      error: audioError,
      retryLabel: retryTarget.ariaLabel,
      fallbackVoiceNotice,
      finishedPlaying,
      playbackRate,
      sectionDurations: cachedAudio?.durations,
      navigation: {
        position: sectionNavigation.position,
        previous: navigationTarget(sectionNavigation.previousIndex),
        next: navigationTarget(sectionNavigation.nextIndex),
        canGoToPrevious: canGoToPreviousSection,
        canGoToNext: canGoToNextSection,
        playAllSecondsRemaining,
      },
      audioProgress: audioUrl
        ? { currentTime: audioElCurrentTime, duration: audioElDuration }
        : undefined,
      download: {
        href: readyDownloadHref,
        downloading,
        progress: downloadProgress,
        status: downloadStatus,
        stage: downloadStage,
      },
    },
    actions: {
      listenSection: handleListenSection,
      listenSummary: handleListenSummary,
      playAll: handlePlayAll,
      warmPlayAll: warmPlayAllForIntent,
      warmSummary: warmSummaryForIntent,
      warmSection: handleWarmSection,
      stopPlayAll: handleStopPlayAll,
      pauseForOtherMedia,
      togglePlayAll: handleTogglePlayAll,
      skipSection: handleSkipSection,
      previousSection: handlePreviousSection,
      nextSection: handleNextSection,
      downloadAll: handleDownloadAll,
      retry: handleRetry,
      resume: handleResume,
      startFromBeginning: handleStartFromBeginning,
      changePlaybackRate: handlePlaybackRateChange,
      seek: audioElSeek,
      skipBy: audioElSkip,
      togglePlayback: handleTogglePlayAll,
    },
    audioElement: {
      ref: audioRef,
      src: audioUrl,
      warmRegionRef: setWarmRegion,
    },
  } as const;
};
