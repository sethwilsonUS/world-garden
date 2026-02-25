"use client";

import { useEffect, useState, useCallback, useRef } from "react";
import { useData } from "@/lib/data-context";
import { TableOfContents } from "./TableOfContents";
import { ArticleHeader } from "./ArticleHeader";
import { BookmarkButton } from "./BookmarkButton";
import { RelatedArticles } from "./RelatedArticles";
import { ArticleGallery, Lightbox, type LightboxState } from "./ArticleGallery";
import { useQuery, useMutation } from "convex/react";
import { api } from "@/convex/_generated/api";
import { Id } from "@/convex/_generated/dataModel";
import { usePlaybackRate } from "@/hooks/usePlaybackRate";
import { useHistory } from "@/hooks/useHistory";
import { useAudioElement } from "@/hooks/useAudioElement";
import { awaitSummaryAudio } from "@/lib/audio-prefetch";
import { normalizeTtsText, TTS_NORM_VERSION } from "@/lib/tts-normalize";

type Section = {
  title: string;
  level: number;
  content: string;
};

type ArticleData = {
  _id: string;
  wikiPageId: string;
  title: string;
  language: string;
  revisionId: string;
  lastFetchedAt: number;
  summary?: string;
  thumbnailUrl?: string;
  thumbnailWidth?: number;
  thumbnailHeight?: number;
  sections?: Section[];
  lastEdited?: string;
};

type QueueItem = {
  sectionKey: string;
  label: string;
  sectionIdx: number | null;
};

export const ArticleView = ({ slug }: { slug: string }) => {
  const { fetchArticle } = useData();

  const [displayArticle, setDisplayArticle] = useState<ArticleData | null>(
    null,
  );
  const [fetching, setFetching] = useState(true);
  const [fetchError, setFetchError] = useState<string | null>(null);

  const [audioError, setAudioError] = useState<string | null>(null);
  const [activeSectionIndex, setActiveSectionIndex] = useState<number | null>(
    null,
  );
  const [isPlayingAll, setIsPlayingAll] = useState(false);
  const [isPaused, setIsPaused] = useState(false);
  const [isSpeaking, setIsSpeaking] = useState(false);
  const [showResumeBanner, setShowResumeBanner] = useState(false);
  const [finishedPlaying, setFinishedPlaying] = useState(false);
  const { rate: playbackRate, setRate: setPlaybackRate } = usePlaybackRate();

  const { recordVisit, updateProgress, getProgress } = useHistory();

  const articleId = displayArticle?._id as Id<"articles"> | undefined;
  const cachedAudio = useQuery(
    api.audio.getAllSectionAudio,
    articleId ? { articleId, ttsNormVersion: TTS_NORM_VERSION } : "skip",
  );
  const getUploadUrl = useMutation(api.audio.generateUploadUrl);
  const saveAudioRecord = useMutation(api.audio.saveSectionAudioRecord);

  const [audioUrl, setAudioUrl] = useState<string | null>(null);
  const [audioLoading, setAudioLoading] = useState(false);
  const [downloading, setDownloading] = useState(false);
  const [downloadProgress, setDownloadProgress] = useState<{ current: number; total: number }>({ current: 0, total: 0 });
  const [savedProgressState, setSavedProgressState] = useState<{ sectionKey?: string; sectionIndex?: number | null } | null>(null);
  const [heroLightbox, setHeroLightbox] = useState<LightboxState>(null);

  const wikiPageId = displayArticle?.wikiPageId ?? "";

  const requestId = useRef(0);
  const playAllQueue = useRef<QueueItem[]>([]);
  const lastPlayedSectionIdx = useRef<number | null>(null);
  const summaryTextRef = useRef("");
  const fetchTriggered = useRef(false);
  const pendingAutoPlay = useRef(false);
  const playAllRef = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    if (fetchTriggered.current) return;
    fetchTriggered.current = true;
    fetchArticle({ slug })
      .then((result) => {
        const article = result as unknown as ArticleData;
        setDisplayArticle(article);
        recordVisit(slug, article.title);
      })
      .catch((err) =>
        setFetchError(
          err instanceof Error ? err.message : "Failed to load article",
        ),
      )
      .finally(() => setFetching(false));
  }, [slug, fetchArticle, recordVisit]);

  const edgeTtsCache = useRef<Map<string, string>>(new Map());

  const generateEdgeTtsFromApi = useCallback(
    async (text: string, cacheKey?: string): Promise<string> => {
      if (cacheKey && edgeTtsCache.current.has(cacheKey)) {
        return edgeTtsCache.current.get(cacheKey)!;
      }
      const resp = await fetch("/api/tts", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ text: normalizeTtsText(text) }),
      });
      if (!resp.ok) {
        const body = await resp.json().catch(() => ({}));
        throw new Error(
          (body as { error?: string }).error ?? "Audio generation failed",
        );
      }
      const blob = await resp.blob();
      const url = URL.createObjectURL(blob);
      if (cacheKey) edgeTtsCache.current.set(cacheKey, url);
      return url;
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
    async (sectionKey: string, blobUrl: string) => {
      if (!articleId) return;
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
          ttsNormVersion: TTS_NORM_VERSION,
          durationSeconds,
        });
      } catch (err) {
        console.warn("[audio-cache] Failed to cache section audio:", err);
      }
    },
    [articleId, getUploadUrl, saveAudioRecord],
  );

  const prefetchTriggered = useRef(false);
  useEffect(() => {
    if (!displayArticle || prefetchTriggered.current) return;
    prefetchTriggered.current = true;

    const cacheSummary = (url: string) => {
      edgeTtsCache.current.set("summary", url);
      if (!cachedAudio?.urls["summary"]) {
        cacheAudioInConvex("summary", url);
      }
    };

    const inflight = awaitSummaryAudio(slug);
    if (inflight) {
      inflight.then((url) => {
        if (url) cacheSummary(url);
      }).catch(() => {});
      return;
    }

    const summaryText = displayArticle.summary ?? "";
    if (summaryText.length < 10) return;
    generateEdgeTtsFromApi(summaryText, "summary")
      .then(cacheSummary)
      .catch(() => {});
  }, [displayArticle, generateEdgeTtsFromApi, slug, cachedAudio, cacheAudioInConvex]);

  const prefetchAudio = useCallback(
    (sectionKey: string) => {
      const text = getTextForSection(sectionKey);
      if (!text || text.length < 10) return;
      generateEdgeTtsFromApi(text, sectionKey)
        .then((url) => {
          if (!cachedAudio?.urls[sectionKey]) {
            cacheAudioInConvex(sectionKey, url);
          }
        })
        .catch(() => {});
    },
    [generateEdgeTtsFromApi, getTextForSection, cachedAudio, cacheAudioInConvex],
  );

  const audioEndedRef = useRef<() => void>(() => {});

  const {
    audioRef,
    playing: audioElPlaying,
    currentTime: audioElCurrentTime,
    duration: audioElDuration,
    play: audioElPlay,
    pause: audioElPause,
    seek: audioElSeek,
  } = useAudioElement({
    url: audioUrl,
    onEnded: () => audioEndedRef.current(),
    onPlayingChange: (playing) => {
      if (playing) {
        setIsSpeaking(true);
        setIsPaused(false);
      }
    },
    playbackRate,
  });

  useEffect(() => {
    if (audioUrl && !audioLoading && pendingAutoPlay.current) {
      pendingAutoPlay.current = false;
      const timer = setTimeout(() => audioElPlay(), 100);

      if (isPlayingAll && playAllQueue.current.length > 0) {
        prefetchAudio(playAllQueue.current[0].sectionKey);
      }

      return () => clearTimeout(timer);
    }
  }, [audioUrl, audioLoading, audioElPlay, isPlayingAll, prefetchAudio]);

  useEffect(() => {
    sectionsRef.current = displayArticle?.sections ?? [];
    summaryTextRef.current = displayArticle?.summary ?? "";
  });

  const generateAudio = useCallback(
    (
      sectionKey: string,
      label: string,
      sectionIdx: number | null,
    ) => {
      const currentRequest = ++requestId.current;
      setAudioError(null);
      setActiveSectionIndex(sectionIdx);
      setFinishedPlaying(false);
      lastPlayedSectionIdx.current = sectionIdx;

      updateProgress(slug, sectionKey, sectionIdx);

      const memCached = edgeTtsCache.current.get(sectionKey);
      if (memCached) {
        setAudioUrl(memCached);
        pendingAutoPlay.current = true;
        setAudioLoading(false);
        if (!cachedAudio?.urls[sectionKey]) {
          cacheAudioInConvex(sectionKey, memCached);
        }
        return;
      }

      const convexCached = cachedAudio?.urls[sectionKey];
      if (convexCached) {
        setAudioUrl(convexCached);
        pendingAutoPlay.current = true;
        setAudioLoading(false);
        return;
      }

      const textContent = getTextForSection(sectionKey);

      if (!textContent || textContent.length < 10) {
        setAudioError("Section text is too short to read aloud.");
        return;
      }

      setAudioLoading(true);
      pendingAutoPlay.current = true;

      generateEdgeTtsFromApi(textContent, sectionKey)
        .then((url) => {
          if (requestId.current !== currentRequest) return;
          setAudioUrl(url);
          setAudioLoading(false);
          cacheAudioInConvex(sectionKey, url);
        })
        .catch((err) => {
          if (requestId.current !== currentRequest) return;
          setAudioError(err instanceof Error ? err.message : "Audio generation failed");
          setAudioLoading(false);
          pendingAutoPlay.current = false;
        });
    },
    [slug, updateProgress, generateEdgeTtsFromApi, getTextForSection, cachedAudio, cacheAudioInConvex],
  );

  const handleAudioEnded = useCallback(() => {
    if (isPlayingAll && playAllQueue.current.length > 0) {
      const next = playAllQueue.current.shift()!;
      generateAudio(next.sectionKey, next.label, next.sectionIdx);
      return;
    }

    setIsPlayingAll(false);
    setActiveSectionIndex(null);
    setIsSpeaking(false);
    setIsPaused(false);
    if (isPlayingAll) {
      setFinishedPlaying(true);
    }
  }, [isPlayingAll, generateAudio]);

  useEffect(() => {
    audioEndedRef.current = handleAudioEnded;
  });

  const handlePlayAll = useCallback(
    (sections: Section[], articleTitle: string) => {
      const queue: QueueItem[] = [
        {
          sectionKey: "summary",
          label: `${articleTitle} \u2014 Summary`,
          sectionIdx: null,
        },
        ...sections
          .map((s, i) => ({ section: s, index: i }))
          .filter(({ section }) => section.content.length >= 20)
          .map(({ section, index }) => ({
            sectionKey: `section-${index}`,
            label: `${section.title} \u2014 ${articleTitle}`,
            sectionIdx: index,
          })),
      ];

      const first = queue.shift()!;
      playAllQueue.current = queue;
      setIsPlayingAll(true);
      generateAudio(first.sectionKey, first.label, first.sectionIdx);
    },
    [generateAudio],
  );

  const handleStopPlayAll = useCallback(() => {
    playAllQueue.current = [];
    setIsPlayingAll(false);
    setIsSpeaking(false);
    setIsPaused(false);
    audioElPause();
  }, [audioElPause]);

  const handleTogglePlayAll = useCallback(() => {
    if (isPaused) {
      audioElPlay();
      setIsPaused(false);
    } else {
      audioElPause();
      setIsPaused(true);
    }
  }, [isPaused, audioElPlay, audioElPause]);

  const handleListenSection = useCallback(
    (index: number, sections: Section[], articleTitle: string) => {
      if (activeSectionIndex === index && isSpeaking) {
        if (audioElPlaying) {
          audioElPause();
          setIsPaused(true);
        } else {
          audioElPlay();
          setIsPaused(false);
        }
        return;
      }
      playAllQueue.current = [];
      setIsPlayingAll(false);
      const section = sections[index];
      generateAudio(
        `section-${index}`,
        `${section.title} \u2014 ${articleTitle}`,
        index,
      );
    },
    [generateAudio, activeSectionIndex, isSpeaking, audioElPlaying, audioElPlay, audioElPause],
  );

  const handleListenSummary = useCallback(
    (articleTitle: string) => {
      if (activeSectionIndex === null && isSpeaking) {
        if (audioElPlaying) {
          audioElPause();
          setIsPaused(true);
        } else {
          audioElPlay();
          setIsPaused(false);
        }
        return;
      }
      playAllQueue.current = [];
      setIsPlayingAll(false);
      generateAudio("summary", `${articleTitle} \u2014 Summary`, null);
    },
    [generateAudio, activeSectionIndex, isSpeaking, audioElPlaying, audioElPlay, audioElPause],
  );

  const handleDownloadAll = useCallback(async () => {
    if (!displayArticle || downloading) return;
    const allSections = displayArticle.sections ?? [];
    const sectionKeys = [
      "summary",
      ...allSections
        .map((s, i) => ({ section: s, index: i }))
        .filter(({ section }) => section.content.length >= 20)
        .map(({ index }) => `section-${index}`),
    ];

    setDownloading(true);
    setDownloadProgress({ current: 0, total: sectionKeys.length });

    try {
      const audioChunks: Blob[] = [];

      for (let i = 0; i < sectionKeys.length; i++) {
        setDownloadProgress({ current: i, total: sectionKeys.length });

        let url: string | null = cachedAudio?.urls[sectionKeys[i]] ?? null;

        if (!url) {
          let textContent: string;
          if (sectionKeys[i] === "summary") {
            textContent = displayArticle.summary ?? "";
          } else {
            const idx = parseInt(sectionKeys[i].replace("section-", ""), 10);
            const section = allSections[idx];
            textContent = section ? `${section.title}. ${section.content}` : "";
          }
          if (textContent.length >= 10) {
            url = await generateEdgeTtsFromApi(textContent, sectionKeys[i]);
            if (url) cacheAudioInConvex(sectionKeys[i], url);
          }
        }

        if (url) {
          const resp = await fetch(url);
          audioChunks.push(await resp.blob());
        }
      }

      const combinedBlob = new Blob(audioChunks, { type: "audio/mpeg" });
      const downloadUrl = URL.createObjectURL(combinedBlob);
      const a = document.createElement("a");
      a.href = downloadUrl;
      a.download = `${displayArticle.title.replace(/[^a-zA-Z0-9 ]/g, "").trim()}.mp3`;
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      URL.revokeObjectURL(downloadUrl);
    } catch (err) {
      setAudioError(err instanceof Error ? err.message : "Download failed");
    } finally {
      setDownloading(false);
    }
  }, [displayArticle, downloading, generateEdgeTtsFromApi, cachedAudio, cacheAudioInConvex]);

  const [hasCheckedResume, setHasCheckedResume] = useState(false);
  if (displayArticle && !hasCheckedResume) {
    setHasCheckedResume(true);
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
    }
  }

  useEffect(() => {
    if (displayArticle && !showResumeBanner) {
      playAllRef.current?.focus({ preventScroll: true });
    }
  }, [displayArticle, showResumeBanner]);

  /* ── Loading / Error states ── */

  if (fetching && !displayArticle) {
    return (
      <div role="status" aria-label="Fetching article from Wikipedia">
        <div className="garden-bed text-center px-6 py-8">
          <svg
            className="animate-spin mx-auto mb-4 text-accent"
            fill="none"
            viewBox="0 0 24 24"
            width="32"
            height="32"
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
          <p className="font-display font-semibold text-foreground">
            Planting seeds...
          </p>
          <p className="text-muted text-sm mt-2">
            Fetching article from Wikipedia
          </p>
        </div>
      </div>
    );
  }

  if (fetchError) {
    return (
      <div className="alert-banner alert-error" role="alert">
        <svg
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          strokeWidth={2}
          strokeLinecap="round"
          strokeLinejoin="round"
          width={20}
          height={20}
          aria-hidden="true"
          className="shrink-0"
        >
          <path d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z" />
        </svg>
        <div>
          <p className="font-semibold">Could not load article</p>
          <p className="text-sm mt-1">
            {fetchError}
          </p>
          <button
            onClick={() => {
              fetchTriggered.current = false;
              setFetchError(null);
              setFetching(true);
              fetchArticle({ slug })
                .then((r) => setDisplayArticle(r as unknown as ArticleData))
                .catch((e) =>
                  setFetchError(e instanceof Error ? e.message : "Failed to load article"),
                )
                .finally(() => setFetching(false));
            }}
            className="btn-secondary mt-3 px-4 py-2 text-sm"
            aria-label="Try loading article again"
          >
            Try again
          </button>
        </div>
      </div>
    );
  }

  if (!displayArticle) return null;

  const sections = displayArticle.sections ?? [];

  const handleResume = () => {
    const sp = savedProgressState;
    if (sp?.sectionKey && displayArticle) {
      setShowResumeBanner(false);
      const idx = sp.sectionIndex ?? null;
      const section = idx !== null ? sections[idx] : null;
      const label = section
        ? `${section.title} \u2014 ${displayArticle.title}`
        : `${displayArticle.title} \u2014 Summary`;
      generateAudio(sp.sectionKey, label, idx);
    }
  };

  const handleStartFromBeginning = () => {
    setShowResumeBanner(false);
    generateAudio(
      "summary",
      `${displayArticle.title} \u2014 Summary`,
      null,
    );
  };

  return (
    <article className="animate-fade-in-up">
      {/* 1. Title + Bookmark */}
      <div className="flex items-start justify-between gap-3 mb-4">
        <h1 className="font-display text-[clamp(2rem,5vw,3rem)] font-bold leading-[1.15] text-foreground m-0">
          {displayArticle.title}
        </h1>
        <BookmarkButton slug={slug} title={displayArticle.title} />
      </div>

      {displayArticle.thumbnailUrl ? (() => {
        const w = displayArticle.thumbnailWidth ?? 0;
        const h = displayArticle.thumbnailHeight ?? 0;
        const isPortrait = h > w;
        const openHeroLightbox = () => setHeroLightbox({ index: 0 });

        if (isPortrait) {
          return (
            <div
              className="relative mb-4 overflow-hidden rounded-xl cursor-pointer"
              role="button"
              tabIndex={0}
              aria-label={`View full image for ${displayArticle.title}`}
              onClick={openHeroLightbox}
              onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); openHeroLightbox(); } }}
            >
              <img
                src={displayArticle.thumbnailUrl}
                alt=""
                aria-hidden="true"
                className="absolute inset-0 w-full h-full object-cover"
                style={{ transform: 'scale(1.8)', filter: 'blur(80px) brightness(0.65)' }}
              />
              <div className="absolute inset-0 bg-black/45" />
              <div className="relative flex items-center justify-center gap-16 p-6 sm:p-10">
                <img
                  src={displayArticle.thumbnailUrl}
                  alt={displayArticle.title}
                  width={w || undefined}
                  height={h || undefined}
                  className="max-h-56 sm:max-h-72 w-auto object-contain rounded-lg shrink-0"
                  loading="eager"
                />
                {displayArticle.summary && (
                  <div className="hidden md:block max-w-sm" onClick={(e) => e.stopPropagation()}>
                    <p
                      className="text-sm leading-relaxed text-white line-clamp-[7]"
                      style={{ textShadow: '0 1px 4px rgba(0, 0, 0, 0.6)' }}
                    >
                      {displayArticle.summary}
                    </p>
                  </div>
                )}
              </div>
            </div>
          );
        }

        return (
          <div
            className="relative mb-4 overflow-hidden rounded-xl cursor-pointer"
            role="button"
            tabIndex={0}
            aria-label={`View full image for ${displayArticle.title}`}
            onClick={openHeroLightbox}
            onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); openHeroLightbox(); } }}
          >
            <img
              src={displayArticle.thumbnailUrl}
              alt={displayArticle.title}
              width={w || undefined}
              height={h || undefined}
              className="w-full max-h-48 sm:max-h-64 object-cover"
              loading="eager"
            />
            {displayArticle.summary && (
              <div className="hidden md:block absolute inset-x-0 bottom-0 rounded-b-xl bg-black/70 px-5 py-4"
                style={{ backdropFilter: 'blur(16px)', WebkitBackdropFilter: 'blur(16px)' }}
                onClick={(e) => e.stopPropagation()}
              >
                <p className="text-sm leading-relaxed text-white line-clamp-3">
                  {displayArticle.summary}
                </p>
              </div>
            )}
          </div>
        );
      })() : displayArticle.summary && (
        <div className="hidden xs:block mb-4">
          <p className="text-sm leading-relaxed text-muted line-clamp-3">
            {displayArticle.summary}
          </p>
        </div>
      )}

      {displayArticle.thumbnailUrl && displayArticle.summary && (
        <div className="hidden xs:block md:hidden mb-4">
          <p className="text-sm leading-relaxed text-muted line-clamp-3">
            {displayArticle.summary}
          </p>
        </div>
      )}

      {displayArticle.thumbnailUrl && heroLightbox && (
        <Lightbox
          images={[{ src: displayArticle.thumbnailUrl, originalSrc: displayArticle.thumbnailUrl, alt: displayArticle.title, caption: "" }]}
          state={heroLightbox}
          onClose={() => setHeroLightbox(null)}
        />
      )}

      {/* Resume banner */}
      {showResumeBanner && savedProgressState && (
        <div
          role="status"
          className="garden-bed py-4 px-5 mb-4 flex items-center flex-wrap gap-3"
        >
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
            className="text-accent shrink-0"
          >
            <circle cx="12" cy="12" r="10" />
            <polyline points="12 6 12 12 16 14" />
          </svg>
          <span className="flex-1 text-sm text-foreground-2">
            Resume from{" "}
            <strong>
              {savedProgressState.sectionIndex != null
                ? sections[savedProgressState.sectionIndex]?.title ?? "previous section"
                : "summary"}
            </strong>
            ?
          </span>
          <div className="flex gap-2">
            <button
              onClick={handleResume}
              className="btn-primary px-4 py-2 text-[0.8125rem]"
            >
              Resume
            </button>
            <button
              onClick={handleStartFromBeginning}
              className="btn-secondary px-4 py-2 text-[0.8125rem]"
            >
              Start over
            </button>
          </div>
        </div>
      )}

      {/* Hidden audio element for playback */}
      {audioUrl && (
        <audio
          ref={audioRef}
          src={audioUrl}
          preload="metadata"
          aria-hidden="true"
          className="hidden"
        />
      )}

      {/* Audio error */}
      {audioError && (
        <div className="garden-bed p-5 mb-6 animate-fade-in-up-delay-1">
          <div className="alert-banner alert-error" role="alert">
            <svg
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth={2}
              strokeLinecap="round"
              strokeLinejoin="round"
              width={20}
              height={20}
              aria-hidden="true"
              className="shrink-0 mt-0.5"
            >
              <path d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z" />
            </svg>
            <div>
              <p className="text-sm">{audioError}</p>
              <button
                onClick={() =>
                  generateAudio(
                    "summary",
                    `${displayArticle.title} \u2014 Summary`,
                    null,
                  )
                }
                className="btn-secondary mt-3 px-4 py-2 text-sm"
                aria-label="Try generating audio again"
              >
                Try again
              </button>
            </div>
          </div>
        </div>
      )}

      {/* 3. Table of contents with per-section audio */}
      <div
        className="animate-fade-in-up-delay-2 mb-6"
      >
        <TableOfContents
          articleTitle={displayArticle.title}
          wikiPageId={wikiPageId}
          summaryText={displayArticle.summary}
          sections={sections}
          sectionDurations={cachedAudio?.durations}
          activeSectionIndex={activeSectionIndex}
          isGenerating={audioLoading}
          isPlayingAll={isPlayingAll}
          isPaused={isPaused}
          isSpeaking={isSpeaking}
          onListenSection={(index) =>
            handleListenSection(index, sections, displayArticle.title)
          }
          onListenSummary={() =>
            handleListenSummary(displayArticle.title)
          }
          onPlayAll={() =>
            handlePlayAll(sections, displayArticle.title)
          }
          onStopPlayAll={handleStopPlayAll}
          onTogglePlayAll={handleTogglePlayAll}
          onDownloadAll={handleDownloadAll}
          downloading={downloading}
          downloadProgress={downloadProgress}
          playbackRate={playbackRate}
          onPlaybackRateChange={setPlaybackRate}
          audioProgress={
            audioUrl
              ? { currentTime: audioElCurrentTime, duration: audioElDuration }
              : undefined
          }
          onSeek={audioElSeek}
          playAllRef={playAllRef}
        />
      </div>

      {/* 4. Gallery */}
      <div className="animate-fade-in-up-delay-2 mb-6">
        <ArticleGallery wikiPageId={wikiPageId} />
      </div>

      {/* 5. Related articles (shown after playback finishes) */}
      {finishedPlaying && (
        <div className="animate-fade-in-up mb-6">
          <RelatedArticles wikiPageId={wikiPageId} currentTitle={displayArticle.title} />
        </div>
      )}

      {/* 6. Article metadata */}
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
