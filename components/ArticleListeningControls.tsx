"use client";

import { useMemo, useState, type Ref } from "react";
import type { Section, WikipediaRevisionIdentity } from "@/lib/data-context";
import { buildArticleNarrationTracks } from "@/lib/section-narration";
import {
  PLAYBACK_RATES,
  type PlaybackRate,
  formatRate,
} from "@/hooks/usePlaybackRate";
import {
  AudioDownloadButton,
  DownloadSpinnerIcon,
} from "@/components/AudioDownloadButton";
import { ManagedAudioDownloadButton } from "@/components/ManagedAudioDownloadButton";
import {
  PauseIcon,
  PlayIcon,
  SpeedButton,
  SpinnerIcon,
} from "@/components/AudioPlaybackPresentation";
import type { AudioPlaybackState } from "@/lib/article-audio-playback";
import {
  TTS_WORDS_PER_SECOND,
  formatDuration,
  formatDurationAccessible,
} from "@/components/TableOfContents";

type ArticleListeningControlsProps = {
  playAllButtonRef?: Ref<HTMLButtonElement>;
  identity: Pick<WikipediaRevisionIdentity, "title" | "revisionId"> & {
    narrationVersion: number;
  };
  summaryText?: string;
  sections: Section[];
  sectionDurations?: Record<string, number>;
  playback: AudioPlaybackState;
  downloading?: boolean;
  downloadProgress?: { current: number; total: number };
  downloadStatus?: "queued" | "running" | "ready" | "failed" | null;
  downloadStage?: "queued" | "rendering_audio" | "packaging" | null;
  onPlayAll: () => void;
  onWarmPlayAll?: () => void;
  onStopPlayAll: () => void;
  onTogglePlayAll?: () => void;
  onSkipSection?: () => void;
  onDownloadAll?: () => void;
  downloadHref?: string;
  playbackRate?: number;
  onPlaybackRateChange?: (rate: PlaybackRate) => void;
  fallbackVoiceNotice?: string | null;
};

const countWords = (text: string): number =>
  text.split(/\s+/).filter(Boolean).length;

const secondaryButtonClass =
  "inline-flex min-h-[44px] max-w-full flex-wrap items-center justify-center gap-[8px] rounded-xl border border-border bg-surface-2 px-[14px] py-[10px] text-center text-sm font-semibold leading-snug text-foreground-2 transition-colors duration-200 motion-reduce:transition-none focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent focus-visible:ring-offset-2 focus-visible:ring-offset-background";

const StopIcon = () => (
  <svg
    viewBox="0 0 24 24"
    fill="currentColor"
    width={16}
    height={16}
    aria-hidden="true"
    focusable="false"
    className="shrink-0"
  >
    <rect x="6" y="6" width="12" height="12" rx="2" />
  </svg>
);

const SkipNextIcon = () => (
  <svg
    viewBox="0 0 24 24"
    fill="currentColor"
    width={16}
    height={16}
    aria-hidden="true"
    focusable="false"
    className="shrink-0"
  >
    <polygon points="4,4 16,12 4,20" />
    <rect x="17" y="4" width="3" height="16" rx="0.5" />
  </svg>
);

/**
 * The article's primary listening bar: Play all (with the total playtime),
 * Stop/Skip while a Play all queue runs, Download, and Speed. It sits directly
 * under the article title so listening never waits behind the summary.
 */
export const ArticleListeningControls = ({
  playAllButtonRef,
  identity,
  summaryText,
  sections,
  sectionDurations,
  playback,
  downloading = false,
  downloadProgress,
  downloadStatus = null,
  downloadStage = null,
  onPlayAll,
  onWarmPlayAll,
  onStopPlayAll,
  onTogglePlayAll,
  onSkipSection,
  onDownloadAll,
  downloadHref,
  playbackRate = 1,
  onPlaybackRateChange,
  fallbackVoiceNotice,
}: ArticleListeningControlsProps) => {
  const articleTitle = identity.title;
  const [rateAnnouncement, setRateAnnouncement] = useState("");
  const cycleSpeed = () => {
    if (!onPlaybackRateChange) return;
    const idx = PLAYBACK_RATES.indexOf(playbackRate as PlaybackRate);
    const next = PLAYBACK_RATES[(idx + 1) % PLAYBACK_RATES.length];
    onPlaybackRateChange(next);
    setRateAnnouncement(`Playback speed ${formatRate(next)}`);
  };

  const isGenerating = playback.status === "loading";
  const isPaused = playback.status === "paused";
  const isSpeaking =
    playback.status === "playing" || playback.status === "paused";
  const isPlayingAll =
    playback.mode === "play_all" &&
    playback.status !== "idle" &&
    playback.status !== "error";

  const narrationTracks = useMemo(
    () =>
      buildArticleNarrationTracks({
        title: articleTitle,
        revisionId: identity.revisionId,
        narrationVersion: identity.narrationVersion,
        summary: summaryText,
        sections,
      }),
    [
      articleTitle,
      identity.narrationVersion,
      identity.revisionId,
      sections,
      summaryText,
    ],
  );
  const sectionTracks = narrationTracks.filter(
    (track) => track.sectionIdx !== null,
  );
  const playableCount = narrationTracks.length;
  const summaryOnly = sectionTracks.length === 0;
  const isPlayAllLoading = isPlayingAll && isGenerating;
  const canSkipSection = isPlayingAll && (isSpeaking || isGenerating);
  const playAllBlocked = !isPlayingAll && (isGenerating || downloading);

  let totalSeconds = 0;
  let allActual = true;
  const summaryDuration = sectionDurations?.["summary"];
  if (summaryDuration != null) {
    totalSeconds += summaryDuration;
  } else if (summaryText) {
    totalSeconds += Math.round(countWords(summaryText) / TTS_WORDS_PER_SECOND);
    allActual = false;
  }
  for (const track of sectionTracks) {
    const actual = sectionDurations?.[track.sectionKey];
    if (actual != null) {
      totalSeconds += actual;
    } else {
      totalSeconds += Math.round(countWords(track.text) / TTS_WORDS_PER_SECOND);
      allActual = false;
    }
  }
  const adjustedSeconds = Math.round(totalSeconds / playbackRate);
  const totalPlaytime = formatDuration(adjustedSeconds, !allActual);
  const totalPlaytimeAccessible = formatDurationAccessible(
    adjustedSeconds,
    !allActual,
  );

  const downloadLabel = summaryOnly ? "Download" : "Download all";
  const downloadAccessibleLabel = summaryOnly
    ? "Download summary as audio file"
    : "Download all audio as one file";
  const totalTracks = downloadProgress?.total ?? 0;
  const renderedTracks = Math.min(downloadProgress?.current ?? 0, totalTracks);
  const progressLabel = `${renderedTracks} of ${totalTracks} ready`;

  const playAllLabel = isPlayingAll
    ? isPlayAllLoading
      ? summaryOnly
        ? "Stop summary"
        : "Stop playing all sections"
      : isPaused
        ? summaryOnly
          ? "Resume playing summary"
          : "Resume playing all sections"
        : summaryOnly
          ? "Pause summary"
          : "Pause playing all sections"
    : isGenerating
      ? "Loading audio, please wait"
      : summaryOnly
        ? `Play summary, ${totalPlaytimeAccessible}`
        : `Play all ${playableCount} audio items including summary, ${totalPlaytimeAccessible}`;

  const playAllContent = isPlayingAll ? (
    isPlayAllLoading ? (
      <>
        <SpinnerIcon />
        <span>Stop</span>
      </>
    ) : isPaused ? (
      <>
        <PlayIcon />
        <span>Resume</span>
      </>
    ) : (
      <>
        <PauseIcon />
        <span>Pause</span>
      </>
    )
  ) : isGenerating ? (
    <>
      <SpinnerIcon />
      <span>Loading</span>
    </>
  ) : (
    <>
      <PlayIcon />
      <span>{summaryOnly ? "Play summary" : "Play all"}</span>
    </>
  );

  return (
    <div
      className="min-w-0 [overflow-wrap:anywhere]"
      data-article-listening-controls
    >
      <h2 className="sr-only">Listen to this article</h2>
      <div className="flex min-w-0 flex-wrap items-center gap-[8px]">
        <button
          ref={playAllButtonRef}
          type="button"
          onMouseEnter={onWarmPlayAll}
          onFocus={onWarmPlayAll}
          onPointerDown={onWarmPlayAll}
          onTouchStart={onWarmPlayAll}
          onClick={(e) => {
            if (playAllBlocked) return;
            if (isPlayingAll) {
              if (isPlayAllLoading) {
                onStopPlayAll();
              } else {
                (onTogglePlayAll ?? onStopPlayAll)();
              }
            } else {
              onPlayAll();
            }
            e.currentTarget.focus();
          }}
          aria-disabled={playAllBlocked || undefined}
          aria-label={playAllLabel}
          className={`inline-flex min-h-[48px] max-w-full flex-wrap items-center justify-center gap-[10px] rounded-xl px-[22px] py-[12px] text-center text-base font-semibold leading-snug transition-colors duration-200 motion-reduce:transition-none focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent focus-visible:ring-offset-2 focus-visible:ring-offset-background ${
            isPlayingAll
              ? "cursor-pointer border border-border bg-surface-3 text-foreground"
              : playAllBlocked
                ? "cursor-not-allowed border border-border bg-surface-3 text-foreground-2"
                : "search-submit cursor-pointer border-0 bg-btn-primary text-btn-primary-text"
          }`}
        >
          {playAllContent}
        </button>
        {!isPlayingAll && !isGenerating && (
          <span
            aria-hidden="true"
            className="text-sm tabular-nums text-muted"
            data-play-all-duration
          >
            {totalPlaytime}
          </span>
        )}

        {isPlayingAll && !isPlayAllLoading && (
          <button
            type="button"
            onClick={onStopPlayAll}
            className={`${secondaryButtonClass} cursor-pointer`}
            aria-label={
              summaryOnly ? "Stop summary" : "Stop playing all sections"
            }
          >
            <StopIcon />
            <span>Stop</span>
          </button>
        )}

        {isPlayingAll && !summaryOnly && onSkipSection && (
          <button
            type="button"
            onClick={onSkipSection}
            disabled={!canSkipSection}
            className={`${secondaryButtonClass} ${
              !canSkipSection ? "cursor-not-allowed" : "cursor-pointer"
            }`}
            aria-label="Skip section"
          >
            <SkipNextIcon />
            <span className="hidden sm:inline">Skip section</span>
          </button>
        )}

        {(onDownloadAll || downloadHref) &&
          (downloadHref && !downloading ? (
            <ManagedAudioDownloadButton
              href={downloadHref}
              title={articleTitle}
              label={downloadLabel}
              ariaLabel={downloadAccessibleLabel}
            />
          ) : onDownloadAll ? (
            <AudioDownloadButton
              onClick={onDownloadAll}
              disabled={downloading || isGenerating}
              label={downloadLabel}
              ariaLabel={
                downloadStatus === "queued"
                  ? "Queued article download"
                  : downloadStage === "packaging"
                    ? "Packaging article download"
                    : downloading
                      ? `${progressLabel} for article download`
                      : downloadAccessibleLabel
              }
            >
              {downloadStatus === "queued" ? (
                <>
                  <DownloadSpinnerIcon />
                  Queued
                </>
              ) : downloadStage === "packaging" ? (
                <>
                  <DownloadSpinnerIcon />
                  Packaging
                </>
              ) : downloading ? (
                <>
                  <DownloadSpinnerIcon />
                  {progressLabel}
                </>
              ) : undefined}
            </AudioDownloadButton>
          ) : null)}

        {onPlaybackRateChange && (
          <SpeedButton rate={playbackRate} onClick={cycleSpeed} />
        )}
      </div>

      <p className="mb-0 mt-2 text-sm leading-normal text-muted">
        {summaryOnly
          ? "Summary only. "
          : `${playableCount} audio items, including the summary. `}
        Audio is generated with synthetic speech.
      </p>
      {fallbackVoiceNotice ? (
        <p
          className="mb-0 mt-3 rounded-xl border border-border bg-surface-2 px-3 py-2 text-sm leading-normal text-foreground-2"
          role="status"
          aria-live="polite"
        >
          {fallbackVoiceNotice}
        </p>
      ) : null}
      {playback.status === "loading" && playback.slowLoading ? (
        <p
          className="mb-0 mt-3 rounded-xl border border-border bg-surface-2 px-3 py-2 text-sm leading-normal text-foreground-2"
          role="status"
          aria-live="polite"
        >
          Still generating audio. This is taking a little longer than usual.
        </p>
      ) : null}

      {/* Play all section changes are announced once by the Now playing bar;
          this region covers user-started single sections and the summary. */}
      <div aria-live="polite" className="sr-only">
        {isGenerating &&
          playback.mode !== "play_all" &&
          (playback.sectionIdx !== null
            ? `Generating audio for ${sections[playback.sectionIdx]?.title ?? "section"}, please wait.`
            : "Generating summary audio, please wait.")}
      </div>
      <div aria-live="polite" className="sr-only" role="status">
        {rateAnnouncement}
      </div>
    </div>
  );
};
