"use client";

import { useEffect, useId, useRef, useState } from "react";
import {
  MAX_PLAYBACK_RATE,
  MIN_PLAYBACK_RATE,
  describePlaybackRateChange,
  formatRate,
  stepPlaybackRate,
  type PlaybackRate,
} from "@/hooks/usePlaybackRate";

// Simple line drawings sized to the surrounding text so they scale with it.
const TurtleIcon = () => (
  <svg
    viewBox="0 0 24 24"
    fill="none"
    stroke="currentColor"
    strokeWidth={2}
    strokeLinecap="round"
    strokeLinejoin="round"
    aria-hidden="true"
    focusable="false"
    className="size-[1.25em] shrink-0"
  >
    <path d="m12 10 2 4v3a1 1 0 0 0 1 1h2a1 1 0 0 0 1-1v-3a8 8 0 1 0-16 0v3a1 1 0 0 0 1 1h2a1 1 0 0 0 1-1v-3l2-4h4Z" />
    <path d="M4.82 7.9 8 10" />
    <path d="M15.18 7.9 12 10" />
    <path d="M16.93 10H20a2 2 0 0 1 0 4H2" />
  </svg>
);

const RabbitIcon = () => (
  <svg
    viewBox="0 0 24 24"
    fill="none"
    stroke="currentColor"
    strokeWidth={2}
    strokeLinecap="round"
    strokeLinejoin="round"
    aria-hidden="true"
    focusable="false"
    className="size-[1.25em] shrink-0"
  >
    <path d="M13 16a3 3 0 0 1 2.24 5" />
    <path d="M18 12h.01" />
    <path d="M18 21h-8a4 4 0 0 1-4-4 7 7 0 0 1 7-7h.2L9.6 6.4a1 1 0 1 1 2.8-2.8L15.8 7h.2c3.3 0 6 2.7 6 6v1a2 2 0 0 1-2 2h-1a3 3 0 0 0-3 3" />
    <path d="M20 8.54V4a2 2 0 1 0-4 0v3" />
    <path d="M7.612 12.524a3 3 0 1 0-1.6 4.3" />
  </svg>
);

const stepButtonClass =
  "inline-flex min-h-11 min-w-11 shrink-0 cursor-pointer items-center justify-center rounded-lg border-0 bg-transparent px-[8px] text-foreground-2 transition-colors duration-150 hover:bg-accent-bg hover:text-accent motion-reduce:transition-none focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent aria-disabled:cursor-not-allowed aria-disabled:text-muted aria-disabled:hover:bg-transparent";

type PlaybackSpeedControlProps = {
  rate: PlaybackRate;
  onRateChange: (rate: PlaybackRate) => void;
  className?: string;
};

/**
 * Slower (turtle) and Faster (rabbit) buttons around the current speed.
 * Each press moves 0.1x between 0.5x and 4x. The group never wraps inside
 * itself, so at large text or narrow widths it moves to its own line as a
 * single unit instead of separating the buttons from the speed they change.
 */
export const PlaybackSpeedControl = ({
  rate,
  onRateChange,
  className = "",
}: PlaybackSpeedControlProps) => {
  const readoutId = useId();
  const [announcement, setAnnouncement] = useState("");
  // Two presses in one turn must step from the newest value, not a stale
  // prop; after each render the prop is the source of truth again.
  const rateRef = useRef(rate);
  useEffect(() => {
    rateRef.current = rate;
  });

  const step = (direction: 1 | -1) => {
    const previous = rateRef.current;
    const next = stepPlaybackRate(previous, direction);
    setAnnouncement(describePlaybackRateChange(previous, next, direction));
    if (next === previous) return;
    rateRef.current = next;
    onRateChange(next);
  };

  const atSlowest = rate <= MIN_PLAYBACK_RATE;
  const atFastest = rate >= MAX_PLAYBACK_RATE;

  return (
    <div
      role="group"
      aria-label="Playback speed"
      data-playback-speed=""
      className={`inline-flex shrink-0 items-center whitespace-nowrap rounded-xl border border-border bg-surface ${className}`.trim()}
    >
      <button
        type="button"
        onClick={() => step(-1)}
        aria-label="Slower"
        aria-describedby={readoutId}
        aria-disabled={atSlowest || undefined}
        title="Slower"
        className={stepButtonClass}
      >
        <TurtleIcon />
      </button>
      <span
        id={readoutId}
        className={`min-w-[3.5em] px-[2px] text-center font-mono text-sm font-bold tabular-nums leading-none ${
          rate !== 1 ? "text-accent" : "text-foreground-2"
        }`}
      >
        {formatRate(rate)}
      </span>
      <button
        type="button"
        onClick={() => step(1)}
        aria-label="Faster"
        aria-describedby={readoutId}
        aria-disabled={atFastest || undefined}
        title="Faster"
        className={stepButtonClass}
      >
        <RabbitIcon />
      </button>
      <span className="sr-only" role="status" aria-live="polite">
        {announcement}
      </span>
    </div>
  );
};
