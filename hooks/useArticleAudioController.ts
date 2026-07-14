"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { useConvex, useMutation, useQuery } from "convex/react";
import { api } from "@/convex/_generated/api";
import type { Id } from "@/convex/_generated/dataModel";
import type { Article, Section } from "@/lib/data-context";
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
import { hasFullAudio } from "@/lib/audio-suitability";
import { buildAwardedBadgeProgress } from "@/lib/badges";
import { TTS_NORM_VERSION } from "@/lib/tts-normalize";
import {
  generateTtsAudioUrlWithMetadata,
  type TtsAudioUrlResult,
} from "@/lib/tts-client";
import {
  getActiveTtsCacheKey,
  getActiveTtsProfile,
  type TtsMetadata,
} from "@/lib/tts-profile";

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
  slug: string;
  article: ArticleAudioArticle | null;
  badgeTrackingEnabled: boolean;
  updateProgress: UpdateProgress;
  shouldFocusPlayAll: boolean;
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
  const connection = (navigator as Navigator & {
    connection?: NavigatorConnectionLike;
  }).connection;
  if (connection?.saveData) return false;
  return connection?.effectiveType !== "slow-2g" && connection?.effectiveType !== "2g";
};

export const useArticleAudioController = ({
  slug,
  article,
  badgeTrackingEnabled,
  updateProgress,
  shouldFocusPlayAll,
}: UseArticleAudioControllerArgs) => {
  const bypassAudioCacheForStress = shouldBypassAudioCacheForStress();
  const convex = useConvex();
  const { showBadgeProgressToasts } = useBadgeProgressToasts();
  const { jobs: articleAudioExports, queueExport, isStartingArticle } =
    useArticleAudioExports();
  const { rate: playbackRate, setRate: setPlaybackRate } = usePlaybackRate();

  const articleId = article?._id as Id<"articles"> | undefined;
  const activeTtsCacheKey = getActiveTtsCacheKey();
  const cachedAudio = useQuery(
    api.audio.getAllSectionAudio,
    articleId
      ? {
          articleId,
          ttsNormVersion: TTS_NORM_VERSION,
          ttsCacheKey: activeTtsCacheKey,
        }
      : "skip",
  );
  const getUploadUrl = useMutation(api.audio.generateUploadUrl);
  const saveAudioRecord = useMutation(api.audio.saveSectionAudioRecord);
  const reportBadgeListenProgress = useMutation(
    api.badges.recordViewerArticleListenProgress,
  );

  const [audioError, setAudioError] = useState<string | null>(null);
  const [audioPlayback, setAudioPlayback] = useState<AudioPlaybackState>(
    createIdleAudioPlayback,
  );
  const [audioUrl, setAudioUrl] = useState<string | null>(null);
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
  const summaryTextRef = useRef("");
  const pendingAutoPlay = useRef(false);
  const playAllRef = useRef<HTMLButtonElement>(null);
  const tocWarmRef = useRef<HTMLDivElement>(null);
  const viewportWarmedArticleKey = useRef<string | null>(null);
  const fallbackNoticeArticleKey = useRef<string | null>(null);
  const suppressPlayAllFocusWarm = useRef(false);
  const activeAudioRequestKey = useRef<string | null>(null);
  const slowLoadingTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const isPlayingAllRef = useRef(isPlayingAll);
  const ttsCache = useRef<Map<string, TtsAudioUrlResult>>(new Map());
  const ttsRequestCache = useRef(createAudioRequestCache());
  const seededStartupPath = useRef<Map<string, AudioStartupPath>>(new Map());
  const sectionsRef = useRef<Section[]>([]);

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
    setAudioUrl(null);
    setAudioPlayback(createIdleAudioPlayback());
  }, [clearSlowLoadingTimer]);

  const currentArticleExport =
    articleAudioExports.find((job) => job.articleId === articleId) ?? null;
  const isExportStarting = articleId ? isStartingArticle(articleId) : false;
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
      cacheKey?: string,
      options: { force?: boolean; owner?: AudioRequestOwner } = {},
    ): Promise<TtsAudioUrlResult> => {
      if (cacheKey && !options.force && ttsCache.current.has(cacheKey)) {
        return ttsCache.current.get(cacheKey)!;
      }

      const generationRequestId = requestId.current;
      const requestCache = ttsRequestCache.current;
      const result = cacheKey
        ? await startAudioRequest(
            requestCache,
            cacheKey,
            () => generateTtsAudioUrlWithMetadata({ text }),
            {
              force: options.force,
              owner: options.owner,
            },
          )
        : await generateTtsAudioUrlWithMetadata({ text });

      if (
        cacheKey &&
        requestId.current === generationRequestId &&
        ttsRequestCache.current === requestCache
      ) {
        ttsCache.current.set(cacheKey, result);
      }
      return result;
    },
    [],
  );

  const getTextForSection = useCallback((sectionKey: string): string => {
    if (sectionKey === "summary") return summaryTextRef.current;
    const idx = parseInt(sectionKey.replace("section-", ""), 10);
    const section = sectionsRef.current[idx];
    return section ? `${section.title}. ${section.content}` : "";
  }, []);

  const cacheAudioInConvex = useCallback(
    async (sectionKey: string, blobUrl: string, metadata: TtsMetadata) => {
      if (!articleId || bypassAudioCacheForStress) return;
      try {
        const [blob, durationSeconds] = await Promise.all([
          fetch(blobUrl).then((response) => response.blob()),
          new Promise<number | undefined>((resolve) => {
            const audio = new Audio();
            let settled = false;
            const finish = (duration: number | undefined) => {
              if (settled) return;
              settled = true;
              clearTimeout(timeoutId);
              audio.onloadedmetadata = null;
              audio.onerror = null;
              audio.src = "";
              resolve(duration);
            };

            audio.preload = "metadata";
            audio.onloadedmetadata = () => {
              const duration = audio.duration;
              finish(
                duration && isFinite(duration) ? duration : undefined,
              );
            };
            audio.onerror = () => finish(undefined);
            const timeoutId = setTimeout(() => finish(undefined), 5_000);
            audio.src = blobUrl;
          }),
        ]);
        const uploadUrl = await getUploadUrl();
        const result = await fetch(uploadUrl, {
          method: "POST",
          headers: { "Content-Type": blob.type || "audio/mpeg" },
          body: blob,
        });
        const { storageId } = await result.json();
        await saveAudioRecord({
          articleId,
          sectionKey,
          storageId,
          ttsNormVersion: metadata.ttsNormVersion,
          ttsCacheKey: metadata.ttsCacheKey,
          provider: metadata.provider,
          model: metadata.model,
          voiceId: metadata.voiceId,
          promptVersion: metadata.promptVersion,
          durationSeconds,
        });
      } catch (error) {
        console.warn("[audio-cache] Failed to cache section audio:", error);
      }
    },
    [articleId, bypassAudioCacheForStress, getUploadUrl, saveAudioRecord],
  );

  const getCachedAudioResult = useCallback(
    (sectionKey: string): TtsAudioUrlResult | null => {
      if (bypassAudioCacheForStress) return null;
      return buildCachedTtsResult(
        cachedAudio?.urls[sectionKey],
        cachedAudio?.metadata?.[sectionKey],
      );
    },
    [bypassAudioCacheForStress, cachedAudio],
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
        primeSummaryAudio(slug, result);
      }
      preloadAudioUrl(result.url);
      if (startupPath) {
        seededStartupPath.current.set(sectionKey, startupPath);
      }
    },
    [slug],
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
      const primaryProvider = getActiveTtsProfile().provider;
      analytics.audioStartup({
        scope,
        source,
        path,
        provider: result.metadata.provider,
        fallback: result.metadata.provider !== primaryProvider,
        timing: bucketAudioStartupMs(getStartupNow() - startedAt),
      });
    },
    [],
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

    const prefetchedSummary = getCachedSummaryAudio(slug);
    if (prefetchedSummary) {
      seedSummaryAudio(prefetchedSummary);
      return;
    }

    const summaryText = summaryTextRef.current || article?.summary || "";
    if (summaryText.length < 10) return;

    const warmRequestId = requestId.current;
    warmSummaryAudioFromText(slug, summaryText)
      .then((result) => {
        if (result && requestId.current === warmRequestId) {
          seedSummaryAudio(result);
        }
      })
      .catch(() => {});
  }, [article?.summary, getCachedAudioResult, seedSummaryAudio, slug]);

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
      if (!text || text.length < 10) return null;

      try {
        const warmRequestId = requestId.current;
        const result = await generateTtsFromApi(text, sectionKey, {
          owner: "warm",
        });
        if (requestId.current !== warmRequestId) return null;
        seedAudioResult(sectionKey, result, "prefetch");
        if (!cachedAudio?.urls[sectionKey]) {
          void cacheAudioInConvex(sectionKey, result.url, result.metadata);
        }
        return result;
      } catch {
        seededStartupPath.current.delete(sectionKey);
        return null;
      }
    },
    [
      cachedAudio,
      cacheAudioInConvex,
      generateTtsFromApi,
      getCachedAudioResult,
      getTextForSection,
      seedAudioResult,
    ],
  );

  const hasWarmAudioCached = useCallback(
    (sectionKey: string): boolean => {
      if (ttsCache.current.has(sectionKey)) return true;
      if (getAudioRequestResult(ttsRequestCache.current, sectionKey)) return true;
      if (sectionKey === "summary" && getCachedSummaryAudio(slug)) return true;
      return getCachedAudioResult(sectionKey) !== null;
    },
    [getCachedAudioResult, slug],
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
    if (suppressPlayAllFocusWarm.current) return;
    warmSummaryForIntent();
    if (!article) return;
    warmPlayAllQueue(buildPlayAllQueue(article.sections ?? [], article.title));
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

  useEffect(() => {
    if (!audioUrl || !pendingAutoPlay.current) return;

    pendingAutoPlay.current = false;
    const audio = audioRef.current;
    if (audio) {
      const playPromise = audio.play();
      if (playPromise && typeof playPromise.catch === "function") {
        playPromise.catch(() => {
          clearSlowLoadingTimer();
          setAudioPlayback((current) =>
            current.status === "idle" || current.status === "error"
              ? current
              : { ...current, status: "paused", slowLoading: false },
          );
        });
      }
    }

    if (isPlayingAll && playAllQueue.current.length > 0) {
      warmPlayAllQueue(playAllQueue.current);
    }
  }, [audioUrl, audioRef, clearSlowLoadingTimer, isPlayingAll, warmPlayAllQueue]);

  useEffect(() => {
    sectionsRef.current = article?.sections ?? [];
    summaryTextRef.current = article?.summary ?? "";
  }, [article?.sections, article?.summary]);

  useEffect(() => {
    if (!article) return;
    if (shouldDisableViewportWarmForStress()) return;
    if (!canUseViewportAudioWarm()) return;
    if (viewportWarmedArticleKey.current === slug) return;
    if (typeof IntersectionObserver === "undefined") return;

    const node = tocWarmRef.current;
    if (!node) return;

    const observer = new IntersectionObserver(
      (entries) => {
        if (!entries.some((entry) => entry.isIntersecting)) return;

        observer.disconnect();
        viewportWarmedArticleKey.current = slug;

        const queue = buildPlayAllQueue(
          article.sections ?? [],
          article.title,
        );
        const firstSection = queue.find((item) => item.sectionIdx !== null);
        const summaryText = article.summary ?? "";
        const firstSectionText = firstSection
          ? getTextForSection(firstSection.sectionKey)
          : "";

        if (summaryText.length < 10 && firstSectionText.length < 10) return;

        const warmTargets = [
          summaryText.length >= 10 ? "summary" : null,
          firstSection && firstSectionText.length >= 10
            ? firstSection.sectionKey
            : null,
        ].filter((sectionKey): sectionKey is string => sectionKey !== null);

        if (warmTargets.length === 0) return;
        if (warmTargets.every((sectionKey) => hasWarmAudioCached(sectionKey))) {
          return;
        }

        if (summaryText.length >= 10 && !hasWarmAudioCached("summary")) {
          warmSummaryForIntent();
        }
        if (firstSection && !hasWarmAudioCached(firstSection.sectionKey)) {
          void warmAudioForSection(firstSection.sectionKey);
        }
      },
      { rootMargin: "160px 0px" },
    );

    observer.observe(node);
    return () => observer.disconnect();
  }, [
    article,
    getTextForSection,
    hasWarmAudioCached,
    slug,
    warmAudioForSection,
    warmSummaryForIntent,
  ]);

  const generateAudio = useCallback(
    (
      sectionKey: string,
      label: string,
      sectionIdx: number | null,
      source: AudioStartupSource =
        sectionKey === "summary" ? "summary" : "section",
    ) => {
      const currentRequest = ++requestId.current;
      const startupStartedAt = getStartupNow();
      const scope: AudioStartupScope =
        sectionKey === "summary" ? "summary" : "section";
      const playbackMode: AudioPlaybackMode =
        source === "play_all" || source === "auto_next" ? "play_all" : "single";
      const section =
        sectionIdx !== null ? sectionsRef.current[sectionIdx] : null;

      if (section && !hasFullAudio(section)) {
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
      setTrackingSectionKey(sectionKey);
      setFinishedPlaying(false);
      updateProgress(slug, sectionKey, sectionIdx);

      const memoryCached = ttsCache.current.get(sectionKey);
      if (memoryCached) {
        const startupPath =
          seededStartupPath.current.get(sectionKey) ?? "memory";
        seededStartupPath.current.delete(sectionKey);
        showFallbackNoticeForPlayback(memoryCached);
        setAudioUrl(memoryCached.url);
        pendingAutoPlay.current = true;
        trackAudioStartup(
          scope,
          source,
          startupPath,
          memoryCached,
          startupStartedAt,
        );
        if (!cachedAudio?.urls[sectionKey]) {
          void cacheAudioInConvex(
            sectionKey,
            memoryCached.url,
            memoryCached.metadata,
          );
        }
        return;
      }

      const convexCached = getCachedAudioResult(sectionKey);
      if (convexCached) {
        seedAudioResult(sectionKey, convexCached);
        showFallbackNoticeForPlayback(convexCached);
        setAudioUrl(convexCached.url);
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
      if (!textContent || textContent.length < 10) {
        setAudioError("Section text is too short to read aloud.");
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
        setAudioUrl(result.url);
        trackAudioStartup(scope, source, path, result, startupStartedAt);
        if (!getCachedAudioResult(sectionKey)) {
          void cacheAudioInConvex(sectionKey, result.url, result.metadata);
        }
      };

      const prefetchedAudio =
        sectionKey === "summary"
          ? (getCachedSummaryAudio(slug) ??
            getAudioRequestResult(ttsRequestCache.current, sectionKey))
          : getAudioRequestResult(ttsRequestCache.current, sectionKey);
      const inflightAudio =
        sectionKey === "summary"
          ? (awaitAudioResultWithTimeout(
              awaitSummaryAudioWithMetadata(slug),
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
      cacheAudioInConvex,
      cachedAudio,
      clearSlowLoadingTimer,
      generateTtsFromApi,
      getCachedAudioResult,
      getTextForSection,
      resetAudioPlayback,
      seedAudioResult,
      showFallbackNoticeForPlayback,
      slug,
      startSlowLoadingTimer,
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
    const sections = article.sections ?? [];
    const summaryOnly = sections.filter(hasFullAudio).length === 0;
    analytics.playAll(summaryOnly ? "summary" : "full");
    const queue = buildPlayAllQueue(sections, article.title);
    warmPlayAllQueue(queue);

    const first = queue.shift()!;
    playAllQueue.current = queue;
    isPlayingAllRef.current = true;
    generateAudio(first.sectionKey, first.label, first.sectionIdx, "play_all");
  }, [article, generateAudio, warmPlayAllQueue]);

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
    audioElPause();
    if (playAllQueue.current.length > 0) {
      const next = playAllQueue.current.shift()!;
      generateAudio(next.sectionKey, next.label, next.sectionIdx, "auto_next");
    } else {
      isPlayingAllRef.current = false;
      setTrackingSectionKey(null);
      resetAudioPlayback();
      setFinishedPlaying(true);
    }
  }, [
    audioElPause,
    clearSlowLoadingTimer,
    generateAudio,
    isPlayingAll,
    resetAudioPlayback,
  ]);

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
    onNextTrack: isPlayingAll ? handleSkipSection : undefined,
  });

  useBadgeListenTracking({
    enabled: badgeTrackingEnabled,
    articleId,
    wikiPageId: article?.wikiPageId,
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
    const sections = article.sections ?? [];
    const summaryOnly = sections.filter(hasFullAudio).length === 0;
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
  }, [article, articleId, downloading, queueExport]);

  const handleRetry = useCallback(() => {
    if (!article) return;
    const target = getAudioRetryTarget(audioPlayback, article.title);
    if (target.sectionKey === "summary") {
      warmSummaryForIntent();
    }
    generateAudio(
      target.sectionKey,
      target.label,
      target.sectionIdx,
      "retry",
    );
  }, [article, audioPlayback, generateAudio, warmSummaryForIntent]);

  const handleResume = useCallback(
    (sectionKey: string, sectionIndex: number | null) => {
      if (!article) return;
      const requestedSection =
        sectionIndex !== null ? (article.sections ?? [])[sectionIndex] : null;
      const index =
        sectionIndex !== null &&
        (!requestedSection || !hasFullAudio(requestedSection))
          ? null
          : sectionIndex;
      const section = index !== null ? (article.sections ?? [])[index] : null;
      const label = section
        ? `${section.title} — ${article.title}`
        : `${article.title} — Summary`;
      if (index === null) {
        warmSummaryForIntent();
      }
      generateAudio(
        index !== null ? sectionKey : "summary",
        label,
        index,
        "resume",
      );
    },
    [article, generateAudio, warmSummaryForIntent],
  );

  const handleStartFromBeginning = useCallback(() => {
    if (!article) return;
    warmSummaryForIntent();
    generateAudio(
      "summary",
      `${article.title} — Summary`,
      null,
      "start_over",
    );
  }, [article, generateAudio, warmSummaryForIntent]);

  useEffect(() => {
    if (!article || !shouldFocusPlayAll) return;
    suppressPlayAllFocusWarm.current = true;
    playAllRef.current?.focus({ preventScroll: true });
    queueMicrotask(() => {
      suppressPlayAllFocusWarm.current = false;
    });
  }, [article, shouldFocusPlayAll]);

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
      togglePlayAll: handleTogglePlayAll,
      skipSection: handleSkipSection,
      downloadAll: handleDownloadAll,
      retry: handleRetry,
      resume: handleResume,
      startFromBeginning: handleStartFromBeginning,
      changePlaybackRate: handlePlaybackRateChange,
      seek: audioElSeek,
    },
    audioElement: {
      ref: audioRef,
      src: audioUrl,
      playAllButtonRef: playAllRef,
      warmRegionRef: tocWarmRef,
    },
  } as const;
};
