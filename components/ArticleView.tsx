"use client";

import {
  useEffect,
  useState,
  useCallback,
  useMemo,
  useRef,
} from "react";
import { useAuth } from "@clerk/nextjs";
import { useData, type Article, type Section } from "@/lib/data-context";
import { useArticleAudioExports } from "@/components/ArticleAudioExportProvider";
import {
  TableOfContents,
  type AudioPlaybackMode,
  type AudioPlaybackState,
} from "./TableOfContents";
import { ArticleHeader, ArticleSourceLine } from "./ArticleHeader";
import { ArticleTopics } from "./ArticleTopics";
import { BookmarkButton } from "./BookmarkButton";
import { PlaylistActionButton } from "./PlaylistActionButton";
import { RelatedArticles } from "./RelatedArticles";
import { ArticleGallery, type LightboxState } from "./ArticleGallery";
import { useConvex, useQuery, useMutation } from "convex/react";
import { api } from "@/convex/_generated/api";
import { Id } from "@/convex/_generated/dataModel";
import {
  usePlaybackRate,
  formatRate,
  type PlaybackRate,
} from "@/hooks/usePlaybackRate";
import { analytics } from "@/lib/analytics";
import { useHistory } from "@/hooks/useHistory";
import { useAudioElement } from "@/hooks/useAudioElement";
import { useBadgeListenTracking } from "@/hooks/useBadgeListenTracking";
import { useMediaSession } from "@/hooks/useMediaSession";
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
import { getQuotaFallbackNoticeForPlayback } from "@/lib/audio-fallback-notice";
import { buildAwardedBadgeProgress } from "@/lib/badges";
import { TTS_NORM_VERSION } from "@/lib/tts-normalize";
import {
  generateTtsAudioUrlWithMetadata,
  type TtsAudioUrlResult,
} from "@/lib/tts-client";
import {
  getActiveTtsCacheKey,
  getActiveTtsProfile,
  getTtsMetadata,
  normalizeTtsProvider,
  type TtsMetadata,
} from "@/lib/tts-profile";
import { hasFullAudio } from "@/lib/audio-suitability";
import { useBadgeProgressToasts } from "@/components/BadgeProgressToastProvider";
import {
  ArticleContextLane,
  useArticleContext,
  type ArticleContextLoadState,
} from "@/components/ArticleContext";
import type { ContextBlock } from "@/lib/article-context-types";
import {
  analyzeAdaptiveImage,
  type AdaptiveImageAnalysis,
} from "@/lib/adaptive-image";
import { getVisibleArticleContextBlocks } from "@/lib/article-context-visibility";
import {
  ArticleHero,
  ArticleLoadError,
  ArticleLoadingState,
  AudioErrorNotice,
  ResumeBanner,
} from "./ArticleViewPresentation";

type ArticleData = Article & {
  _id?: string;
  lastFetchedAt?: number;
};

type QueueItem = {
  sectionKey: string;
  label: string;
  sectionIdx: number | null;
};

type AudioRetryTarget = QueueItem & {
  ariaLabel: string;
};

type GenerateAudio = (
  sectionKey: string,
  label: string,
  sectionIdx: number | null,
  source?: AudioStartupSource,
) => void;

const PLAY_ALL_WARM_WINDOW = 2;
const PLAY_ALL_PREFETCH_WAIT_TIMEOUT_MS = 5_000;
const SLOW_TTS_LOADING_NUDGE_MS = 8_000;
const isLocal = process.env.NEXT_PUBLIC_LOCAL_MODE === "true";
const EMPTY_CONTEXT_BLOCKS: ContextBlock[] = [];

const createIdleAudioPlayback = (): AudioPlaybackState => ({
  status: "idle",
  sectionKey: null,
  sectionIdx: null,
  label: null,
  mode: "single",
  slowLoading: false,
});

export const buildPlayAllQueue = (
  sections: Section[],
  articleTitle: string,
): QueueItem[] => {
  const queue: QueueItem[] = [{
    sectionKey: "summary",
    label: `${articleTitle} \u2014 Summary`,
    sectionIdx: null,
  }];
  sections.forEach((section, index) => {
    if (hasFullAudio(section)) {
      queue.push({
        sectionKey: `section-${index}`,
        label: `${section.title} \u2014 ${articleTitle}`,
        sectionIdx: index,
      });
    }
  });
  return queue;
};

export const getAudioRetryTarget = (
  playback: AudioPlaybackState,
  articleTitle: string,
): AudioRetryTarget => {
  if (
    playback.status === "error" &&
    playback.sectionKey &&
    playback.sectionKey !== "summary" &&
    playback.sectionIdx !== null
  ) {
    const label = playback.label ?? `${articleTitle} \u2014 Section`;
    return {
      sectionKey: playback.sectionKey,
      sectionIdx: playback.sectionIdx,
      label,
      ariaLabel: `Try generating audio for ${label} again`,
    };
  }

  return {
    sectionKey: "summary",
    sectionIdx: null,
    label: `${articleTitle} \u2014 Summary`,
    ariaLabel: "Try generating summary audio again",
  };
};

type CachedTtsMetadata = Record<string, string> | undefined;

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

const textOrFallback = (
  value: string | undefined,
  fallback: string,
): string => {
  const trimmed = value?.trim();
  return trimmed || fallback;
};

const buildCachedTtsResult = (
  url: string | undefined,
  metadata: CachedTtsMetadata,
): TtsAudioUrlResult | null => {
  if (!url) return null;

  const fallback = getTtsMetadata(getActiveTtsProfile());
  return {
    url,
    metadata: {
      provider: normalizeTtsProvider(metadata?.provider) ?? fallback.provider,
      model: textOrFallback(metadata?.model, fallback.model),
      voiceId: textOrFallback(metadata?.voiceId, fallback.voiceId),
      promptVersion: textOrFallback(
        metadata?.promptVersion,
        fallback.promptVersion,
      ),
      ttsNormVersion: textOrFallback(
        metadata?.ttsNormVersion,
        fallback.ttsNormVersion,
      ),
      ttsCacheKey: textOrFallback(metadata?.ttsCacheKey, fallback.ttsCacheKey),
    },
  };
};

const AuthenticatedArticleView = ({ slug }: { slug: string }) => {
  const { isLoaded: isAuthLoaded, isSignedIn } = useAuth();

  return (
    <ArticleViewContent
      key={slug}
      slug={slug}
      badgeTrackingEnabled={isAuthLoaded && isSignedIn === true}
    />
  );
};

export const ArticleView = ({ slug }: { slug: string }) => {
  if (isLocal) {
    return (
      <ArticleViewContent
        key={slug}
        slug={slug}
        badgeTrackingEnabled={false}
      />
    );
  }

  return <AuthenticatedArticleView slug={slug} />;
};

const ArticleViewContent = ({
  slug,
  badgeTrackingEnabled,
}: {
  slug: string;
  badgeTrackingEnabled: boolean;
}) => {
  const bypassAudioCacheForStress = shouldBypassAudioCacheForStress();
  const { fetchArticle } = useData();
  const convex = useConvex();

  const [displayArticle, setDisplayArticle] = useState<ArticleData | null>(
    null,
  );
  const [fetching, setFetching] = useState(true);
  const [fetchError, setFetchError] = useState<string | null>(null);

  const [audioError, setAudioError] = useState<string | null>(null);
  const [audioPlayback, setAudioPlayback] = useState<AudioPlaybackState>(
    createIdleAudioPlayback,
  );
  const [showResumeBanner, setShowResumeBanner] = useState(false);
  const [finishedPlaying, setFinishedPlaying] = useState(false);
  const { rate: playbackRate, setRate: setPlaybackRate } = usePlaybackRate();

  const { recordVisit, updateProgress, getProgress } = useHistory();
  const { showBadgeProgressToasts } = useBadgeProgressToasts();
  const { jobs: articleAudioExports, queueExport, isStartingArticle } =
    useArticleAudioExports();

  const articleId = displayArticle?._id as Id<"articles"> | undefined;
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

  const [audioUrl, setAudioUrl] = useState<string | null>(null);
  const [savedProgressState, setSavedProgressState] = useState<{
    sectionKey?: string;
    sectionIndex?: number | null;
  } | null>(null);
  const [heroLightbox, setHeroLightbox] = useState<LightboxState>(null);
  const [heroImageAnalysis, setHeroImageAnalysis] = useState<AdaptiveImageAnalysis | null>(null);
  const [trackingSectionKey, setTrackingSectionKey] = useState<string | null>(null);
  const [fallbackVoiceNotice, setFallbackVoiceNotice] = useState<string | null>(
    null,
  );

  const articleContext = useArticleContext(
    displayArticle
      ? {
          wikiPageId: displayArticle.wikiPageId,
          title: displayArticle.title,
          revisionId: displayArticle.revisionId,
          language: displayArticle.language,
        }
      : null,
  );
  const articleContextStatus = articleContext.status;
  const articleContextError = articleContext.error;
  const articleContextManifest =
    articleContextStatus === "ready" ? articleContext.manifest : null;
  const articleContextBlocks = articleContextManifest?.blocks ?? null;
  const contextBlocks = useMemo(
    () =>
      articleContextBlocks
        ? getVisibleArticleContextBlocks(
            articleContextBlocks,
            displayArticle?.thumbnailUrl,
          )
        : EMPTY_CONTEXT_BLOCKS,
    [articleContextBlocks, displayArticle?.thumbnailUrl],
  );
  const visibleArticleContext = useMemo<ArticleContextLoadState>(() => {
    if (articleContextStatus === "ready") {
      const manifest = articleContextManifest!;
      return {
        status: "ready",
        error: null,
        manifest:
          contextBlocks === manifest.blocks
            ? manifest
            : { ...manifest, blocks: contextBlocks },
      };
    }
    if (articleContextStatus === "error") {
      return {
        status: "error",
        manifest: null,
        error: articleContextError!,
      };
    }
    return { status: articleContextStatus, manifest: null, error: null };
  }, [
    articleContextError,
    articleContextManifest,
    articleContextStatus,
    contextBlocks,
  ]);

  const activeSectionIndex = audioPlayback.sectionIdx;
  const isPaused = audioPlayback.status === "paused";
  const isSpeaking =
    audioPlayback.status === "playing" || audioPlayback.status === "paused";
  const isPlayingAll =
    audioPlayback.mode === "play_all" &&
    audioPlayback.status !== "idle" &&
    audioPlayback.status !== "error";

  const wikiPageId = displayArticle?.wikiPageId ?? "";

  const requestId = useRef(0);
  const playAllQueue = useRef<QueueItem[]>([]);
  const playbackRateTrackRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const lastPlayedSectionIdx = useRef<number | null>(null);
  const summaryTextRef = useRef("");
  const fetchTriggered = useRef(false);
  const pendingAutoPlay = useRef(false);
  const playAllRef = useRef<HTMLButtonElement>(null);
  const tocWarmRef = useRef<HTMLDivElement>(null);
  const viewportWarmedArticleKey = useRef<string | null>(null);
  const fallbackNoticeArticleKey = useRef<string | null>(null);
  const suppressPlayAllFocusWarm = useRef(false);
  const activeAudioRequestKey = useRef<string | null>(null);
  const slowLoadingTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const isPlayingAllRef = useRef(isPlayingAll);

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

  const updateResumePrompt = useCallback(
    () => {
      const progress = getProgress(slug);
      if (
        progress?.lastSectionKey &&
        progress.lastSectionKey !== "summary" &&
        progress.lastSectionIndex != null
      ) {
        setSavedProgressState({
          sectionKey: progress.lastSectionKey,
          sectionIndex: progress.lastSectionIndex,
        });
        setShowResumeBanner(true);
        return;
      }

      setSavedProgressState(null);
      setShowResumeBanner(false);
    },
    [getProgress, slug],
  );

  const loadArticle = useCallback(() => {
    fetchTriggered.current = true;
    fetchArticle({ slug })
      .then((result) => {
        const article = result as unknown as ArticleData;
        setDisplayArticle(article);
        updateResumePrompt();
        recordVisit(slug, article.title);
      })
      .catch((err) =>
        setFetchError(
          err instanceof Error ? err.message : "Failed to load article",
        ),
      )
      .finally(() => setFetching(false));
  }, [slug, fetchArticle, recordVisit, updateResumePrompt]);

  useEffect(() => {
    if (fetchTriggered.current) return;
    loadArticle();
  }, [loadArticle]);

  useEffect(() => {
    const thumbnailUrl = displayArticle?.thumbnailUrl;
    if (!thumbnailUrl) return;

    let cancelled = false;
    analyzeAdaptiveImage(thumbnailUrl)
      .then((analysis) => {
        if (!cancelled) {
          setHeroImageAnalysis(analysis);
        }
      })
      .catch(() => {
        if (!cancelled) {
          setHeroImageAnalysis({
            url: thumbnailUrl,
            hasTransparency: false,
          });
        }
      });

    return () => {
      cancelled = true;
    };
  }, [displayArticle?.thumbnailUrl]);

  const ttsCache = useRef<Map<string, TtsAudioUrlResult>>(new Map());
  const ttsRequestCache = useRef(createAudioRequestCache());
  const seededStartupPath = useRef<Map<string, AudioStartupPath>>(new Map());

  useEffect(
    () => () => {
      requestId.current += 1;
      clearSlowLoadingTimer();
      if (activeAudioRequestKey.current) {
        clearAudioRequest(ttsRequestCache.current, activeAudioRequestKey.current);
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

  const sectionsRef = useRef<Section[]>([]);

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
          fetch(blobUrl).then((r) => r.blob()),
          new Promise<number | undefined>((resolve) => {
            const a = new Audio();
            a.preload = "metadata";
            a.onloadedmetadata = () => {
              const d = a.duration;
              a.src = "";
              resolve(d && isFinite(d) ? d : undefined);
            };
            a.onerror = () => resolve(undefined);
            a.src = blobUrl;
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
      } catch (err) {
        console.warn("[audio-cache] Failed to cache section audio:", err);
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

    const summaryText = summaryTextRef.current || displayArticle?.summary || "";
    if (summaryText.length < 10) return;

    const warmRequestId = requestId.current;
    warmSummaryAudioFromText(slug, summaryText)
      .then((result) => {
        if (result && requestId.current === warmRequestId) {
          seedSummaryAudio(result);
        }
      })
      .catch(() => {});
  }, [displayArticle?.summary, getCachedAudioResult, seedSummaryAudio, slug]);

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
          cacheAudioInConvex(sectionKey, result.url, result.metadata);
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
    if (!displayArticle) return;
    warmPlayAllQueue(
      buildPlayAllQueue(
        displayArticle.sections ?? [],
        displayArticle.title,
      ),
    );
  }, [displayArticle, warmPlayAllQueue, warmSummaryForIntent]);

  const audioEndedRef = useRef<() => void>(() => {});
  // Keeps queued "play all" continuations calling the latest generator callback.
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
    if (audioUrl && pendingAutoPlay.current) {
      pendingAutoPlay.current = false;
      const audio = audioRef.current;
      if (audio) {
        const p = audio.play();
        if (p && typeof p.catch === "function") {
          p.catch(() => {
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
    }
  }, [audioUrl, audioRef, clearSlowLoadingTimer, isPlayingAll, warmPlayAllQueue]);

  useEffect(() => {
    sectionsRef.current = displayArticle?.sections ?? [];
    summaryTextRef.current = displayArticle?.summary ?? "";
  }, [displayArticle?.sections, displayArticle?.summary]);

  useEffect(() => {
    if (!displayArticle) return;
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
          displayArticle.sections ?? [],
          displayArticle.title,
        );
        const firstSection = queue.find((item) => item.sectionIdx !== null);
        const summaryText = displayArticle.summary ?? "";
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
    displayArticle,
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
      lastPlayedSectionIdx.current = sectionIdx;
      updateProgress(slug, sectionKey, sectionIdx);

      const memCached = ttsCache.current.get(sectionKey);
      if (memCached) {
        const startupPath =
          seededStartupPath.current.get(sectionKey) ?? "memory";
        seededStartupPath.current.delete(sectionKey);
        showFallbackNoticeForPlayback(memCached);
        setAudioUrl(memCached.url);
        pendingAutoPlay.current = true;
        trackAudioStartup(
          scope,
          source,
          startupPath,
          memCached,
          startupStartedAt,
        );
        if (!cachedAudio?.urls[sectionKey]) {
          cacheAudioInConvex(sectionKey, memCached.url, memCached.metadata);
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
          cacheAudioInConvex(sectionKey, result.url, result.metadata);
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
            ) ?? awaitAudioRequest(ttsRequestCache.current, sectionKey, {
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
        .catch((err) => {
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
            err instanceof Error ? err.message : "Audio generation failed",
          );
        });
    },
    [
      slug,
      updateProgress,
      cachedAudio,
      cacheAudioInConvex,
      getCachedAudioResult,
      getTextForSection,
      generateTtsFromApi,
      seedAudioResult,
      showFallbackNoticeForPlayback,
      trackAudioStartup,
      clearSlowLoadingTimer,
      resetAudioPlayback,
      startSlowLoadingTimer,
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
  }, [isPlayingAll, generateAudio, resetAudioPlayback]);

  useEffect(() => {
    audioEndedRef.current = handleAudioEnded;
  });

  const handlePlayAll = useCallback(
    (sections: Section[], articleTitle: string) => {
      const summaryOnly = sections.filter(hasFullAudio).length === 0;
      analytics.playAll(summaryOnly ? "summary" : "full");
      const queue = buildPlayAllQueue(sections, articleTitle);
      warmPlayAllQueue(queue);

      const first = queue.shift()!;
      playAllQueue.current = queue;
      isPlayingAllRef.current = true;
      generateAudio(first.sectionKey, first.label, first.sectionIdx, "play_all");
    },
    [generateAudio, warmPlayAllQueue],
  );

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
  }, [isPlayingAll, generateAudio, audioElPause, clearSlowLoadingTimer, resetAudioPlayback]);

  const mediaSessionTitle = isSpeaking || audioElPlaying
    ? audioPlayback.label ?? (activeSectionIndex != null && displayArticle?.sections?.[activeSectionIndex]
      ? `${displayArticle.sections[activeSectionIndex].title} \u2014 ${displayArticle.title}`
      : displayArticle
        ? `Summary \u2014 ${displayArticle.title}`
        : null)
    : null;

  useMediaSession({
    title: mediaSessionTitle,
    artworkUrl: displayArticle?.thumbnailUrl,
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
    wikiPageId: displayArticle?.wikiPageId,
    slug,
    title: displayArticle?.title,
    summaryText: displayArticle?.summary,
    sections: displayArticle?.sections ?? [],
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

  const handlePlaybackRateChange = useCallback((rate: PlaybackRate) => {
    setPlaybackRate(rate);
    if (playbackRateTrackRef.current) clearTimeout(playbackRateTrackRef.current);
    playbackRateTrackRef.current = setTimeout(() => {
      analytics.playbackSpeed(formatRate(rate));
      playbackRateTrackRef.current = null;
    }, 2000);
  }, [setPlaybackRate]);

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
  }, [isPaused, audioElPlay, audioElPause]);

  const handleListenSection = useCallback(
    (index: number, sections: Section[], articleTitle: string) => {
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
      const section = sections[index];
      generateAudio(
        `section-${index}`,
        `${section.title} \u2014 ${articleTitle}`,
        index,
        "section",
      );
    },
    [
      generateAudio,
      activeSectionIndex,
      isSpeaking,
      audioElPlaying,
      audioElPlay,
      audioElPause,
      clearSlowLoadingTimer,
    ],
  );

  const handleListenSummary = useCallback(
    (articleTitle: string) => {
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
      generateAudio("summary", `${articleTitle} \u2014 Summary`, null, "summary");
    },
    [
      generateAudio,
      isSpeaking,
      audioElPlaying,
      audioElPlay,
      audioElPause,
      clearSlowLoadingTimer,
      warmSummaryForIntent,
      audioPlayback.sectionKey,
    ],
  );

  const handleWarmSection = useCallback(
    (index: number) => {
      void warmAudioForSection(`section-${index}`);
    },
    [warmAudioForSection],
  );

  const handleDownloadAll = useCallback(async () => {
    if (!displayArticle || !articleId || downloading) return;
    const allSections = displayArticle.sections ?? [];
    const summaryOnly = allSections.filter(hasFullAudio).length === 0;
    analytics.downloadAll(summaryOnly ? "summary" : "full");

    try {
      await queueExport({
        articleId,
        title: displayArticle.title,
      });
    } catch (err) {
      setAudioError(
        err instanceof Error ? err.message : "Could not queue article download",
      );
    }
  }, [articleId, displayArticle, downloading, queueExport]);

  useEffect(() => {
    if (displayArticle && !showResumeBanner) {
      suppressPlayAllFocusWarm.current = true;
      playAllRef.current?.focus({ preventScroll: true });
      queueMicrotask(() => {
        suppressPlayAllFocusWarm.current = false;
      });
    }
  }, [displayArticle, showResumeBanner]);

  /* ── Loading / Error states ── */

  if (fetching && !displayArticle) {
    return <ArticleLoadingState />;
  }

  if (fetchError) {
    return (
      <ArticleLoadError
        error={fetchError}
        onRetry={() => {
          setFetchError(null);
          setFetching(true);
          loadArticle();
        }}
      />
    );
  }

  if (!displayArticle) return null;

  const sections = displayArticle.sections ?? [];
  const audioRetryTarget = getAudioRetryTarget(
    audioPlayback,
    displayArticle.title,
  );

  const handleResume = () => {
    const sp = savedProgressState;
    if (sp?.sectionKey && displayArticle) {
      setShowResumeBanner(false);
      const requestedIndex = sp.sectionIndex ?? null;
      const requestedSection =
        requestedIndex !== null ? sections[requestedIndex] : null;
      const idx =
        requestedSection && !hasFullAudio(requestedSection)
          ? null
          : requestedIndex;
      const section = idx !== null ? sections[idx] : null;
      const label = section
        ? `${section.title} \u2014 ${displayArticle.title}`
        : `${displayArticle.title} \u2014 Summary`;
      if (idx === null) {
        warmSummaryForIntent();
      }
      generateAudio(idx !== null ? sp.sectionKey : "summary", label, idx, "resume");
    }
  };

  const handleStartFromBeginning = () => {
    setShowResumeBanner(false);
    warmSummaryForIntent();
    generateAudio(
      "summary",
      `${displayArticle.title} \u2014 Summary`,
      null,
      "start_over",
    );
  };

  return (
    <article className="animate-fade-in-up">
      {/* 1. Title + Bookmark */}
      <div className="mb-4">
        <div className="flex items-start justify-between gap-3 mb-3">
          <h1 className="font-display text-[clamp(2rem,5vw,3rem)] font-bold leading-[1.15] text-foreground m-0">
            {displayArticle.title}
          </h1>
          <div className="flex items-center gap-2 shrink-0">
            <PlaylistActionButton slug={slug} title={displayArticle.title} />
            <BookmarkButton slug={slug} title={displayArticle.title} />
          </div>
        </div>
        <ArticleSourceLine
          language={displayArticle.language}
          revisionId={displayArticle.revisionId}
          wikiPageId={displayArticle.wikiPageId}
        />
        <ArticleTopics badgeKeys={displayArticle.badgeKeys} />
      </div>

      <ArticleHero
        article={displayArticle}
        imageAnalysis={heroImageAnalysis}
        lightbox={heroLightbox}
        onLightboxChange={setHeroLightbox}
      />

      {/* Resume banner */}
      {showResumeBanner && savedProgressState && (
        <ResumeBanner
          sectionLabel={
            savedProgressState.sectionIndex != null
              ? sections[savedProgressState.sectionIndex]?.title ??
                "previous section"
              : "summary"
          }
          onResume={handleResume}
          onStartOver={handleStartFromBeginning}
        />
      )}

      {/* Hidden audio element for playback */}
      <audio
        ref={audioRef}
        src={audioUrl ?? undefined}
        preload="metadata"
        aria-hidden="true"
        className="hidden"
      />

      {/* Audio error */}
      {audioError && (
        <AudioErrorNotice
          error={audioError}
          retryLabel={audioRetryTarget.ariaLabel}
          onRetry={() => {
            if (audioRetryTarget.sectionKey === "summary") {
              warmSummaryForIntent();
            }
            generateAudio(
              audioRetryTarget.sectionKey,
              audioRetryTarget.label,
              audioRetryTarget.sectionIdx,
              "retry",
            );
          }}
        />
      )}

      {/* 3. Table of contents with per-section audio */}
      <div
        ref={tocWarmRef}
        className="animate-fade-in-up-delay-2 mb-6"
      >
        <TableOfContents
          articleTitle={displayArticle.title}
          wikiPageId={wikiPageId}
          summaryText={displayArticle.summary}
          sections={sections}
          sectionDurations={cachedAudio?.durations}
          playback={audioPlayback}
          onListenSection={(index) =>
            handleListenSection(index, sections, displayArticle.title)
          }
          onListenSummary={() =>
            handleListenSummary(displayArticle.title)
          }
          onPlayAll={() =>
            handlePlayAll(sections, displayArticle.title)
          }
          onWarmPlayAll={warmPlayAllForIntent}
          onWarmSummary={warmSummaryForIntent}
          onWarmSection={handleWarmSection}
          onStopPlayAll={handleStopPlayAll}
          onTogglePlayAll={handleTogglePlayAll}
          onSkipSection={handleSkipSection}
          onDownloadAll={handleDownloadAll}
          downloadHref={readyDownloadHref}
          downloading={downloading}
          downloadProgress={downloadProgress}
          downloadStatus={downloadStatus}
          downloadStage={downloadStage}
          playbackRate={playbackRate}
          onPlaybackRateChange={handlePlaybackRateChange}
          audioProgress={
            audioUrl
              ? { currentTime: audioElCurrentTime, duration: audioElDuration }
              : undefined
          }
          onSeek={audioElSeek}
          playAllRef={playAllRef}
          fallbackVoiceNotice={fallbackVoiceNotice}
          contextBlocks={contextBlocks}
        />
      </div>

      {/* 4. Accessible contextual maps, timelines, data, and diagrams */}
      <ArticleContextLane
        state={visibleArticleContext}
        retry={articleContext.retry}
      />

      {/* 5. Gallery */}
      <div className="animate-fade-in-up-delay-2 mb-6">
        <ArticleGallery wikiPageId={wikiPageId} />
      </div>

      {/* 6. Related articles (shown after playback finishes) */}
      {finishedPlaying && (
        <div className="animate-fade-in-up mb-6">
          <RelatedArticles wikiPageId={wikiPageId} currentTitle={displayArticle.title} />
        </div>
      )}

      {/* 7. Article metadata */}
      <ArticleHeader
        title={displayArticle.title}
        language={displayArticle.language}
        revisionId={displayArticle.revisionId}
        lastEdited={(displayArticle as ArticleData).lastEdited}
        wikiPageId={displayArticle.wikiPageId}
      />
    </article>
  );
};
