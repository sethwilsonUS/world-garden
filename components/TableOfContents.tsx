"use client";

import { useState, useEffect, useRef, type RefObject } from "react";
import { useData } from "@/lib/data-context";
import Link from "next/link";
import {
  PLAYBACK_RATES,
  type PlaybackRate,
  formatRate,
} from "@/hooks/usePlaybackRate";
import { formatTime } from "@/lib/formatTime";

type Section = {
  title: string;
  level: number;
  content: string;
};

type LinkedArticle = {
  wikiPageId: string;
  title: string;
  description?: string;
};

type TableOfContentsProps = {
  articleTitle: string;
  wikiPageId: string;
  summaryText?: string;
  sections: Section[];
  sectionDurations?: Record<string, number>;
  activeSectionIndex: number | null;
  isGenerating?: boolean;
  isPlayingAll: boolean;
  isPaused?: boolean;
  isSpeaking?: boolean;
  downloading?: boolean;
  downloadProgress?: { current: number; total: number };
  onListenSection: (index: number) => void;
  onListenSummary: () => void;
  onPlayAll: () => void;
  onStopPlayAll: () => void;
  onTogglePlayAll?: () => void;
  onDownloadAll?: () => void;
  playbackRate?: number;
  onPlaybackRateChange?: (rate: PlaybackRate) => void;
  isElevenLabs?: boolean;
  audioProgress?: { currentTime: number; duration: number };
  onSeek?: (time: number) => void;
  playAllRef?: RefObject<HTMLButtonElement | null>;
};

export const TTS_WORDS_PER_SECOND = 2.5;
const MIN_AUDIO_CONTENT_LENGTH = 20;

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

const PlayIcon = () => {
  return (
    <svg
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={2.5}
      strokeLinecap="round"
      strokeLinejoin="round"
      width={14}
      height={14}
      aria-hidden="true"
      className="shrink-0"
    >
      <polygon points="5 3 19 12 5 21 5 3" />
    </svg>
  );
};

const PauseIcon = () => {
  return (
    <svg
      viewBox="0 0 24 24"
      fill="currentColor"
      width={14}
      height={14}
      aria-hidden="true"
      className="shrink-0"
    >
      <rect x="6" y="4" width="4" height="16" rx="1" />
      <rect x="14" y="4" width="4" height="16" rx="1" />
    </svg>
  );
};

const SpinnerIcon = () => {
  return (
    <svg
      className="animate-spin shrink-0"
      fill="none"
      viewBox="0 0 24 24"
      width={14}
      height={14}
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
  );
};

const SoundIcon = () => {
  return (
    <svg
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={2.5}
      strokeLinecap="round"
      strokeLinejoin="round"
      width={14}
      height={14}
      aria-hidden="true"
      className="shrink-0"
    >
      <polygon points="11 5 6 9 2 9 2 15 6 15 11 19 11 5" />
      <path d="M15.54 8.46a5 5 0 0 1 0 7.07" />
    </svg>
  );
};

const rowClass = "flex items-center justify-between gap-4 w-full py-2.5 px-3 rounded-xl text-left";

const pillClass = "inline-flex items-center gap-[5px] px-3 py-[5px] rounded-full font-semibold text-xs leading-none whitespace-nowrap shrink-0";

export const TableOfContents = ({
  articleTitle,
  wikiPageId,
  summaryText,
  sections,
  sectionDurations,
  activeSectionIndex,
  isGenerating = false,
  isPlayingAll,
  isPaused = false,
  isSpeaking = false,
  downloading = false,
  downloadProgress,
  onListenSection,
  onListenSummary,
  onPlayAll,
  onStopPlayAll,
  onTogglePlayAll,
  onDownloadAll,
  playbackRate = 1,
  onPlaybackRateChange,
  isElevenLabs = false,
  audioProgress,
  onSeek,
  playAllRef,
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

  const isAnySectionActive = isSpeaking || isGenerating;
  const isSummarySelected = activeSectionIndex === null;
  const isSummaryPlaying = isSummarySelected && isSpeaking && !isPaused;
  const isSummaryPaused = isSummarySelected && isSpeaking && isPaused;
  const isSummaryActive = isSummaryPlaying || isSummaryPaused;
  const isSummaryLoading = isGenerating && isSummarySelected;
  const audioSections = sections.filter(
    (s) => s.content.length >= MIN_AUDIO_CONTENT_LENGTH,
  );
  const hasNonAudioSections = audioSections.length < sections.length;
  const playableCount = audioSections.length + 1;
  const summaryOnly = sections.length === 0;

  const { totalPlaytime, totalPlaytimeAccessible } = (() => {
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
      if (sections[i].content.length < MIN_AUDIO_CONTENT_LENGTH) continue;
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
            Estimated playtime{playbackRate !== 1 ? ` at ${playbackRate}x` : ""}:{" "}
            <span className="font-mono font-medium text-foreground-2">
              <span aria-hidden="true">{totalPlaytime}</span>
              <span className="sr-only">{totalPlaytimeAccessible}</span>
            </span>
          </p>
        </div>
      </div>

      {summaryOnly && onPlaybackRateChange && (
        <div className="flex flex-wrap gap-2 mb-4">
          <SpeedButton rate={playbackRate} onClick={cycleSpeed} />
        </div>
      )}

      {!summaryOnly && <div className="flex flex-wrap gap-2 mb-4">
        <button
          ref={playAllRef}
          onClick={
            isPlayingAll
              ? (onTogglePlayAll ?? onStopPlayAll)
              : onPlayAll
          }
          disabled={!isPlayingAll && (isGenerating || downloading)}
          className={`inline-flex items-center gap-2 py-2.5 px-5 rounded-xl font-semibold text-sm transition-all duration-200 ${
            isPlayingAll
              ? "bg-surface-3 text-foreground border border-border cursor-pointer"
              : `search-submit bg-btn-primary text-btn-primary-text border-0 ${
                  isGenerating || downloading ? "cursor-not-allowed opacity-60" : "cursor-pointer"
                }`
          }`}
          aria-label={
            isPlayingAll
              ? (isPaused
                  ? "Resume playing all sections"
                  : "Pause playing all sections")
              : `Play all ${playableCount} sections including summary`
          }
        >
          {isPlayingAll ? (
            isPaused ? (
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
                Resume
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
                Pause
              </>
            )
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
              Play all
              <span className="text-[0.6875rem] opacity-80 font-medium">
                ({playableCount})
              </span>
            </>
          )}
        </button>

        {onDownloadAll && (
          <button
            onClick={onDownloadAll}
            disabled={downloading || isGenerating}
            className={`inline-flex items-center gap-2 py-2.5 px-5 bg-surface-2 text-foreground-2 border border-border rounded-xl font-semibold text-sm transition-colors duration-200 ${
              downloading || isGenerating ? "cursor-not-allowed opacity-70" : "cursor-pointer"
            }`}
            aria-label={
              downloading
                ? `Downloading: generating section ${downloadProgress?.current ?? 0} of ${downloadProgress?.total ?? 0}`
                : "Download full article as one audio file"
            }
          >
            {downloading ? (
              <>
                <svg
                  className="animate-spin shrink-0"
                  fill="none"
                  viewBox="0 0 24 24"
                  width={16}
                  height={16}
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
                {(downloadProgress?.current ?? 0) < (downloadProgress?.total ?? 0)
                  ? `Generating ${(downloadProgress?.current ?? 0) + 1}/${downloadProgress?.total ?? 0}...`
                  : "Stitching..."}
              </>
            ) : (
              <>
                <svg
                  viewBox="0 0 24 24"
                  fill="none"
                  stroke="currentColor"
                  strokeWidth={2}
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  width={16}
                  height={16}
                  aria-hidden="true"
                  className="shrink-0"
                >
                  <path d="M21 15v4a2 2 0 01-2 2H5a2 2 0 01-2-2v-4" />
                  <polyline points="7 10 12 15 17 10" />
                  <line x1="12" y1="15" x2="12" y2="3" />
                </svg>
                Download all
              </>
            )}
          </button>
        )}

        {onPlaybackRateChange && (
          <SpeedButton rate={playbackRate} onClick={cycleSpeed} />
        )}
      </div>}

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
                  <span className="text-[0.6875rem] text-muted font-mono font-normal whitespace-nowrap">
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
              </span>
              <button
                onClick={onListenSummary}
                aria-label={`Listen to summary of ${articleTitle}`}
                className={`${pillClass} border cursor-pointer pointer-events-auto ${
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
                <span>
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
            {isSummaryActive && isElevenLabs && audioProgress && onSeek && (
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
            const hasAudio =
              section.content.length >= MIN_AUDIO_CONTENT_LENGTH;
            const isSelected = hasAudio && activeSectionIndex === index;
            const isPlaying = isSelected && isSpeaking && !isPaused;
            const isSectionPaused = isSelected && isSpeaking && isPaused;
            const isActive = isPlaying || isSectionPaused;
            const isLoading = isGenerating && isSelected;
            const indent = (section.level - 2) * 16;

            if (!hasAudio) {
              return (
                <li
                  key={index}
                  className="toc-item mt-0.5 opacity-45"
                >
                  <div
                    role="group"
                    className={`${rowClass} cursor-default`}
                    style={indent > 0 ? { paddingLeft: `${indent + 12}px` } : undefined}
                    aria-label={`${section.title} — not available for audio`}
                  >
                    <span className="flex-1 min-w-0 flex items-baseline gap-2 flex-wrap">
                      <span
                        className={`${section.level === 2 ? "font-semibold text-[0.9375rem]" : "font-normal text-sm"} text-muted leading-[1.4]`}
                      >
                        {section.title}
                      </span>
                    </span>
                    <span
                      className={`${pillClass} bg-transparent text-muted border border-border`}
                      aria-hidden="true"
                    >
                      <span>Not suited for audio</span>
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
                      className={`${section.level === 2 ? "font-semibold text-[0.9375rem]" : "font-normal text-sm"} leading-[1.4] ${isActive ? "text-accent" : "text-foreground"}`}
                    >
                      {section.title}
                    </span>
                    <span className="text-[0.6875rem] text-muted font-mono font-normal whitespace-nowrap">
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
                  </span>

                  <button
                    onClick={() => onListenSection(index)}
                    disabled={isLoading}
                    aria-label={
                      isLoading
                        ? `Generating audio for ${section.title}`
                        : `Listen to ${section.title}`
                    }
                    className={`${pillClass} border pointer-events-auto ${
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
                    <span>
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
                {isActive && isElevenLabs && audioProgress && onSeek && (
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

const SectionDetailsBadge = ({
  linkCount,
  citationCount,
  isOpen,
  onToggle,
}: {
  linkCount?: number;
  citationCount?: number;
  isOpen: boolean;
  onToggle: () => void;
}) => {
  const links = linkCount ?? 0;
  const citations = citationCount ?? 0;
  if (links === 0 && citations === 0) return null;

  const parts: string[] = [];
  if (links > 0) parts.push(`${links} link${links === 1 ? "" : "s"}`);
  if (citations > 0) parts.push(`${citations} citation${citations === 1 ? "" : "s"}`);
  const label = parts.join(" · ");

  return (
    <button
      onClick={(e) => {
        e.stopPropagation();
        onToggle();
      }}
      aria-expanded={isOpen}
      aria-label={label}
      className="linked-article-link inline-flex items-center gap-[3px] px-[7px] py-px bg-transparent border border-border rounded-full text-[0.625rem] text-muted cursor-pointer font-medium leading-[1.4] pointer-events-auto transition-colors duration-150"
    >
      <svg
        viewBox="0 0 24 24"
        fill="none"
        stroke="currentColor"
        strokeWidth={2.5}
        strokeLinecap="round"
        strokeLinejoin="round"
        width={8}
        height={8}
        aria-hidden="true"
        className="shrink-0 transition-transform duration-200"
        style={{ transform: isOpen ? "rotate(90deg)" : "none" }}
      >
        <path d="M9 18l6-6-6-6" />
      </svg>
      {label}
    </button>
  );
};

type Citation = {
  id: string;
  index: number;
  text: string;
  url?: string;
};

const SectionDetailsPanel = ({
  wikiPageId,
  sectionTitle,
  hasLinks,
  hasCitations,
}: {
  wikiPageId: string;
  sectionTitle: string | null;
  hasLinks: boolean;
  hasCitations: boolean;
}) => {
  const [links, setLinks] = useState<LinkedArticle[] | null>(null);
  const [citations, setCitations] = useState<Citation[] | null>(null);
  const [linksLoading, setLinksLoading] = useState(hasLinks);
  const [citesLoading, setCitesLoading] = useState(hasCitations);
  const { getSectionLinks, getSectionCitations } = useData();

  useEffect(() => {
    if (!hasLinks || links !== null) return;
    getSectionLinks({ wikiPageId, sectionTitle })
      .then(setLinks)
      .catch(() => setLinks([]))
      .finally(() => setLinksLoading(false));
  }, [hasLinks, links, wikiPageId, sectionTitle, getSectionLinks]);

  useEffect(() => {
    if (!hasCitations || citations !== null) return;
    getSectionCitations({ wikiPageId, sectionTitle })
      .then(setCitations)
      .catch(() => setCitations([]))
      .finally(() => setCitesLoading(false));
  }, [hasCitations, citations, wikiPageId, sectionTitle, getSectionCitations]);

  const loading = linksLoading || citesLoading;
  const showBoth = hasLinks && hasCitations;
  const sectionLabel = sectionTitle ?? "summary";

  return (
    <div className="px-3 pt-1 pb-2">
      {loading && (
        <p className="text-[0.6875rem] text-muted m-0">
          Loading...
        </p>
      )}

      {!linksLoading && links !== null && links.length > 0 && (
        <nav aria-label={`Links in ${sectionLabel}`}>
          {showBoth && (
            <p className="text-[0.5625rem] font-semibold text-muted uppercase tracking-[0.05em] ml-1.5 mb-0.5">
              Links
            </p>
          )}
          <ul className="list-none m-0 p-0" style={{ columnWidth: "180px", columnGap: "8px" }}>
            {links.map((article) => (
              <li key={article.wikiPageId} className="break-inside-avoid">
                <Link
                  href={`/article/${encodeURIComponent(article.title.replace(/ /g, "_"))}`}
                  title={article.description ?? article.title}
                  className="linked-article-link block px-1.5 py-0.5 rounded text-xs text-foreground-2 no-underline transition-colors duration-100"
                >
                  {article.title}
                </Link>
              </li>
            ))}
          </ul>
        </nav>
      )}

      {!citesLoading && citations !== null && citations.length > 0 && (
        <nav
          aria-label={`Citations in ${sectionLabel}`}
          className={showBoth && links && links.length > 0 ? "mt-2" : ""}
        >
          {showBoth && (
            <p className="text-[0.5625rem] font-semibold text-muted uppercase tracking-[0.05em] ml-1.5 mb-0.5">
              Citations
            </p>
          )}
          <ol className="list-none m-0 p-0">
            {citations.map((citation) => (
              <li
                key={citation.id}
                className="flex gap-2 px-1.5 py-[3px] rounded items-start"
              >
                <span
                  aria-hidden="true"
                  className="shrink-0 w-6 font-mono text-[0.625rem] font-semibold text-muted text-right leading-[1.65]"
                >
                  {citation.index}
                </span>
                <span className="flex-1 min-w-0 text-[0.6875rem] leading-[1.65] text-foreground-2 break-words">
                  {citation.text}
                  {citation.url && (
                    <>
                      {" "}
                      <a
                        href={citation.url}
                        target="_blank"
                        rel="noopener noreferrer"
                        aria-label={`Source for citation ${citation.index} (opens in new tab)`}
                        className="linked-article-link inline-flex items-center gap-0.5 text-[0.625rem] text-muted no-underline px-[3px] rounded align-baseline transition-colors duration-150"
                      >
                        <svg
                          viewBox="0 0 24 24"
                          fill="none"
                          stroke="currentColor"
                          strokeWidth={2.5}
                          strokeLinecap="round"
                          strokeLinejoin="round"
                          width={8}
                          height={8}
                          aria-hidden="true"
                          className="shrink-0"
                        >
                          <path d="M18 13v6a2 2 0 01-2 2H5a2 2 0 01-2-2V8a2 2 0 012-2h6" />
                          <polyline points="15 3 21 3 21 9" />
                          <line x1="10" y1="14" x2="21" y2="3" />
                        </svg>
                        link
                      </a>
                    </>
                  )}
                </span>
              </li>
            ))}
          </ol>
        </nav>
      )}

      {!loading &&
        (links === null || links.length === 0) &&
        (citations === null || citations.length === 0) && (
          <p className="text-[0.6875rem] text-muted m-0">
            No details available for this section.
          </p>
        )}
    </div>
  );
};

const SpeedButton = ({ rate, onClick }: { rate: number; onClick: () => void }) => (
  <button
    onClick={onClick}
    aria-label={`Playback speed ${formatRate(rate)}. Click to change.`}
    className={`inline-flex items-center justify-center py-[5px] px-2 bg-transparent border border-border rounded-lg cursor-pointer font-mono text-xs font-bold leading-none min-w-[40px] shrink-0 transition-colors duration-150 pointer-events-auto ${
      rate !== 1 ? "text-accent" : "text-muted"
    }`}
  >
    {formatRate(rate)}
  </button>
);

const InlineProgressBar = ({
  currentTime,
  duration,
  onSeek,
}: {
  currentTime: number;
  duration: number;
  onSeek: (time: number) => void;
}) => {
  const progress = duration > 0 ? (currentTime / duration) * 100 : 0;

  return (
    <div className="flex items-center gap-2.5 px-3 pb-2 pt-0.5">
      <span
        className="font-mono text-[0.625rem] font-medium text-muted min-w-[32px] select-none"
        aria-hidden="true"
      >
        {formatTime(currentTime)}
      </span>
      <div className="flex-1 min-w-0">
        <input
          type="range"
          min={0}
          max={duration || 0}
          step={0.1}
          value={currentTime}
          onChange={(e) => onSeek(parseFloat(e.target.value))}
          aria-label={`Playback position. ${formatTime(currentTime)} of ${formatTime(duration)}`}
          aria-valuemin={0}
          aria-valuemax={duration}
          aria-valuenow={currentTime}
          aria-valuetext={`${formatTime(currentTime)} of ${formatTime(duration)}`}
          className="toc-progress-range block w-full"
          style={{ "--progress": `${progress}%` } as React.CSSProperties}
        />
      </div>
      <span
        className="font-mono text-[0.625rem] font-medium text-muted min-w-[32px] text-right select-none"
        aria-hidden="true"
      >
        {duration > 0 ? formatTime(duration) : "--:--"}
      </span>
    </div>
  );
};
