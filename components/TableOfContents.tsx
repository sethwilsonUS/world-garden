"use client";

import { useState, useEffect, useRef, type RefObject } from "react";
import { InfoTooltip } from "@/components/InfoTooltip";
import { useData } from "@/lib/data-context";
import type { Section } from "@/lib/data-context";
import {
  getAudioReasonLabel,
  getSoftAudioTooltip,
  hasFullAudio,
} from "@/lib/audio-suitability";
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
import type { ContextBlock } from "@/lib/article-context-types";
import {
  ContextSectionLink,
  getContextBlocksForSection,
} from "@/components/ArticleContext";
import {
  InlineProgressBar,
  PauseIcon,
  PlayIcon,
  SectionDetailsBadge,
  SectionDetailsPanel,
  SoundIcon,
  SpeedButton,
  SpinnerIcon,
} from "@/components/TableOfContentsPresentation";

export type AudioPlaybackStatus = "idle" | "loading" | "playing" | "paused" | "error";
export type AudioPlaybackMode = "single" | "play_all";

export type AudioPlaybackState = {
  status: AudioPlaybackStatus;
  sectionKey: string | null;
  sectionIdx: number | null;
  label: string | null;
  mode: AudioPlaybackMode;
  slowLoading: boolean;
};

type TableOfContentsProps = {
  articleTitle: string;
  wikiPageId: string;
  summaryText?: string;
  sections: Section[];
  sectionDurations?: Record<string, number>;
  playback?: AudioPlaybackState;
  activeSectionIndex?: number | null;
  isGenerating?: boolean;
  isPlayingAll?: boolean;
  isPaused?: boolean;
  isSpeaking?: boolean;
  downloading?: boolean;
  downloadProgress?: { current: number; total: number };
  downloadStatus?: "queued" | "running" | "ready" | "failed" | null;
  downloadStage?: "queued" | "rendering_audio" | "packaging" | null;
  onListenSection: (index: number) => void;
  onListenSummary: () => void;
  onPlayAll: () => void;
  onWarmPlayAll?: () => void;
  onWarmSummary?: () => void;
  onWarmSection?: (index: number) => void;
  onStopPlayAll: () => void;
  onTogglePlayAll?: () => void;
  onSkipSection?: () => void;
  onDownloadAll?: () => void;
  downloadHref?: string;
  playbackRate?: number;
  onPlaybackRateChange?: (rate: PlaybackRate) => void;
  audioProgress?: { currentTime: number; duration: number };
  onSeek?: (time: number) => void;
  playAllRef?: RefObject<HTMLButtonElement | null>;
  fallbackVoiceNotice?: string | null;
  contextBlocks?: ContextBlock[];
};

export const TTS_WORDS_PER_SECOND = 2.5;

export const formatDuration = (totalSeconds: number, estimated: boolean): string => {
  const h = Math.floor(totalSeconds / 3600);
  const m = Math.floor((totalSeconds % 3600) / 60);
  const s = totalSeconds % 60;
  const prefix = estimated ? "~" : "";
  if (h > 0) {
    if (s > 0) return `${prefix}${h}h ${m}m ${s}s`;
    if (m > 0) return `${prefix}${h}h ${m}m`;
    return `${prefix}${h}h`;
  }
  if (m === 0) return `${prefix}${s}s`;
  return s > 0 ? `${prefix}${m}m ${s}s` : `${prefix}${m}m`;
};

const pluralize = (n: number, unit: string): string =>
  `${n} ${unit}${n === 1 ? "" : "s"}`;

export const formatDurationAccessible = (totalSeconds: number, estimated: boolean): string => {
  const h = Math.floor(totalSeconds / 3600);
  const m = Math.floor((totalSeconds % 3600) / 60);
  const s = totalSeconds % 60;
  const prefix = estimated ? "approximately " : "";
  const parts: string[] = [];
  if (h > 0) parts.push(pluralize(h, "hour"));
  if (m > 0) parts.push(pluralize(m, "minute"));
  if (s > 0 || parts.length === 0) parts.push(pluralize(s, "second"));
  return `${prefix}${parts.join(" ")}`;
};

export const estimateDuration = (text: string, rate: number): string => {
  const words = text.split(/\s+/).filter(Boolean).length;
  const totalSeconds = Math.round(words / TTS_WORDS_PER_SECOND / rate);
  return formatDuration(totalSeconds, true);
};

export const durationLabel = (
  sectionKey: string,
  text: string,
  durations?: Record<string, number>,
  rate = 1,
): string => {
  const actual = durations?.[sectionKey];
  if (actual != null) return formatDuration(Math.round(actual / rate), false);
  return estimateDuration(text, rate);
};

const estimateDurationAccessible = (text: string, rate: number): string => {
  const words = text.split(/\s+/).filter(Boolean).length;
  const totalSeconds = Math.round(words / TTS_WORDS_PER_SECOND / rate);
  return formatDurationAccessible(totalSeconds, true);
};

const durationLabelAccessible = (
  sectionKey: string,
  text: string,
  durations?: Record<string, number>,
  rate = 1,
): string => {
  const actual = durations?.[sectionKey];
  if (actual != null) return formatDurationAccessible(Math.round(actual / rate), false);
  return estimateDurationAccessible(text, rate);
};

const rowClass =
  "toc-row flex flex-col items-stretch justify-between gap-2 w-full py-2.5 px-3 rounded-xl text-left sm:flex-row sm:items-center sm:gap-4";

const pillClass = "inline-flex items-center gap-[5px] px-3 py-[5px] rounded-full font-semibold text-xs leading-none whitespace-nowrap shrink-0";

export const TableOfContents = ({
  articleTitle,
  wikiPageId,
  summaryText,
  sections,
  sectionDurations,
  playback,
  activeSectionIndex: legacyActiveSectionIndex = null,
  isGenerating: legacyIsGenerating = false,
  isPlayingAll: legacyIsPlayingAll = false,
  isPaused: legacyIsPaused = false,
  isSpeaking: legacyIsSpeaking = false,
  downloading = false,
  downloadProgress,
  downloadStatus = null,
  downloadStage = null,
  onListenSection,
  onListenSummary,
  onPlayAll,
  onWarmPlayAll,
  onWarmSummary,
  onWarmSection,
  onStopPlayAll,
  onTogglePlayAll,
  onSkipSection,
  onDownloadAll,
  downloadHref,
  playbackRate = 1,
  onPlaybackRateChange,
  audioProgress,
  onSeek,
  playAllRef,
  fallbackVoiceNotice,
  contextBlocks = [],
}: TableOfContentsProps) => {
  const [linkCounts, setLinkCounts] = useState<Record<string, number> | null>(
    null,
  );
  const [citationCounts, setCitationCounts] = useState<Record<string, number> | null>(
    null,
  );
  const [openPanel, setOpenPanel] = useState<string | null>(null);
  const {
    getSectionLinkCounts,
    getCitationCounts,
  } = useData();
  const metadataFetched = useRef(false);

  useEffect(() => {
    if (metadataFetched.current) return;
    metadataFetched.current = true;
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

  const [rateAnnouncement, setRateAnnouncement] = useState("");
  const cycleSpeed = () => {
    if (!onPlaybackRateChange) return;
    const idx = PLAYBACK_RATES.indexOf(playbackRate as PlaybackRate);
    const next = PLAYBACK_RATES[(idx + 1) % PLAYBACK_RATES.length];
    onPlaybackRateChange(next);
    setRateAnnouncement(`Playback speed ${formatRate(next)}`);
  };

  const effectivePlayback: AudioPlaybackState = playback ?? {
    status: legacyIsGenerating
      ? "loading"
      : legacyIsSpeaking
        ? legacyIsPaused
          ? "paused"
          : "playing"
        : "idle",
    sectionKey:
      legacyActiveSectionIndex === null
        ? "summary"
        : `section-${legacyActiveSectionIndex}`,
    sectionIdx: legacyActiveSectionIndex,
    label:
      legacyActiveSectionIndex === null
        ? "Summary"
        : sections[legacyActiveSectionIndex]?.title ?? null,
    mode: legacyIsPlayingAll ? "play_all" : "single",
    slowLoading: false,
  };

  const activeSectionIndex = effectivePlayback.sectionIdx;
  const isGenerating = effectivePlayback.status === "loading";
  const isPaused = effectivePlayback.status === "paused";
  const isSpeaking =
    effectivePlayback.status === "playing" || effectivePlayback.status === "paused";
  const isPlayingAll =
    effectivePlayback.mode === "play_all" &&
    effectivePlayback.status !== "idle" &&
    effectivePlayback.status !== "error";

  const isSummarySelected = effectivePlayback.sectionKey === "summary";
  const isSummaryPlaying = isSummarySelected && isSpeaking && !isPaused;
  const isSummaryPaused = isSummarySelected && isSpeaking && isPaused;
  const isSummaryActive = isSummaryPlaying || isSummaryPaused;
  const isSummaryLoading = isGenerating && isSummarySelected;
  const audioSections = sections.filter(hasFullAudio);
  const hasNonAudioSections = audioSections.length < sections.length;
  const playableCount = audioSections.length + 1;
  const playAllSummaryOnly = audioSections.length === 0;
  const downloadSummaryOnly = audioSections.length === 0;
  const isPlayAllLoading = isPlayingAll && isGenerating;
  const canSkipSection = isPlayingAll && (isSpeaking || isGenerating);

  const { totalPlaytime, totalPlaytimeAccessible, allActual } = (() => {
    let total = 0;
    let allActual = true;

    const summaryDur = sectionDurations?.["summary"];
    if (summaryDur != null) {
      total += summaryDur;
    } else if (summaryText) {
      total += Math.round(
        summaryText.split(/\s+/).filter(Boolean).length / TTS_WORDS_PER_SECOND,
      );
      allActual = false;
    }

    for (let i = 0; i < sections.length; i++) {
      if (!hasFullAudio(sections[i])) continue;
      const actual = sectionDurations?.[`section-${i}`];
      if (actual != null) {
        total += actual;
      } else {
        total += Math.round(
          sections[i].content.split(/\s+/).filter(Boolean).length /
            TTS_WORDS_PER_SECOND,
        );
        allActual = false;
      }
    }

    const adjusted = Math.round(total / playbackRate);
    const estimated = !allActual;
    return {
      totalPlaytime: formatDuration(adjusted, estimated),
      totalPlaytimeAccessible: formatDurationAccessible(adjusted, estimated),
      allActual,
    };
  })();

  return (
    <div className="toc-section pattern-leaves">
      <div className="flex items-start gap-3 mb-5">
        <svg
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          strokeWidth={1.5}
          strokeLinecap="round"
          strokeLinejoin="round"
          width={22}
          height={22}
          aria-hidden="true"
          className="text-accent shrink-0 mt-0.5"
        >
          <path d="M12 2C6.5 6 4 11 4 15c0 3.5 3.5 6 8 7 4.5-1 8-3.5 8-7 0-4-2.5-9-8-13z" />
          <path d="M12 2v20" />
          <path d="M12 8l-3 3" />
          <path d="M12 8l3 3" />
          <path d="M12 13l-4 3" />
          <path d="M12 13l4 3" />
        </svg>
        <div>
          <h2 className="font-display font-bold text-xl text-foreground mb-1">
            Explore this article
          </h2>
          <p className="text-[0.8125rem] text-muted m-0 leading-normal">
            {allActual ? "Playtime" : "Estimated playtime"}{playbackRate !== 1 ? ` at ${playbackRate}x` : ""}:{" "}
            <span className="font-mono font-medium text-foreground-2">
              <span aria-hidden="true">{totalPlaytime}</span>
              <span className="sr-only">{totalPlaytimeAccessible}</span>
            </span>
          </p>
        </div>
      </div>

      <div className="flex flex-wrap gap-2 mb-4">
        <button
          ref={playAllRef}
          onMouseEnter={onWarmPlayAll}
          onFocus={onWarmPlayAll}
          onPointerDown={onWarmPlayAll}
          onTouchStart={onWarmPlayAll}
          onClick={(e) => {
            if (!isPlayingAll && (isGenerating || downloading)) return;
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
          aria-disabled={
            (!isPlayingAll && (isGenerating || downloading)) || undefined
          }
          className={`inline-flex items-center gap-2 py-2.5 px-5 rounded-xl font-semibold text-sm transition-all duration-200 ${
            isPlayingAll
              ? "bg-surface-3 text-foreground border border-border cursor-pointer"
              : `search-submit bg-btn-primary text-btn-primary-text border-0 ${
                  isGenerating || downloading ? "cursor-not-allowed opacity-60" : "cursor-pointer"
                }`
          }`}
          aria-label={
            isPlayingAll
              ? isPlayAllLoading
                ? playAllSummaryOnly
                  ? "Stop summary"
                  : "Stop playing all sections"
                : isPaused
                  ? playAllSummaryOnly
                    ? "Resume playing summary"
                    : "Resume playing all sections"
                  : !isSpeaking
                    ? "Generating audio, please wait"
                    : playAllSummaryOnly
                      ? "Pause summary"
                      : "Pause playing all sections"
              : isGenerating
                ? "Generating audio, please wait"
                : playAllSummaryOnly
                  ? "Play summary"
                  : `Play all ${playableCount} audio items including summary`
          }
        >
          {isPlayingAll ? (
            isPlayAllLoading ? (
              <>
                <SpinnerIcon />
                <span aria-live="polite">Loading</span>
              </>
            ) : isPaused ? (
              <>
                <svg
                  viewBox="0 0 24 24"
                  fill="none"
                  stroke="currentColor"
                  strokeWidth={2.5}
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  width={16}
                  height={16}
                  aria-hidden="true"
                  className="shrink-0"
                >
                  <polygon points="5 3 19 12 5 21 5 3" />
                </svg>
                <span aria-live="polite">Resume</span>
              </>
            ) : !isSpeaking ? (
              <>
                <SpinnerIcon />
                <span aria-live="polite">Loading</span>
              </>
            ) : (
              <>
                <svg
                  viewBox="0 0 24 24"
                  fill="currentColor"
                  width={16}
                  height={16}
                  aria-hidden="true"
                  className="shrink-0"
                >
                  <rect x="6" y="4" width="4" height="16" rx="1" />
                  <rect x="14" y="4" width="4" height="16" rx="1" />
                </svg>
                <span aria-live="polite">Pause</span>
              </>
            )
          ) : isGenerating ? (
            <>
              <SpinnerIcon />
              <span aria-live="polite">Loading</span>
            </>
          ) : (
            <>
              <svg
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                strokeWidth={2.5}
                strokeLinecap="round"
                strokeLinejoin="round"
                width={16}
                height={16}
                aria-hidden="true"
                className="shrink-0"
              >
                <polygon points="5 3 19 12 5 21 5 3" />
              </svg>
              {playAllSummaryOnly ? "Play" : "Play all"}
              {!playAllSummaryOnly && (
                <span className="text-[0.6875rem] opacity-80 font-medium">
                  ({playableCount})
                </span>
              )}
            </>
          )}
        </button>

        {isPlayingAll && !isPlayAllLoading && (
          <button
            type="button"
            onClick={onStopPlayAll}
            className="inline-flex items-center gap-2 py-2.5 px-3 sm:px-5 bg-surface-2 text-foreground-2 border border-border rounded-xl font-semibold text-sm transition-colors duration-200 cursor-pointer"
            aria-label={playAllSummaryOnly ? "Stop summary" : "Stop playing all sections"}
          >
            <svg
              viewBox="0 0 24 24"
              fill="currentColor"
              width={16}
              height={16}
              aria-hidden="true"
              className="shrink-0"
            >
              <rect x="6" y="6" width="12" height="12" rx="2" />
            </svg>
            <span>Stop</span>
          </button>
        )}

        {isPlayingAll && !playAllSummaryOnly && onSkipSection && (
          <button
            onClick={onSkipSection}
            disabled={!canSkipSection}
            className={`inline-flex items-center gap-2 py-2.5 px-3 sm:px-5 bg-surface-2 text-foreground-2 border border-border rounded-xl font-semibold text-sm transition-colors duration-200 ${
              !canSkipSection ? "cursor-not-allowed opacity-70" : "cursor-pointer"
            }`}
            aria-label="Skip to next section"
          >
            <svg
              viewBox="0 0 24 24"
              fill="currentColor"
              width={16}
              height={16}
              aria-hidden="true"
              className="shrink-0"
            >
              <polygon points="4,4 16,12 4,20" />
              <rect x="17" y="4" width="3" height="16" rx="0.5" />
            </svg>
            <span className="hidden sm:inline">Skip section</span>
          </button>
        )}

        {(onDownloadAll || downloadHref) && (
          downloadHref && !downloading ? (
            <ManagedAudioDownloadButton
              href={downloadHref}
              title={articleTitle}
              label={downloadSummaryOnly ? "Download" : "Download all"}
              ariaLabel={
                downloadSummaryOnly
                  ? "Download summary as audio file"
                  : "Download full article as one audio file"
              }
            />
          ) : onDownloadAll ? (
            <AudioDownloadButton
              onClick={onDownloadAll}
              disabled={downloading || isGenerating}
              label={downloadSummaryOnly ? "Download" : "Download all"}
              ariaLabel={
                downloadStatus === "queued"
                  ? "Article download queued"
                  : downloadStage === "packaging"
                    ? "Packaging article download"
                    : downloading
                      ? `Preparing article download ${Math.min(downloadProgress?.current ?? 0, downloadProgress?.total ?? 0)} of ${downloadProgress?.total ?? 0}`
                      : downloadSummaryOnly
                        ? "Download summary as audio file"
                        : "Download full article as one audio file"
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
                  Packaging...
                </>
              ) : downloading ? (
                <>
                  <DownloadSpinnerIcon />
                  {`${Math.min(downloadProgress?.current ?? 0, downloadProgress?.total ?? 0)}/${downloadProgress?.total ?? 0} ready`}
                </>
              ) : (
                undefined
              )}
            </AudioDownloadButton>
          ) : null
        )}

        {onPlaybackRateChange && (
          <SpeedButton rate={playbackRate} onClick={cycleSpeed} />
        )}
      </div>

      <p className="mb-3 text-[0.6875rem] leading-normal text-muted">
        Audio is generated with synthetic speech.
      </p>
      {fallbackVoiceNotice ? (
        <p
          className="mb-3 rounded-xl border border-border bg-surface-2 px-3 py-2 text-[0.6875rem] leading-normal text-muted"
          role="status"
          aria-live="polite"
        >
          {fallbackVoiceNotice}
        </p>
      ) : null}
      {effectivePlayback.status === "loading" && effectivePlayback.slowLoading ? (
        <p
          className="mb-3 rounded-xl border border-border bg-surface-2 px-3 py-2 text-[0.6875rem] leading-normal text-muted"
          role="status"
          aria-live="polite"
        >
          Still generating audio. OpenAI is taking a little longer.
        </p>
      ) : null}

      <nav aria-label="Article sections">
        <ol className="list-none p-0 m-0" role="list">
          {/* Summary entry */}
          <li
            className={`toc-item${isSummaryActive ? " bg-accent-bg" : ""}`}
          >
            <div className={rowClass}>
              <span className="flex-1 min-w-0 flex items-baseline gap-2 flex-wrap">
                <span
                  className={`font-semibold leading-[1.4] ${isSummaryActive ? "text-accent" : "text-foreground"}`}
                >
                  Summary
                </span>
                {summaryText && (
                  <span className="text-xs sm:text-[0.6875rem] text-muted font-mono font-normal whitespace-nowrap">
                    <span aria-hidden="true">{durationLabel("summary", summaryText, sectionDurations, playbackRate)}</span>
                    <span className="sr-only">{durationLabelAccessible("summary", summaryText, sectionDurations, playbackRate)}</span>
                  </span>
                )}
                <SectionDetailsBadge
                  linkCount={linkCounts?.["__summary__"]}
                  citationCount={citationCounts?.["__summary__"]}
                  isOpen={openPanel === "summary"}
                  onToggle={() =>
                    setOpenPanel((v) => (v === "summary" ? null : "summary"))
                  }
                />
                <ContextSectionLink
                  blocks={getContextBlocksForSection(contextBlocks, null)}
                />
              </span>
              <button
                onMouseEnter={onWarmSummary}
                onFocus={onWarmSummary}
                onPointerDown={onWarmSummary}
                onTouchStart={onWarmSummary}
                onClick={(e) => { onListenSummary(); e.currentTarget.focus(); }}
                aria-label={`Listen to summary of ${articleTitle}`}
                className={`${pillClass} self-start sm:self-auto border cursor-pointer pointer-events-auto ${
                  isSummaryActive && !isSummaryLoading
                    ? "bg-accent-bg text-accent border-accent-border"
                    : "bg-btn-primary text-btn-primary-text border-transparent"
                }`}
              >
                {isSummaryLoading ? (
                  <SpinnerIcon />
                ) : isSummaryPlaying ? (
                  <SoundIcon />
                ) : isSummaryPaused ? (
                  <PauseIcon />
                ) : (
                  <PlayIcon />
                )}
                <span aria-live="polite">
                  {isSummaryLoading
                    ? "Loading"
                    : isSummaryPlaying
                      ? "Playing"
                      : isSummaryPaused
                        ? "Paused"
                        : "Listen"}
                </span>
              </button>
            </div>
            {isSummaryActive && audioProgress && onSeek && (
              <InlineProgressBar
                currentTime={audioProgress.currentTime}
                duration={audioProgress.duration}
                onSeek={onSeek}
              />
            )}
            {openPanel === "summary" && (
              <SectionDetailsPanel
                wikiPageId={wikiPageId}
                sectionTitle={null}
                hasLinks={(linkCounts?.["__summary__"] ?? 0) > 0}
                hasCitations={(citationCounts?.["__summary__"] ?? 0) > 0}
              />
            )}
          </li>

          {/* Section entries */}
          {sections.map((section, index) => {
            const canListen = hasFullAudio(section);
            const isSelected = canListen && activeSectionIndex === index;
            const isPlaying = isSelected && isSpeaking && !isPaused;
            const isSectionPaused = isSelected && isSpeaking && isPaused;
            const isActive = isPlaying || isSectionPaused;
            const isLoading = isGenerating && isSelected;
            const indent = (section.level - 2) * 16;
            const unavailableTooltip = getSoftAudioTooltip(section.audioReason);

            if (!canListen) {
              return (
                <li
                  key={index}
                  className="toc-item mt-0.5"
                >
                  <div
                    role="group"
                    className={`${rowClass} cursor-default text-muted`}
                    style={indent > 0 ? { paddingLeft: `${indent + 12}px` } : undefined}
                    aria-label={`${section.title} — not available for audio: ${getAudioReasonLabel(section.audioReason)}`}
                  >
                    <span className="flex-1 min-w-0 flex items-baseline gap-2 flex-wrap">
                      <span
                        className={`${section.level === 2 ? "font-semibold text-[0.9375rem]" : "font-normal text-sm"} min-w-0 [overflow-wrap:anywhere] text-muted leading-[1.4]`}
                      >
                        {section.title}
                      </span>
                      <ContextSectionLink
                        blocks={getContextBlocksForSection(
                          contextBlocks,
                          index,
                          section.title,
                        )}
                      />
                    </span>
                    <span className="inline-flex self-start sm:self-auto items-center gap-1.5 shrink-0">
                      <span
                        className={`${pillClass} bg-transparent text-muted border border-border`}
                        aria-hidden="true"
                      >
                        <span>Not suited for audio</span>
                      </span>
                      <InfoTooltip
                        label="Why this section is not suited for audio"
                        text={unavailableTooltip}
                        align="right"
                        buttonClassName="size-6"
                        tooltipClassName="w-56"
                      />
                    </span>
                  </div>
                </li>
              );
            }

            return (
              <li
                key={index}
                className={`toc-item mt-0.5${isActive ? " bg-accent-bg" : ""}`}
              >
                <div
                  className={`${rowClass} cursor-default`}
                  style={indent > 0 ? { paddingLeft: `${indent + 12}px` } : undefined}
                >
                  <span className="flex-1 min-w-0 flex items-baseline gap-2 flex-wrap">
                    <span
                      className={`${section.level === 2 ? "font-semibold text-[0.9375rem]" : "font-normal text-sm"} min-w-0 [overflow-wrap:anywhere] leading-[1.4] ${isActive ? "text-accent" : "text-foreground"}`}
                    >
                      {section.title}
                    </span>
                    <span className="text-xs sm:text-[0.6875rem] text-muted font-mono font-normal whitespace-nowrap">
                      <span aria-hidden="true">{durationLabel(`section-${index}`, section.content, sectionDurations, playbackRate)}</span>
                      <span className="sr-only">{durationLabelAccessible(`section-${index}`, section.content, sectionDurations, playbackRate)}</span>
                    </span>
                    <SectionDetailsBadge
                      linkCount={linkCounts?.[section.title]}
                      citationCount={citationCounts?.[section.title]}
                      isOpen={openPanel === `section-${index}`}
                      onToggle={() =>
                        setOpenPanel((v) =>
                          v === `section-${index}`
                            ? null
                            : `section-${index}`,
                        )
                      }
                    />
                    <ContextSectionLink
                      blocks={getContextBlocksForSection(
                        contextBlocks,
                        index,
                        section.title,
                      )}
                    />
                  </span>

                  <button
                    onMouseEnter={() => onWarmSection?.(index)}
                    onFocus={() => onWarmSection?.(index)}
                    onPointerDown={() => onWarmSection?.(index)}
                    onTouchStart={() => onWarmSection?.(index)}
                    onClick={(e) => { if (!isLoading) { onListenSection(index); e.currentTarget.focus(); } }}
                    aria-disabled={isLoading || undefined}
                    aria-label={
                      isLoading
                        ? `Generating audio for ${section.title}`
                        : `Listen to ${section.title}`
                    }
                    className={`${pillClass} self-start sm:self-auto border pointer-events-auto ${
                      isLoading ? "cursor-wait" : "cursor-pointer"
                    } ${
                      isActive && !isLoading
                        ? "bg-accent-bg text-accent border-accent-border"
                        : "bg-btn-primary text-btn-primary-text border-transparent"
                    }`}
                  >
                    {isLoading ? (
                      <SpinnerIcon />
                    ) : isPlaying ? (
                      <SoundIcon />
                    ) : isSectionPaused ? (
                      <PauseIcon />
                    ) : (
                      <PlayIcon />
                    )}
                    <span aria-live="polite">
                      {isLoading
                        ? "Loading"
                        : isPlaying
                          ? "Playing"
                          : isSectionPaused
                            ? "Paused"
                            : "Listen"}
                    </span>
                  </button>
                </div>
                {isActive && audioProgress && onSeek && (
                  <InlineProgressBar
                    currentTime={audioProgress.currentTime}
                    duration={audioProgress.duration}
                    onSeek={onSeek}
                  />
                )}
                {openPanel === `section-${index}` && (
                  <SectionDetailsPanel
                    wikiPageId={wikiPageId}
                    sectionTitle={section.title}
                    hasLinks={(linkCounts?.[section.title] ?? 0) > 0}
                    hasCitations={(citationCounts?.[section.title] ?? 0) > 0}
                  />
                )}
              </li>
            );
          })}
        </ol>
      </nav>

      {hasNonAudioSections && (
        <p className="mt-3.5 text-[0.6875rem] text-muted leading-normal text-center">
          Some sections contain tables or lists that don&rsquo;t translate well to audio.{" "}
          <a
            href={`https://en.wikipedia.org/wiki?curid=${wikiPageId}`}
            target="_blank"
            rel="noopener noreferrer"
            className="linked-article-link text-muted underline underline-offset-2"
          >
            View full article on Wikipedia
            <span className="sr-only"> (opens in new tab)</span>
          </a>
        </p>
      )}

      <div aria-live="assertive" className="sr-only">
        {isGenerating &&
          activeSectionIndex !== null &&
          `Generating audio for ${sections[activeSectionIndex].title}, please wait.`}
        {isGenerating &&
          activeSectionIndex === null &&
          `Generating summary audio, please wait.`}
      </div>
      <div aria-live="assertive" className="sr-only" role="status">
        {rateAnnouncement}
      </div>
    </div>
  );
};
