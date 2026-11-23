"use client";

import {
  useCallback,
  useEffect,
  useId,
  useLayoutEffect,
  useRef,
  useState,
  type CSSProperties,
  type RefObject,
} from "react";
import {
  PLAYBACK_RATES,
  type PlaybackRate,
  formatRate,
} from "@/hooks/usePlaybackRate";
import { formatTime } from "@/lib/formatTime";
import type { AudioPlaybackState } from "@/lib/article-audio-playback";
import {
  PauseIcon,
  PlayIcon,
  SpeedButton,
  SpinnerIcon,
} from "@/components/AudioPlaybackPresentation";

export const NOW_PLAYING_HEIGHT_VARIABLE = "--now-playing-height";
const MINIMIZED_STORAGE_KEY = "curio-now-playing-minimized";
const SKIP_SECONDS = 10;

const readMinimized = (): boolean => {
  if (typeof window === "undefined") return false;
  try {
    return window.localStorage.getItem(MINIMIZED_STORAGE_KEY) === "true";
  } catch (error) {
    console.debug("Could not read the Now playing preference.", error);
    return false;
  }
};

type NowPlayingBarProps = {
  returnFocusRef: RefObject<HTMLButtonElement | null>;
  articleTitle: string;
  /** Title of the section that is loaded, e.g. "Summary" or "History". */
  sectionTitle: string | null;
  playback: AudioPlaybackState;
  audioProgress?: { currentTime: number; duration: number };
  playbackRate: number;
  onTogglePlayback: () => void;
  onSkipBy: (seconds: number) => void;
  onSkipSection?: () => void;
  onStop: () => void;
  onSeek: (time: number) => void;
  onPlaybackRateChange: (rate: PlaybackRate) => void;
  /** Scrolls to the active section row and moves focus to it. */
  onJumpToSection: () => void;
};

/** Visible only when a section is loading, playing, or paused mid-section. */
export const isNowPlayingVisible = (playback: AudioPlaybackState): boolean =>
  playback.sectionKey !== null &&
  (playback.status === "playing" ||
    playback.status === "paused" ||
    playback.status === "loading");

const controlBaseClass =
  "inline-flex min-h-11 min-w-11 max-w-full shrink-0 cursor-pointer items-center justify-center gap-[6px] rounded-xl border px-[10px] py-[6px] text-sm font-semibold leading-none transition-colors duration-150 motion-reduce:transition-none focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent focus-visible:ring-offset-2 focus-visible:ring-offset-surface-2";

const controlClass = `${controlBaseClass} border-border bg-surface text-foreground hover:bg-surface-3`;

const SkipSecondsIcon = ({ direction }: { direction: "back" | "forward" }) => (
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
    focusable="false"
    className="shrink-0"
    style={direction === "forward" ? { transform: "scaleX(-1)" } : undefined}
  >
    <path d="M3 12a9 9 0 1 0 3-6.7" />
    <polyline points="3 3 3 9 9 9" />
  </svg>
);

const NextSectionIcon = () => (
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

const StopIcon = () => (
  <svg
    viewBox="0 0 24 24"
    fill="currentColor"
    width={14}
    height={14}
    aria-hidden="true"
    focusable="false"
    className="shrink-0"
  >
    <rect x="6" y="6" width="12" height="12" rx="2" />
  </svg>
);

const JumpIcon = () => (
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
    focusable="false"
    className="shrink-0"
  >
    <line x1="8" y1="6" x2="21" y2="6" />
    <line x1="8" y1="12" x2="21" y2="12" />
    <line x1="8" y1="18" x2="21" y2="18" />
    <circle cx="4" cy="6" r="1" />
    <circle cx="4" cy="12" r="1" />
    <circle cx="4" cy="18" r="1" />
  </svg>
);

/**
 * Persistent "Now playing" bar fixed to the bottom of the viewport. It drives
 * the article's single audio element through the existing controller, is a
 * plain landmark region (not a dialog, no focus trap), and publishes its
 * height to `--now-playing-height` so scroll padding keeps focused content
 * visible above it.
 */
export const NowPlayingBar = ({
  returnFocusRef,
  articleTitle,
  sectionTitle,
  playback,
  audioProgress,
  playbackRate,
  onTogglePlayback,
  onSkipBy,
  onSkipSection,
  onStop,
  onSeek,
  onPlaybackRateChange,
  onJumpToSection,
}: NowPlayingBarProps) => {
  const barRef = useRef<HTMLElement>(null);
  const hadFocusOnRemoval = useRef(false);
  const attachBar = useCallback((bar: HTMLElement | null) => {
    if (!bar) {
      // React detaches this ref before removing the focused descendant.
      hadFocusOnRemoval.current =
        barRef.current?.contains(document.activeElement) ?? false;
    }
    barRef.current = bar;
  }, []);
  const controlsId = useId();
  const [minimized, setMinimized] = useState(readMinimized);
  const [rateAnnouncement, setRateAnnouncement] = useState("");
  const visible = isNowPlayingVisible(playback);

  useLayoutEffect(() => {
    // A route unmount never runs this update. An outside control keeps focus.
    if (
      !visible &&
      hadFocusOnRemoval.current &&
      document.activeElement === document.body
    ) {
      returnFocusRef.current?.focus();
    }
    hadFocusOnRemoval.current = false;
  }, [visible, returnFocusRef]);

  useEffect(() => {
    if (!visible) return;
    const bar = barRef.current;
    if (!bar) return;
    const root = document.documentElement;
    const body = document.body;
    const previousBodyPadding = body.style.paddingBottom;
    const publish = () => {
      root.style.setProperty(
        NOW_PLAYING_HEIGHT_VARIABLE,
        `${Math.ceil(bar.getBoundingClientRect().height)}px`,
      );
    };
    publish();
    // Keep the footer and the end of the article reachable above the bar.
    body.style.paddingBottom = `var(${NOW_PLAYING_HEIGHT_VARIABLE}, 0px)`;
    const observer =
      typeof ResizeObserver === "undefined"
        ? null
        : new ResizeObserver(publish);
    observer?.observe(bar);

    return () => {
      observer?.disconnect();
      root.style.removeProperty(NOW_PLAYING_HEIGHT_VARIABLE);
      body.style.paddingBottom = previousBodyPadding;
    };
  }, [visible]);

  // Play all advances on its own, so announce each new section once. Single
  // sections are started by the user and already confirmed by their button.
  const sectionAnnouncement =
    playback.mode === "play_all" &&
    (playback.status === "playing" || playback.status === "paused") &&
    sectionTitle
      ? `Now playing: ${sectionTitle}`
      : "";

  const liveRegions = (
    <>
      <p className="sr-only" role="status" aria-live="polite">
        {sectionAnnouncement}
      </p>
      <p className="sr-only" aria-live="polite">
        {rateAnnouncement}
      </p>
    </>
  );

  if (!visible) return liveRegions;

  const isLoading = playback.status === "loading";
  const isPaused = playback.status === "paused";
  const isPlayingAll = playback.mode === "play_all";
  const displayTitle = sectionTitle ?? "Article audio";

  const duration =
    audioProgress &&
    Number.isFinite(audioProgress.duration) &&
    audioProgress.duration > 0
      ? audioProgress.duration
      : 0;
  const currentTime =
    audioProgress && Number.isFinite(audioProgress.currentTime)
      ? Math.min(duration, Math.max(0, audioProgress.currentTime))
      : 0;
  const progress = duration > 0 ? (currentTime / duration) * 100 : 0;
  const canSeek = !isLoading && duration > 0;

  const cycleSpeed = () => {
    const idx = PLAYBACK_RATES.indexOf(playbackRate as PlaybackRate);
    const next = PLAYBACK_RATES[(idx + 1) % PLAYBACK_RATES.length];
    onPlaybackRateChange(next);
    setRateAnnouncement(`Playback speed ${formatRate(next)}`);
  };

  const toggleMinimized = () => {
    const next = !minimized;
    setMinimized(next);
    try {
      window.localStorage.setItem(MINIMIZED_STORAGE_KEY, String(next));
    } catch (error) {
      console.debug("Could not save the Now playing preference.", error);
    }
  };

  return (
    <>
      {liveRegions}
      <section
        ref={attachBar}
        aria-label="Now playing"
        data-now-playing-bar
        className="fixed inset-x-0 bottom-0 z-50 max-h-[60dvh] overflow-y-auto border-t border-border bg-surface-2 pb-[max(0.5rem,env(safe-area-inset-bottom))] pt-2 shadow-[0_-8px_24px_rgba(0,0,0,0.18)] [overflow-wrap:anywhere]"
      >
        <div className="@container mx-auto flex max-w-3xl flex-col gap-1 px-3 sm:px-4">
          <div
            className={`flex min-w-0 gap-2 ${minimized ? "items-center" : "items-start"}`}
          >
            <div className="min-w-0 flex-1">
              <p
                className={`m-0 text-sm font-semibold leading-snug text-foreground sm:text-base ${minimized ? "line-clamp-2" : ""}`}
              >
                {displayTitle}
              </p>
              {!minimized && (
                <p className="m-0 line-clamp-1 text-xs leading-snug text-muted sm:text-sm">
                  {isLoading ? "Loading audio · " : isPaused ? "Paused · " : ""}
                  {articleTitle}
                </p>
              )}
            </div>
            <button
              type="button"
              onClick={() => {
                if (!isLoading) onTogglePlayback();
              }}
              aria-disabled={isLoading || undefined}
              aria-label={
                isLoading
                  ? `Loading ${displayTitle}`
                  : isPaused
                    ? `Play ${displayTitle}`
                    : `Pause ${displayTitle}`
              }
              className={`${controlBaseClass} min-w-12 border-transparent bg-btn-primary px-[14px] text-btn-primary-text hover:bg-btn-primary-hover [&>svg]:size-[1.1em] ${
                isLoading ? "cursor-wait" : ""
              }`}
            >
              {isLoading ? (
                <SpinnerIcon />
              ) : isPaused ? (
                <PlayIcon />
              ) : (
                <PauseIcon />
              )}
              <span className="hidden @min-[24em]:inline">
                {isLoading ? "Loading" : isPaused ? "Play" : "Pause"}
              </span>
            </button>
            <button
              type="button"
              aria-expanded={!minimized}
              aria-controls={controlsId}
              onClick={toggleMinimized}
              className={controlClass}
            >
              <svg
                aria-hidden="true"
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                strokeLinecap="round"
                strokeLinejoin="round"
                strokeWidth={2}
                className={`size-[1.1em] shrink-0 ${minimized ? "rotate-180" : ""}`}
              >
                <path d="m5 9 7 7 7-7" />
              </svg>
              <span className="@max-[16em]:sr-only">
                Player controls
              </span>
            </button>
          </div>

          <div id={controlsId} hidden={minimized}>
            <div
              role="group"
              aria-label="Playback controls"
              className="flex flex-wrap items-center gap-[6px]"
            >
              <button
                type="button"
                onClick={() => onSkipBy(-SKIP_SECONDS)}
                disabled={!canSeek}
                aria-label={`Back ${SKIP_SECONDS} seconds`}
                className={`${controlClass} disabled:cursor-not-allowed disabled:text-muted`}
              >
                <SkipSecondsIcon direction="back" />
                <span aria-hidden="true" className="text-xs">
                  {SKIP_SECONDS}
                </span>
              </button>
              <button
                type="button"
                onClick={() => onSkipBy(SKIP_SECONDS)}
                disabled={!canSeek}
                aria-label={`Forward ${SKIP_SECONDS} seconds`}
                className={`${controlClass} disabled:cursor-not-allowed disabled:text-muted`}
              >
                <span aria-hidden="true" className="text-xs">
                  {SKIP_SECONDS}
                </span>
                <SkipSecondsIcon direction="forward" />
              </button>
              {isPlayingAll && onSkipSection ? (
                <button
                  type="button"
                  onClick={onSkipSection}
                  aria-label="Next section"
                  className={controlClass}
                >
                  <NextSectionIcon />
                </button>
              ) : null}
              <SpeedButton rate={playbackRate} onClick={cycleSpeed} />
              <button
                type="button"
                onClick={onJumpToSection}
                className={controlClass}
              >
                <JumpIcon />
                <span>Jump to section</span>
              </button>
              <button
                type="button"
                onClick={onStop}
                aria-label="Stop audio"
                className={controlClass}
              >
                <StopIcon />
              </button>
            </div>

            <div className="audio-scrubber flex min-w-0 flex-wrap items-center gap-x-3">
              <input
                type="range"
                min={0}
                max={duration}
                step={0.1}
                value={currentTime}
                disabled={!canSeek}
                onChange={(event) => {
                  const value = parseFloat(event.target.value);
                  onSeek(
                    Number.isFinite(value)
                      ? Math.min(duration, Math.max(0, value))
                      : 0,
                  );
                }}
                aria-label={`Position in ${displayTitle}`}
                aria-valuetext={`${formatTime(currentTime)} of ${formatTime(duration)}`}
                className="audio-progress-range block min-h-11 min-w-0 flex-[1_1_8rem]"
                style={{ "--progress": `${progress}%` } as CSSProperties}
              />
              <span
                aria-hidden="true"
                className="max-w-full font-mono text-xs font-medium tabular-nums text-foreground-2"
              >
                {formatTime(currentTime)} /{" "}
                {duration > 0 ? formatTime(duration) : "--:--"}
              </span>
            </div>
          </div>
        </div>
      </section>
    </>
  );
};
