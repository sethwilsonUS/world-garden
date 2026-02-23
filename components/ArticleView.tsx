"use client";

import { useEffect, useState, useCallback, useRef } from "react";
import { useData } from "@/lib/data-context";
import { TableOfContents } from "./TableOfContents";
import { ArticleHeader } from "./ArticleHeader";
import { BookmarkButton } from "./BookmarkButton";
import { RelatedArticles } from "./RelatedArticles";
import { usePlaybackRate } from "@/hooks/usePlaybackRate";
import { useHistory } from "@/hooks/useHistory";
import { useElevenLabsSettings, generateElevenLabsAudio } from "@/hooks/useElevenLabsSettings";
import { useAudioElement } from "@/hooks/useAudioElement";
import { awaitSummaryAudio } from "@/lib/audio-prefetch";
import { normalizeTtsText } from "@/convex/lib/elevenlabs";

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
  const elevenLabs = useElevenLabsSettings();

  const [audioUrl, setAudioUrl] = useState<string | null>(null);
  const [audioLoading, setAudioLoading] = useState(false);
  const [downloading, setDownloading] = useState(false);
  const [downloadProgress, setDownloadProgress] = useState<{ current: number; total: number }>({ current: 0, total: 0 });
  const [savedProgressState, setSavedProgressState] = useState<{ sectionKey?: string; sectionIndex?: number | null } | null>(null);

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

  const prefetchTriggered = useRef(false);
  useEffect(() => {
    if (!displayArticle || elevenLabs.isConfigured || prefetchTriggered.current) return;
    prefetchTriggered.current = true;

    const inflight = awaitSummaryAudio(slug);
    if (inflight) {
      inflight.then((url) => {
        if (url) edgeTtsCache.current.set("summary", url);
      }).catch(() => {});
      return;
    }

    const summaryText = displayArticle.summary ?? "";
    if (summaryText.length < 10) return;
    generateEdgeTtsFromApi(summaryText, "summary").catch(() => {});
  }, [displayArticle, elevenLabs.isConfigured, generateEdgeTtsFromApi, slug]);

  const sectionsRef = useRef<Section[]>([]);

  const getTextForSection = useCallback((sectionKey: string): string => {
    if (sectionKey === "summary") return summaryTextRef.current;
    const idx = parseInt(sectionKey.replace("section-", ""), 10);
    const section = sectionsRef.current[idx];
    return section ? `${section.title}. ${section.content}` : "";
  }, []);

  const prefetchAudio = useCallback(
    (sectionKey: string) => {
      const text = getTextForSection(sectionKey);
      if (!text || text.length < 10) return;
      if (elevenLabs.isConfigured) {
        generateElevenLabsAudio(text, elevenLabs.apiKey, elevenLabs.voiceId).catch(() => {});
      } else {
        generateEdgeTtsFromApi(text, sectionKey).catch(() => {});
      }
    },
    [elevenLabs.isConfigured, elevenLabs.apiKey, elevenLabs.voiceId, generateEdgeTtsFromApi, getTextForSection],
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

      const textContent = getTextForSection(sectionKey);

      if (!textContent || textContent.length < 10) {
        setAudioError("Section text is too short to read aloud.");
        return;
      }

      setAudioLoading(true);
      pendingAutoPlay.current = true;

      const audioPromise = elevenLabs.isConfigured
        ? generateElevenLabsAudio(textContent, elevenLabs.apiKey, elevenLabs.voiceId)
        : generateEdgeTtsFromApi(textContent, sectionKey);

      audioPromise
        .then((url) => {
          if (requestId.current !== currentRequest) return;
          setAudioUrl(url);
          setAudioLoading(false);
        })
        .catch((err) => {
          if (requestId.current !== currentRequest) return;
          setAudioError(err instanceof Error ? err.message : "Audio generation failed");
          setAudioLoading(false);
          pendingAutoPlay.current = false;
        });
    },
    [slug, updateProgress, elevenLabs.isConfigured, elevenLabs.apiKey, elevenLabs.voiceId, generateEdgeTtsFromApi, getTextForSection],
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

        let url: string | null = null;
        if (elevenLabs.isConfigured) {
          let textContent: string;
          if (sectionKeys[i] === "summary") {
            textContent = displayArticle.summary ?? "";
          } else {
            const idx = parseInt(sectionKeys[i].replace("section-", ""), 10);
            const section = allSections[idx];
            textContent = section ? `${section.title}. ${section.content}` : "";
          }
          if (textContent.length >= 10) {
            url = await generateElevenLabsAudio(textContent, elevenLabs.apiKey, elevenLabs.voiceId);
          }
        } else {
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
  }, [displayArticle, downloading, elevenLabs.isConfigured, elevenLabs.apiKey, elevenLabs.voiceId, generateEdgeTtsFromApi]);

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

      {displayArticle.thumbnailUrl && (
        <div className="mb-4 overflow-hidden rounded-xl" aria-hidden="true">
          <img
            src={displayArticle.thumbnailUrl}
            alt=""
            className="w-full max-h-40 sm:max-h-60 object-cover"
            loading="eager"
          />
        </div>
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

      {/* 4. Related articles (shown after playback finishes) */}
      {finishedPlaying && (
        <div className="animate-fade-in-up mb-6">
          <RelatedArticles wikiPageId={wikiPageId} currentTitle={displayArticle.title} />
        </div>
      )}

      {/* 5. Article metadata */}
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
