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
import { normalizeTtsText } from "@/convex/lib/elevenlabs";
import { useBrowserTtsVoice } from "@/hooks/useBrowserTtsVoice";
import { useBrowserTts } from "@/hooks/useBrowserTts";
import { useAudioElement } from "@/hooks/useAudioElement";

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
  sections?: Section[];
  lastEdited?: string;
};

type QueueItem = {
  sectionKey: string;
  label: string;
  sectionIdx: number | null;
};

export const ArticleView = ({ slug }: { slug: string }) => {
  const {
    fetchArticle,
    getSectionLinkCounts,
    getCitationCounts,
  } = useData();

  const [displayArticle, setDisplayArticle] = useState<ArticleData | null>(
    null,
  );
  const [fetching, setFetching] = useState(true);
  const [fetchError, setFetchError] = useState<string | null>(null);

  const [audioLabel, setAudioLabel] = useState("");
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
  const playbackRateRef = useRef(playbackRate);

  const { recordVisit, updateProgress, getProgress } = useHistory();
  const elevenLabs = useElevenLabsSettings();
  const ttsVoiceRef = useBrowserTtsVoice();
  const [elevenLabsUrl, setElevenLabsUrl] = useState<string | null>(null);
  const [elevenLabsLoading, setElevenLabsLoading] = useState(false);
  const [savedProgressState, setSavedProgressState] = useState<{ sectionKey?: string; sectionIndex?: number | null } | null>(null);

  const wikiPageId = displayArticle?.wikiPageId ?? "";

  const [linkCounts, setLinkCounts] = useState<Record<string, number> | null>(null);
  const [citationCounts, setCitationCounts] = useState<Record<string, number> | null>(null);

  const requestId = useRef(0);
  const playAllQueue = useRef<QueueItem[]>([]);
  const [queueLength, setQueueLength] = useState(0);
  const lastPlayedSectionIdx = useRef<number | null>(null);
  const summaryTextRef = useRef("");
  const countsFetched = useRef(false);
  const fetchTriggered = useRef(false);
  const pendingElevenLabsPlay = useRef(false);
  const summaryListenRef = useRef<HTMLButtonElement>(null);

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

  useEffect(() => {
    if (!wikiPageId || countsFetched.current) return;
    countsFetched.current = true;
    getSectionLinkCounts({ wikiPageId })
      .then((arr) => {
        const map: Record<string, number> = {};
        for (const { title, count } of arr) map[title] = count;
        setLinkCounts(map);
      })
      .catch(() => {});
    getCitationCounts({ wikiPageId })
      .then((arr) => {
        const map: Record<string, number> = {};
        for (const { title, count } of arr) map[title] = count;
        setCitationCounts(map);
      })
      .catch(() => {});
  }, [wikiPageId, getSectionLinkCounts, getCitationCounts]);
  const sectionsRef = useRef<Section[]>([]);
  const linkCountsRef = useRef(linkCounts);
  const citationCountsRef = useRef(citationCounts);

  const audioEndedRef = useRef<() => void>(() => {});

  const browserTts = useBrowserTts({
    onEnded: () => audioEndedRef.current(),
    onPausedChange: setIsPaused,
    onSpeakingChange: setIsSpeaking,
    playbackRate,
  });

  const audioEl = useAudioElement({
    url: elevenLabsUrl,
    onEnded: () => audioEndedRef.current(),
    playbackRate,
  });

  // Sync isSpeaking/isPaused from ElevenLabs audio element state
  useEffect(() => {
    if (!elevenLabs.isConfigured) return;
    if (audioEl.playing) {
      setIsSpeaking(true);
      setIsPaused(false);
    }
  }, [audioEl.playing, elevenLabs.isConfigured]);

  // Auto-play ElevenLabs audio when URL arrives from a user action
  useEffect(() => {
    if (elevenLabsUrl && !elevenLabsLoading && pendingElevenLabsPlay.current) {
      pendingElevenLabsPlay.current = false;
      const timer = setTimeout(() => audioEl.play(), 100);
      return () => clearTimeout(timer);
    }
  }, [elevenLabsUrl, elevenLabsLoading, audioEl.play]);

  useEffect(() => {
    playbackRateRef.current = playbackRate;
    sectionsRef.current = displayArticle?.sections ?? [];
    summaryTextRef.current = displayArticle?.summary ?? "";
    linkCountsRef.current = linkCounts;
    citationCountsRef.current = citationCounts;
  });

  const speakSectionMetadata = useCallback(
    (onDone: () => void) => {
      const idx = lastPlayedSectionIdx.current;
      const sectionTitle =
        idx !== null ? (sectionsRef.current[idx]?.title ?? null) : null;
      const linkKey = sectionTitle ?? "__summary__";
      const citationKey = sectionTitle ?? "__summary__";
      const links = linkCountsRef.current?.[linkKey] ?? 0;
      const citations = citationCountsRef.current?.[citationKey] ?? 0;

      if (
        (links === 0 && citations === 0) ||
        typeof window === "undefined" ||
        !window.speechSynthesis
      ) {
        onDone();
        return;
      }

      const subject = sectionTitle === null ? "This summary" : "This section";
      const parts: string[] = [];
      if (citations > 0)
        parts.push(
          `references ${citations} source${citations === 1 ? "" : "s"}`,
        );
      if (links > 0)
        parts.push(
          `links to ${links} related article${links === 1 ? "" : "s"}`,
        );

      const utterance = new SpeechSynthesisUtterance(
        `${subject} ${parts.join(" and ")}.`,
      );
      if (ttsVoiceRef.current) utterance.voice = ttsVoiceRef.current;
      utterance.rate = playbackRateRef.current;
      utterance.onend = onDone;
      utterance.onerror = onDone;
      window.speechSynthesis.speak(utterance);
    },
    [ttsVoiceRef],
  );

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

      let textContent: string;
      if (sectionKey === "summary") {
        textContent = summaryTextRef.current;
      } else {
        const idx = parseInt(sectionKey.replace("section-", ""), 10);
        const section = sectionsRef.current[idx];
        textContent = section ? `${section.title}. ${section.content}` : "";
      }

      if (!textContent || textContent.length < 10) {
        setAudioError("Section text is too short to read aloud.");
        return;
      }

      updateProgress(slug, sectionKey, sectionIdx);

      if (elevenLabs.isConfigured) {
        setElevenLabsLoading(true);
        browserTts.cancel();
        pendingElevenLabsPlay.current = true;
        generateElevenLabsAudio(textContent, elevenLabs.apiKey, elevenLabs.voiceId)
          .then((url) => {
            if (requestId.current !== currentRequest) return;
            setElevenLabsUrl(url);
            setAudioLabel(label);
            setElevenLabsLoading(false);
          })
          .catch((err) => {
            if (requestId.current !== currentRequest) return;
            setAudioError(err instanceof Error ? err.message : "ElevenLabs TTS failed");
            setElevenLabsLoading(false);
            pendingElevenLabsPlay.current = false;
          });
      } else {
        setElevenLabsUrl(null);
        audioEl.pause();
        setAudioLabel(label);
        browserTts.speak(normalizeTtsText(textContent));
      }
    },
    [slug, updateProgress, elevenLabs.isConfigured, elevenLabs.apiKey, elevenLabs.voiceId, browserTts, audioEl],
  );

  const handleAudioEnded = useCallback(() => {
    const advance = () => {
      if (!isPlayingAll || playAllQueue.current.length === 0) {
        setIsPlayingAll(false);
        setActiveSectionIndex(null);
        setQueueLength(0);
        setIsSpeaking(false);
        setIsPaused(false);
        if (isPlayingAll) {
          setFinishedPlaying(true);
        }
        return;
      }
      const next = playAllQueue.current.shift()!;
      setQueueLength(playAllQueue.current.length);
      generateAudio(next.sectionKey, next.label, next.sectionIdx);
    };

    if (isPlayingAll) {
      advance();
    } else {
      speakSectionMetadata(advance);
    }
  }, [isPlayingAll, generateAudio, speakSectionMetadata]);

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
      setQueueLength(queue.length);
      setIsPlayingAll(true);
      generateAudio(first.sectionKey, first.label, first.sectionIdx);
    },
    [generateAudio],
  );

  const handleStopPlayAll = useCallback(() => {
    playAllQueue.current = [];
    setQueueLength(0);
    setIsPlayingAll(false);
    setIsSpeaking(false);
    setIsPaused(false);
    browserTts.cancel();
    audioEl.pause();
  }, [browserTts, audioEl]);

  const handleTogglePlayAll = useCallback(() => {
    if (isPaused) {
      if (elevenLabs.isConfigured) {
        audioEl.play();
      } else {
        browserTts.toggle();
      }
      setIsPaused(false);
    } else {
      if (elevenLabs.isConfigured) {
        audioEl.pause();
      } else {
        browserTts.toggle();
      }
      setIsPaused(true);
    }
  }, [isPaused, elevenLabs.isConfigured, audioEl, browserTts]);

  const handleListenSection = useCallback(
    (index: number, sections: Section[], articleTitle: string) => {
      if (activeSectionIndex === index && isSpeaking) {
        if (elevenLabs.isConfigured) {
          if (audioEl.playing) {
            audioEl.pause();
            setIsPaused(true);
          } else {
            audioEl.play();
            setIsPaused(false);
          }
        } else {
          browserTts.toggle();
        }
        return;
      }
      playAllQueue.current = [];
      setQueueLength(0);
      setIsPlayingAll(false);
      const section = sections[index];
      generateAudio(
        `section-${index}`,
        `${section.title} \u2014 ${articleTitle}`,
        index,
      );
    },
    [generateAudio, activeSectionIndex, isSpeaking, elevenLabs.isConfigured, audioEl, browserTts],
  );

  const handleListenSummary = useCallback(
    (articleTitle: string) => {
      if (activeSectionIndex === null && isSpeaking) {
        if (elevenLabs.isConfigured) {
          if (audioEl.playing) {
            audioEl.pause();
            setIsPaused(true);
          } else {
            audioEl.play();
            setIsPaused(false);
          }
        } else {
          browserTts.toggle();
        }
        return;
      }
      playAllQueue.current = [];
      setQueueLength(0);
      setIsPlayingAll(false);
      generateAudio("summary", `${articleTitle} \u2014 Summary`, null);
    },
    [generateAudio, activeSectionIndex, isSpeaking, elevenLabs.isConfigured, audioEl, browserTts],
  );

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
      summaryListenRef.current?.focus({ preventScroll: true });
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

      {/* Hidden audio element for ElevenLabs playback */}
      {elevenLabsUrl && (
        <audio
          ref={audioEl.audioRef}
          src={elevenLabsUrl}
          preload="metadata"
          aria-hidden="true"
          className="hidden"
        />
      )}

      {/* ElevenLabs loading indicator */}
      {elevenLabsLoading && (
        <div
          className="garden-bed flex items-center gap-3 py-3 px-4 mb-6 animate-fade-in-up-delay-1"
          role="status"
        >
          <svg
            className="animate-spin text-accent shrink-0"
            fill="none"
            viewBox="0 0 24 24"
            width={18}
            height={18}
            aria-hidden="true"
          >
            <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
            <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z" />
          </svg>
          <span className="text-[0.8125rem] text-muted">
            Generating audio with ElevenLabs...
          </span>
        </div>
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
          isGenerating={elevenLabsLoading}
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
          playbackRate={playbackRate}
          onPlaybackRateChange={setPlaybackRate}
          isElevenLabs={elevenLabs.isConfigured}
          audioProgress={
            elevenLabs.isConfigured && elevenLabsUrl
              ? { currentTime: audioEl.currentTime, duration: audioEl.duration }
              : undefined
          }
          onSeek={elevenLabs.isConfigured ? audioEl.seek : undefined}
          summaryListenRef={summaryListenRef}
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
