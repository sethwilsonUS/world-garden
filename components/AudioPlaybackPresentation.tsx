"use client";

import type { CSSProperties } from "react";
import { formatRate } from "@/hooks/usePlaybackRate";
import { formatTime } from "@/lib/formatTime";

export const PlayIcon = () => {
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
      focusable="false"
      className="shrink-0"
    >
      <polygon points="5 3 19 12 5 21 5 3" />
    </svg>
  );
};

export const PauseIcon = () => {
  return (
    <svg
      viewBox="0 0 24 24"
      fill="currentColor"
      width={14}
      height={14}
      aria-hidden="true"
      focusable="false"
      className="shrink-0"
    >
      <rect x="6" y="4" width="4" height="16" rx="1" />
      <rect x="14" y="4" width="4" height="16" rx="1" />
    </svg>
  );
};

export const SpinnerIcon = () => {
  return (
    <svg
      className="animate-spin shrink-0"
      fill="none"
      viewBox="0 0 24 24"
      width={14}
      height={14}
      aria-hidden="true"
      focusable="false"
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

export const SoundIcon = () => {
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
      focusable="false"
      className="shrink-0"
    >
      <polygon points="11 5 6 9 2 9 2 15 6 15 11 19 11 5" />
      <path d="M15.54 8.46a5 5 0 0 1 0 7.07" />
    </svg>
  );
};

export const SpeedButton = ({
  rate,
  onClick,
}: {
  rate: number;
  onClick: () => void;
}) => (
  <button
    type="button"
    onClick={onClick}
    aria-label={`Playback speed ${formatRate(rate)}. Activate to change.`}
    className={`inline-flex min-h-11 min-w-11 shrink-0 cursor-pointer items-center justify-center rounded-lg border border-border bg-transparent px-2 py-[5px] font-mono text-xs font-bold leading-none transition-colors duration-150 pointer-events-auto ${
      rate !== 1 ? "text-accent" : "text-muted"
    }`}
  >
    {formatRate(rate)}
  </button>
);

export const InlineProgressBar = ({
  currentTime,
  duration,
  onSeek,
}: {
  currentTime: number;
  duration: number;
  onSeek: (time: number) => void;
}) => {
  const normalizedDuration =
    Number.isFinite(duration) && duration > 0 ? duration : 0;
  const normalizedCurrentTime = Number.isFinite(currentTime)
    ? Math.min(normalizedDuration, Math.max(0, currentTime))
    : 0;
  const progress =
    normalizedDuration > 0
      ? (normalizedCurrentTime / normalizedDuration) * 100
      : 0;
  const handleSeek = (value: number) => {
    const normalizedValue = Number.isFinite(value)
      ? Math.min(normalizedDuration, Math.max(0, value))
      : 0;
    onSeek(normalizedValue);
  };

  return (
    <div className="audio-scrubber group px-3 pb-3 pt-1">
      <div className="relative flex-1 min-w-0">
        <input
          type="range"
          min={0}
          max={normalizedDuration}
          step={0.1}
          value={normalizedCurrentTime}
          onChange={(event) => handleSeek(parseFloat(event.target.value))}
          aria-label="Playback position"
          aria-valuemin={0}
          aria-valuemax={normalizedDuration}
          aria-valuenow={normalizedCurrentTime}
          aria-valuetext={`${formatTime(normalizedCurrentTime)} of ${formatTime(normalizedDuration)}`}
          className="audio-progress-range block w-full"
          style={{ "--progress": `${progress}%` } as CSSProperties}
        />
      </div>
      <div className="flex items-center justify-between mt-1.5 px-0.5">
        <span
          className="font-mono text-[0.625rem] tracking-wide font-medium text-accent select-none tabular-nums"
          aria-hidden="true"
        >
          {formatTime(normalizedCurrentTime)}
        </span>
        <span
          className="font-mono text-[0.625rem] tracking-wide font-medium text-muted select-none tabular-nums"
          aria-hidden="true"
        >
          {normalizedDuration > 0 ? formatTime(normalizedDuration) : "--:--"}
        </span>
      </div>
    </div>
  );
};
