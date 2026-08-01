"use client";

import { useMemo, useState, type RefObject } from "react";
import { InfoTooltip } from "@/components/InfoTooltip";
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
import type { ContextBlock } from "@/lib/article-context-types";
import {
  ContextSectionLink,
  getContextBlocksForSection,
} from "@/components/ArticleContext";
import {
  InlineProgressBar,
  PauseIcon,
  PlayIcon,
  SoundIcon,
  SpeedButton,
  SpinnerIcon,
} from "@/components/AudioPlaybackPresentation";
import {
  SectionDetailsBadge,
  SectionDetailsPanel,
} from "@/components/TableOfContentsPresentation";
import type { AudioPlaybackState } from "@/lib/article-audio-playback";
import { useArticleSectionCounts } from "@/hooks/useArticleSectionMetadata";
import { wikipediaRevisionKey } from "@/lib/wikipedia-utils";

export type {
  AudioPlaybackMode,
  AudioPlaybackState,
  AudioPlaybackStatus,
} from "@/lib/article-audio-playback";

type TableOfContentsProps = {
  identity: WikipediaRevisionIdentity & { narrationVersion: number };
  summaryText?: string;
  sections: Section[];
  sectionDurations?: Record<string, number>;
  playback: AudioPlaybackState;
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

export const formatDuration = (
  totalSeconds: number,
  estimated: boolean,
): string => {
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

export const formatDurationAccessible = (
  totalSeconds: number,
  estimated: boolean,
): string => {
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
  if (actual != null)
    return formatDurationAccessible(Math.round(actual / rate), false);
  return estimateDurationAccessible(text, rate);
};

const rowClass =
  "toc-row flex w-full flex-wrap items-start justify-between gap-[8px] rounded-xl px-[12px] py-[10px] text-left";

const pillClass =
  "inline-flex max-w-full flex-wrap items-center justify-center gap-[5px] rounded-full px-[12px] py-[5px] text-center text-xs font-semibold leading-snug break-words [overflow-wrap:anywhere]";

const sectionMetadataCount = (
  counts: Record<string, number> | null,
  sectionIndex: string,
  legacyTitle: string,
): number | undefined => counts?.[sectionIndex] ?? counts?.[legacyTitle];

export const TableOfContents = ({
  identity,
  summaryText,
  sections,
  sectionDurations,
  playback,
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
  const { title: articleTitle, wikiPageId } = identity;
  const { linkCounts, citationCounts } = useArticleSectionCounts(identity);
  const [openPanelState, setOpenPanelState] = useState<{
    revisionKey: string;
    panel: string | null;
  }>(() => ({
    revisionKey: wikipediaRevisionKey(identity),
    panel: null,
  }));
  const revisionKey = wikipediaRevisionKey(identity);
  const openPanel =
    openPanelState.revisionKey === revisionKey ? openPanelState.panel : null;
  const togglePanel = (panel: string) => {
    setOpenPanelState({
      revisionKey,
      panel: openPanel === panel ? null : panel,
    });
  };

  const [rateAnnouncement, setRateAnnouncement] = useState("");
  const cycleSpeed = () => {
    if (!onPlaybackRateChange) return;
    const idx = PLAYBACK_RATES.indexOf(playbackRate as PlaybackRate);
    const next = PLAYBACK_RATES[(idx + 1) % PLAYBACK_RATES.length];
    onPlaybackRateChange(next);
    setRateAnnouncement(`Playback speed ${formatRate(next)}`);
  };

  const activeSectionIndex = playback.sectionIdx;
  const isGenerating = playback.status === "loading";
  const isPaused = playback.status === "paused";
  const isSpeaking =
    playback.status === "playing" || playback.status === "paused";
  const isPlayingAll =
    playback.mode === "play_all" &&
    playback.status !== "idle" &&
    playback.status !== "error";

  const isSummarySelected = playback.sectionKey === "summary";
  const isSummaryPlaying = isSummarySelected && isSpeaking && !isPaused;
  const isSummaryPaused = isSummarySelected && isSpeaking && isPaused;
  const isSummaryActive = isSummaryPlaying || isSummaryPaused;
  const isSummaryLoading = isGenerating && isSummarySelected;
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
  const hasAdaptedSections = sections.some(
    (section) => section.narration.adapted,
  );
  const hasEmptySections = sections.some(
    (section) => section.narration.mode === "none",
  );
  const playableCount = narrationTracks.length;
  const summaryOnly = sectionTracks.length === 0;
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

    for (const track of sectionTracks) {
      const actual = sectionDurations?.[track.sectionKey];
      if (actual != null) {
        total += actual;
      } else {
        total += Math.round(
          track.text.split(/\s+/).filter(Boolean).length / TTS_WORDS_PER_SECOND,
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
    <div className="toc-section pattern-leaves min-w-0 [overflow-wrap:anywhere]">
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
          <h2 className="type-section-title font-display font-bold text-xl text-foreground mb-1">
            Explore this article
          </h2>
          <p className="text-[0.8125rem] text-muted m-0 leading-normal">
            {allActual ? "Playtime" : "Estimated playtime"}
            {playbackRate !== 1 ? ` at ${playbackRate}x` : ""}:{" "}
            <span className="font-mono font-medium text-foreground-2">
              <span aria-hidden="true">{totalPlaytime}</span>
              <span className="sr-only">{totalPlaytimeAccessible}</span>
            </span>
          </p>
        </div>
      </div>

      <div className="mb-4 flex min-w-0 flex-wrap gap-[8px]">
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
          className={`inline-flex min-h-[44px] max-w-full flex-wrap items-center justify-center gap-[8px] rounded-xl px-[20px] py-[10px] text-center text-sm font-semibold leading-snug transition-all duration-200 ${
            isPlayingAll
              ? "bg-surface-3 text-foreground border border-border cursor-pointer"
              : `search-submit bg-btn-primary text-btn-primary-text border-0 ${
                  isGenerating || downloading
                    ? "cursor-not-allowed opacity-60"
                    : "cursor-pointer"
                }`
          }`}
          aria-label={
            isPlayingAll
              ? isPlayAllLoading
                ? summaryOnly
                  ? "Stop summary"
                  : "Stop playing all sections"
                : isPaused
                  ? summaryOnly
                    ? "Resume playing summary"
                    : "Resume playing all sections"
                  : !isSpeaking
                    ? "Generating audio, please wait"
                    : summaryOnly
                      ? "Pause summary"
                      : "Pause playing all sections"
              : isGenerating
                ? "Generating audio, please wait"
                : summaryOnly
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
              {summaryOnly ? "Play" : "Play all"}
              {!summaryOnly && (
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
            className="inline-flex min-h-[44px] max-w-full flex-wrap items-center justify-center gap-[8px] rounded-xl border border-border bg-surface-2 px-[12px] py-[10px] text-center text-sm font-semibold leading-snug text-foreground-2 transition-colors duration-200 cursor-pointer sm:px-[20px]"
            aria-label={
              summaryOnly ? "Stop summary" : "Stop playing all sections"
            }
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

        {isPlayingAll && !summaryOnly && onSkipSection && (
          <button
            onClick={onSkipSection}
            disabled={!canSkipSection}
            className={`inline-flex min-h-[44px] max-w-full flex-wrap items-center justify-center gap-[8px] rounded-xl border border-border bg-surface-2 px-[12px] py-[10px] text-center text-sm font-semibold leading-snug text-foreground-2 transition-colors duration-200 sm:px-[20px] ${
              !canSkipSection
                ? "cursor-not-allowed opacity-70"
                : "cursor-pointer"
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

        {(onDownloadAll || downloadHref) &&
          (downloadHref && !downloading ? (
            <ManagedAudioDownloadButton
              href={downloadHref}
              title={articleTitle}
              label={summaryOnly ? "Download" : "Download all"}
              ariaLabel={
                summaryOnly
                  ? "Download summary as audio file"
                  : "Download full article as one audio file"
              }
            />
          ) : onDownloadAll ? (
            <AudioDownloadButton
              onClick={onDownloadAll}
              disabled={downloading || isGenerating}
              label={summaryOnly ? "Download" : "Download all"}
              ariaLabel={
                downloadStatus === "queued"
                  ? "Article download queued"
                  : downloadStage === "packaging"
                    ? "Packaging article download"
                    : downloading
                      ? `Preparing article download ${Math.min(downloadProgress?.current ?? 0, downloadProgress?.total ?? 0)} of ${downloadProgress?.total ?? 0}`
                      : summaryOnly
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
              ) : undefined}
            </AudioDownloadButton>
          ) : null)}

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
      {playback.status === "loading" && playback.slowLoading ? (
        <p
          className="mb-3 rounded-xl border border-border bg-surface-2 px-3 py-2 text-[0.6875rem] leading-normal text-muted"
          role="status"
          aria-live="polite"
        >
          Still generating audio. This is taking a little longer than usual.
        </p>
      ) : null}

      <nav aria-label="Article sections">
        <ol className="list-none p-0 m-0" role="list">
          {/* Summary entry */}
          <li className={`toc-item${isSummaryActive ? " bg-accent-bg" : ""}`}>
            <div className={rowClass}>
              <span className="flex min-w-0 flex-[1_1_240px] flex-wrap items-baseline gap-[8px]">
                <span
                  className={`font-semibold leading-[1.4] ${isSummaryActive ? "text-accent" : "text-foreground"}`}
                >
                  Summary
                </span>
                {summaryText && (
                  <span className="shrink-0 font-mono text-xs font-normal text-muted sm:text-[0.6875rem]">
                    <span aria-hidden="true">
                      {durationLabel(
                        "summary",
                        summaryText,
                        sectionDurations,
                        playbackRate,
                      )}
                    </span>
                    <span className="sr-only">
                      {durationLabelAccessible(
                        "summary",
                        summaryText,
                        sectionDurations,
                        playbackRate,
                      )}
                    </span>
                  </span>
                )}
                <SectionDetailsBadge
                  linkCount={sectionMetadataCount(
                    linkCounts,
                    "__summary__",
                    "__summary__",
                  )}
                  citationCount={sectionMetadataCount(
                    citationCounts,
                    "__summary__",
                    "__summary__",
                  )}
                  isOpen={openPanel === "summary"}
                  onToggle={() => togglePanel("summary")}
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
                onClick={(e) => {
                  onListenSummary();
                  e.currentTarget.focus();
                }}
                aria-label={`Listen to summary of ${articleTitle}`}
                className={`${pillClass} pointer-events-auto min-h-[44px] shrink-0 self-start border cursor-pointer ${
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
                identity={identity}
                sectionTitle={null}
                hasLinks={
                  (sectionMetadataCount(
                    linkCounts,
                    "__summary__",
                    "__summary__",
                  ) ?? 0) > 0
                }
                hasCitations={
                  (sectionMetadataCount(
                    citationCounts,
                    "__summary__",
                    "__summary__",
                  ) ?? 0) > 0
                }
              />
            )}
          </li>

          {/* Section entries */}
          {sections.map((section, index) => {
            const canListen =
              section.narration.mode === "verbatim" ||
              section.narration.mode === "structured";
            const isTransition = section.narration.mode === "transition";
            const isSelected = canListen && activeSectionIndex === index;
            const isPlaying = isSelected && isSpeaking && !isPaused;
            const isSectionPaused = isSelected && isSpeaking && isPaused;
            const isActive = isPlaying || isSectionPaused;
            const isLoading = isGenerating && isSelected;
            const indent = Math.min(24, Math.max(0, (section.level - 2) * 12));

            if (!canListen) {
              const statusLabel = isTransition
                ? "Chapter transition"
                : "No source text";
              const statusDescription = isTransition
                ? "This heading has no text of its own. Its title is spoken as a brief transition during Play All, downloads, and podcasts."
                : "Wikipedia does not provide any text for this heading, so there is nothing to narrate.";
              return (
                <li key={index} className="toc-item mt-0.5">
                  <div
                    role="group"
                    className={`${rowClass} cursor-default text-muted`}
                    style={
                      indent > 0
                        ? { paddingLeft: `${indent + 12}px` }
                        : undefined
                    }
                    aria-label={`${section.title} — ${statusLabel.toLowerCase()}`}
                  >
                    <span className="flex min-w-0 flex-[1_1_240px] flex-wrap items-baseline gap-[8px]">
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
                          section.wikiSectionIndex,
                        )}
                      />
                    </span>
                    <span className="inline-flex max-w-full shrink-0 flex-wrap items-center gap-[6px] self-start">
                      <span
                        className={`${pillClass} bg-transparent text-muted border border-border`}
                        aria-hidden="true"
                      >
                        <span>{statusLabel}</span>
                      </span>
                      <InfoTooltip
                        label={`About ${statusLabel.toLowerCase()}`}
                        text={statusDescription}
                        align="right"
                        buttonClassName="size-6"
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
                  style={
                    indent > 0 ? { paddingLeft: `${indent + 12}px` } : undefined
                  }
                >
                  <span className="flex min-w-0 flex-[1_1_240px] flex-wrap items-baseline gap-[8px]">
                    <span
                      className={`${section.level === 2 ? "font-semibold text-[0.9375rem]" : "font-normal text-sm"} min-w-0 [overflow-wrap:anywhere] leading-[1.4] ${isActive ? "text-accent" : "text-foreground"}`}
                    >
                      {section.title}
                    </span>
                    <span className="shrink-0 font-mono text-xs font-normal text-muted sm:text-[0.6875rem]">
                      <span aria-hidden="true">
                        {durationLabel(
                          `section-${index}`,
                          section.narration.text,
                          sectionDurations,
                          playbackRate,
                        )}
                      </span>
                      <span className="sr-only">
                        {durationLabelAccessible(
                          `section-${index}`,
                          section.narration.text,
                          sectionDurations,
                          playbackRate,
                        )}
                      </span>
                    </span>
                    {section.narration.adapted && (
                      <span className="inline-flex max-w-full flex-wrap items-center gap-[6px]">
                        <span
                          className={`${pillClass} bg-accent-bg text-accent border border-accent-border`}
                        >
                          Adapted for audio
                        </span>
                        <InfoTooltip
                          label={`How ${section.title} was adapted for audio`}
                          text={
                            section.narration.remainingSourceItems
                              ? `Wikipedia presents part of this section as structured data. Curio Garden reads it in source order and announces that ${section.narration.remainingSourceItems} source rows or items remain in the full Wikipedia article.`
                              : "Wikipedia presents part of this section as a table or list. Curio Garden reads its labels and values in source order without generative rewriting."
                          }
                          buttonClassName="size-6"
                        />
                        {section.narration.remainingSourceItems ? (
                          <a
                            href={`https://en.wikipedia.org/w/index.php?oldid=${encodeURIComponent(identity.revisionId)}`}
                            target="_blank"
                            rel="noopener noreferrer"
                            className="linked-article-link text-xs text-accent underline underline-offset-2"
                            aria-label={`View the complete source data for ${section.title} on Wikipedia; ${section.narration.remainingSourceItems} ${section.narration.remainingSourceItems === 1 ? "item remains" : "items remain"}; opens in a new tab`}
                          >
                            View complete source data
                          </a>
                        ) : null}
                      </span>
                    )}
                    <SectionDetailsBadge
                      linkCount={sectionMetadataCount(
                        linkCounts,
                        section.wikiSectionIndex,
                        section.title,
                      )}
                      citationCount={sectionMetadataCount(
                        citationCounts,
                        section.wikiSectionIndex,
                        section.title,
                      )}
                      isOpen={openPanel === `section-${index}`}
                      onToggle={() => togglePanel(`section-${index}`)}
                    />
                    <ContextSectionLink
                      blocks={getContextBlocksForSection(
                        contextBlocks,
                        index,
                        section.title,
                        section.wikiSectionIndex,
                      )}
                    />
                  </span>

                  <button
                    onMouseEnter={() => onWarmSection?.(index)}
                    onFocus={() => onWarmSection?.(index)}
                    onPointerDown={() => onWarmSection?.(index)}
                    onTouchStart={() => onWarmSection?.(index)}
                    onClick={(e) => {
                      if (!isLoading) {
                        onListenSection(index);
                        e.currentTarget.focus();
                      }
                    }}
                    aria-disabled={isLoading || undefined}
                    aria-label={
                      isLoading
                        ? `Generating audio for ${section.title}`
                        : `Listen to ${section.title}`
                    }
                    className={`${pillClass} pointer-events-auto min-h-[44px] shrink-0 self-start border ${
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
                    identity={identity}
                    sectionTitle={section.title}
                    sectionIndex={section.wikiSectionIndex}
                    hasLinks={
                      (sectionMetadataCount(
                        linkCounts,
                        section.wikiSectionIndex,
                        section.title,
                      ) ?? 0) > 0
                    }
                    hasCitations={
                      (sectionMetadataCount(
                        citationCounts,
                        section.wikiSectionIndex,
                        section.title,
                      ) ?? 0) > 0
                    }
                  />
                )}
              </li>
            );
          })}
        </ol>
      </nav>

      {(hasAdaptedSections || hasEmptySections) && (
        <p className="mt-3.5 text-[0.6875rem] text-muted leading-normal text-center">
          {hasAdaptedSections &&
            "Tables and lists are adapted from Wikipedia’s source structure for audio. "}
          {hasEmptySections && "Headings without source text remain visible. "}
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
