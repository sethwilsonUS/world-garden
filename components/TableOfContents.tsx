"use client";

import { useState, type ReactNode } from "react";
import { InfoTooltip } from "@/components/InfoTooltip";
import type { Section, WikipediaRevisionIdentity } from "@/lib/data-context";
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
  onListenSection: (index: number) => void;
  onListenSummary: () => void;
  onWarmSummary?: () => void;
  onWarmSection?: (index: number) => void;
  playbackRate?: number;
  audioProgress?: { currentTime: number; duration: number };
  onSeek?: (time: number) => void;
  contextBlocks?: ContextBlock[];
};

/** Jump to the Listen button, or to the title of a heading-only track. */
export const tocFocusTargetId = (sectionKey: string): string =>
  `toc-listen-${sectionKey}`;

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
  "toc-row flex w-full flex-wrap items-start gap-x-2 gap-y-0.5 rounded-xl px-3 py-1.5 text-left sm:grid sm:grid-cols-[minmax(0,1fr)_auto] sm:py-2.5";

// Reserve enough text-scaled space for a readable title before wrapping Listen.
const playableTitleClass =
  "flex min-w-0 flex-[1_1_6rem] flex-wrap items-baseline gap-x-2 self-center sm:self-start";

const pillClass =
  "inline-flex max-w-full flex-wrap items-center justify-center gap-[6px] rounded-full px-[14px] py-[5px] text-center text-sm font-semibold leading-snug break-words [overflow-wrap:anywhere]";

const listenButtonClass = (active: boolean, busy: boolean) =>
  `${pillClass} pointer-events-auto min-h-[44px] shrink-0 self-start border sm:col-start-2 sm:row-span-2 sm:row-start-1 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent focus-visible:ring-offset-2 focus-visible:ring-offset-background ${
    busy ? "cursor-wait" : "cursor-pointer"
  } ${
    active && !busy
      ? "bg-accent-bg text-accent border-accent-border"
      : "bg-btn-primary text-btn-primary-text border-transparent"
  }`;

const sectionMetadataCount = (
  counts: Record<string, number> | null,
  sectionIndex: string,
  legacyTitle: string,
): number | undefined => counts?.[sectionIndex] ?? counts?.[legacyTitle];

const ListenStateIcon = ({
  loading,
  playing,
  paused,
}: {
  loading: boolean;
  playing: boolean;
  paused: boolean;
}) =>
  loading ? (
    <SpinnerIcon />
  ) : playing ? (
    <SoundIcon />
  ) : paused ? (
    <PauseIcon />
  ) : (
    <PlayIcon />
  );

const listenStateText = (
  loading: boolean,
  playing: boolean,
  paused: boolean,
): string =>
  loading ? "Loading" : playing ? "Playing" : paused ? "Paused" : "Listen";

const DurationText = ({
  visible,
  accessible,
}: {
  visible: string;
  accessible: string;
}) => (
  <span className="shrink-0 font-mono text-xs font-normal text-muted">
    <span aria-hidden="true">{visible}</span>
    <span className="sr-only">{accessible}</span>
  </span>
);

/** Secondary line under a row's title: details that are not the main action. */
const RowExtras = ({ children }: { children: ReactNode }) => (
  <div className="flex min-w-0 basis-full flex-wrap items-center gap-x-[10px] gap-y-[4px] sm:col-start-1">
    {children}
  </div>
);

export const TableOfContents = ({
  identity,
  summaryText,
  sections,
  sectionDurations,
  playback,
  onListenSection,
  onListenSummary,
  onWarmSummary,
  onWarmSection,
  playbackRate = 1,
  audioProgress,
  onSeek,
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

  const activeSectionIndex = playback.sectionIdx;
  const isGenerating = playback.status === "loading";
  const isPaused = playback.status === "paused";
  const isSpeaking =
    playback.status === "playing" || playback.status === "paused";

  const isSummarySelected = playback.sectionKey === "summary";
  const isSummaryPlaying = isSummarySelected && isSpeaking && !isPaused;
  const isSummaryPaused = isSummarySelected && isSpeaking && isPaused;
  const isSummaryActive = isSummaryPlaying || isSummaryPaused;
  const isSummaryLoading = isGenerating && isSummarySelected;
  const hasAdaptedSections = sections.some(
    (section) => section.narration.adapted,
  );
  const hasEmptySections = sections.some(
    (section) => section.narration.mode === "none",
  );

  const summaryLinkCount = sectionMetadataCount(
    linkCounts,
    "__summary__",
    "__summary__",
  );
  const summaryCitationCount = sectionMetadataCount(
    citationCounts,
    "__summary__",
    "__summary__",
  );
  const summaryContextBlocks = getContextBlocksForSection(contextBlocks, null);
  const summaryHasExtras =
    (summaryLinkCount ?? 0) > 0 ||
    (summaryCitationCount ?? 0) > 0 ||
    summaryContextBlocks.length > 0;

  return (
    <div className="toc-section pattern-leaves min-w-0 [overflow-wrap:anywhere]">
      <div className="mb-4 flex items-start gap-3">
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
          className="mt-1 shrink-0 text-accent"
        >
          <path d="M12 2C6.5 6 4 11 4 15c0 3.5 3.5 6 8 7 4.5-1 8-3.5 8-7 0-4-2.5-9-8-13z" />
          <path d="M12 2v20" />
          <path d="M12 8l-3 3" />
          <path d="M12 8l3 3" />
          <path d="M12 13l-4 3" />
          <path d="M12 13l4 3" />
        </svg>
        <div>
          <h2 className="type-section-title mb-1 font-display text-xl font-bold text-foreground">
            Sections
          </h2>
          <p className="m-0 text-sm leading-normal text-muted">
            Pick any part to hear it on its own.
          </p>
        </div>
      </div>

      <nav aria-label="Article sections">
        <ol className="m-0 list-none p-0" role="list">
          {/* Summary entry */}
          <li className={`toc-item${isSummaryActive ? " bg-accent-bg" : ""}`}>
            <div className={rowClass}>
              <span className={playableTitleClass}>
                <span
                  className={`font-semibold leading-[1.4] ${isSummaryActive ? "text-accent" : "text-foreground"}`}
                >
                  Summary
                </span>
                {summaryText && (
                  <DurationText
                    visible={durationLabel(
                      "summary",
                      summaryText,
                      sectionDurations,
                      playbackRate,
                    )}
                    accessible={durationLabelAccessible(
                      "summary",
                      summaryText,
                      sectionDurations,
                      playbackRate,
                    )}
                  />
                )}
              </span>
              <button
                type="button"
                id={tocFocusTargetId("summary")}
                onMouseEnter={onWarmSummary}
                onFocus={onWarmSummary}
                onPointerDown={onWarmSummary}
                onTouchStart={onWarmSummary}
                onClick={(e) => {
                  onListenSummary();
                  e.currentTarget.focus();
                }}
                aria-label={`Listen to summary of ${articleTitle}`}
                className={listenButtonClass(isSummaryActive, isSummaryLoading)}
              >
                <ListenStateIcon
                  loading={isSummaryLoading}
                  playing={isSummaryPlaying}
                  paused={isSummaryPaused}
                />
                <span aria-live="polite">
                  {listenStateText(
                    isSummaryLoading,
                    isSummaryPlaying,
                    isSummaryPaused,
                  )}
                </span>
              </button>
              {summaryHasExtras && (
                <RowExtras>
                  <ContextSectionLink blocks={summaryContextBlocks} />
                  <SectionDetailsBadge
                    sectionLabel="Summary"
                    linkCount={summaryLinkCount}
                    citationCount={summaryCitationCount}
                    isOpen={openPanel === "summary"}
                    onToggle={() => togglePanel("summary")}
                  />
                </RowExtras>
              )}
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
                hasLinks={(summaryLinkCount ?? 0) > 0}
                hasCitations={(summaryCitationCount ?? 0) > 0}
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
            const sectionBlocks = getContextBlocksForSection(
              contextBlocks,
              index,
              section.title,
              section.wikiSectionIndex,
            );
            const titleClass = `${section.level === 2 ? "font-semibold text-[0.9375rem]" : "font-normal text-[0.9375rem]"} min-w-0 [overflow-wrap:anywhere] leading-[1.4]`;

            if (!canListen) {
              const statusLabel = isTransition
                ? "Chapter transition"
                : "No source text";
              const statusDescription = isTransition
                ? "Spoken as a brief heading during Play all, downloads, and podcasts."
                : "Wikipedia has no text under this heading, so there is nothing to narrate.";
              return (
                <li key={index} className="toc-item mt-0.5">
                  <div
                    className={`${rowClass} cursor-default`}
                    style={
                      indent > 0
                        ? { paddingLeft: `${indent + 12}px` }
                        : undefined
                    }
                    data-toc-heading-only
                  >
                    <span className="flex min-w-0 flex-[1_1_200px] flex-col gap-[2px]">
                      <span
                        id={tocFocusTargetId(`section-${index}`)}
                        tabIndex={-1}
                        className={`${titleClass} text-foreground-2`}
                      >
                        {section.title}
                      </span>
                      <span className="text-sm leading-snug text-muted">
                        <span className="font-semibold">{statusLabel}.</span>{" "}
                        {statusDescription}
                      </span>
                    </span>
                    {sectionBlocks.length > 0 && (
                      <RowExtras>
                        <ContextSectionLink blocks={sectionBlocks} />
                      </RowExtras>
                    )}
                  </div>
                </li>
              );
            }

            const linkCount = sectionMetadataCount(
              linkCounts,
              section.wikiSectionIndex,
              section.title,
            );
            const citationCount = sectionMetadataCount(
              citationCounts,
              section.wikiSectionIndex,
              section.title,
            );
            const hasExtras =
              section.narration.adapted ||
              sectionBlocks.length > 0 ||
              (linkCount ?? 0) > 0 ||
              (citationCount ?? 0) > 0;

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
                  <span className={playableTitleClass}>
                    <span
                      className={`${titleClass} ${isActive ? "text-accent" : "text-foreground"}`}
                    >
                      {section.title}
                    </span>
                    <DurationText
                      visible={durationLabel(
                        `section-${index}`,
                        section.narration.text,
                        sectionDurations,
                        playbackRate,
                      )}
                      accessible={durationLabelAccessible(
                        `section-${index}`,
                        section.narration.text,
                        sectionDurations,
                        playbackRate,
                      )}
                    />
                  </span>

                  <button
                    type="button"
                    id={tocFocusTargetId(`section-${index}`)}
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
                    className={listenButtonClass(isActive, isLoading)}
                  >
                    <ListenStateIcon
                      loading={isLoading}
                      playing={isPlaying}
                      paused={isSectionPaused}
                    />
                    <span aria-live="polite">
                      {listenStateText(isLoading, isPlaying, isSectionPaused)}
                    </span>
                  </button>

                  {hasExtras && (
                    <RowExtras>
                      {section.narration.adapted && (
                        <span className="inline-flex max-w-full flex-wrap items-center gap-[6px]">
                          <span className="inline-flex items-center rounded-full border border-accent-border bg-accent-bg px-[10px] py-[2px] text-xs font-semibold leading-snug text-accent">
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
                              className="linked-article-link inline-flex min-h-11 items-center text-sm text-accent underline underline-offset-2"
                              aria-label={`View the complete source data for ${section.title} on Wikipedia; ${section.narration.remainingSourceItems} ${section.narration.remainingSourceItems === 1 ? "item remains" : "items remain"}; opens in a new tab`}
                            >
                              View complete source data
                            </a>
                          ) : null}
                        </span>
                      )}
                      <ContextSectionLink blocks={sectionBlocks} />
                      <SectionDetailsBadge
                        sectionLabel={section.title}
                        linkCount={linkCount}
                        citationCount={citationCount}
                        isOpen={openPanel === `section-${index}`}
                        onToggle={() => togglePanel(`section-${index}`)}
                      />
                    </RowExtras>
                  )}
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
                    hasLinks={(linkCount ?? 0) > 0}
                    hasCitations={(citationCount ?? 0) > 0}
                  />
                )}
              </li>
            );
          })}
        </ol>
      </nav>

      {(hasAdaptedSections || hasEmptySections) && (
        <p className="mt-3.5 text-center text-sm leading-normal text-muted">
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
    </div>
  );
};
