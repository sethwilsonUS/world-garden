"use client";

import Link from "next/link";
import { usePlaybackRate, formatRate } from "@/hooks/usePlaybackRate";
import { useAudioElement } from "@/hooks/useAudioElement";
import { formatTime } from "@/lib/formatTime";

type DailyTrendingBriefPlayerProps = {
  audioUrl: string;
  title: string;
  durationSeconds?: number;
};

export const DailyTrendingBriefPlayer = ({
  audioUrl,
  title,
  durationSeconds,
}: DailyTrendingBriefPlayerProps) => {
  const { rate, setRate } = usePlaybackRate();
  const { audioRef, playing, currentTime, duration, toggle } = useAudioElement({
    url: audioUrl,
    playbackRate: rate,
  });

  const effectiveDuration =
    duration > 0 ? duration : (durationSeconds ?? 0);
  const progress =
    effectiveDuration > 0 ? Math.min(100, (currentTime / effectiveDuration) * 100) : 0;

  return (
    <div className="mb-5 rounded-2xl border border-border bg-surface-2 px-4 py-3">
      <div className="flex flex-wrap items-center gap-3">
        <button
          onClick={toggle}
          aria-label={playing ? "Pause daily trending briefing" : "Play daily trending briefing"}
          className="search-submit flex h-10 w-10 shrink-0 items-center justify-center rounded-full border-0 bg-accent text-white"
        >
          {playing ? (
            <svg viewBox="0 0 24 24" fill="currentColor" width={18} height={18} aria-hidden="true">
              <rect x="6" y="4" width="4" height="16" rx="1" />
              <rect x="14" y="4" width="4" height="16" rx="1" />
            </svg>
          ) : (
            <svg viewBox="0 0 24 24" fill="currentColor" width={18} height={18} aria-hidden="true" className="ml-0.5">
              <polygon points="5 3 19 12 5 21 5 3" />
            </svg>
          )}
        </button>

        <div className="min-w-0 flex-1">
          <p className="m-0 text-[0.7rem] font-semibold uppercase tracking-[0.16em] text-muted">
            Daily audio briefing
          </p>
          <p className="m-0 mt-1 truncate font-display text-sm font-semibold text-foreground">
            {title}
          </p>
        </div>

        <button
          onClick={() => {
            const rates = [0.5, 0.75, 1, 1.25, 1.5, 1.75, 2, 2.5, 3] as const;
            const currentIndex = rates.indexOf(rate);
            setRate(rates[(currentIndex + 1) % rates.length]);
          }}
          aria-label={`Playback speed ${formatRate(rate)}. Click to change.`}
          className={`min-w-[44px] rounded-lg border border-border px-2.5 py-2 font-mono text-xs font-bold leading-none ${rate !== 1 ? "text-accent" : "text-muted"}`}
        >
          {formatRate(rate)}
        </button>
      </div>

      <div className="mt-3 flex items-center gap-3">
        <div
          aria-hidden="true"
          className="h-1.5 flex-1 overflow-hidden rounded-full bg-surface-3"
        >
          <div
            className="h-full rounded-full bg-accent transition-[width] duration-200"
            style={{ width: `${progress}%` }}
          />
        </div>
        <span className="font-mono text-[0.7rem] text-muted tabular-nums">
          {formatTime(currentTime)} / {formatTime(effectiveDuration)}
        </span>
        <Link
          href="/trending"
          className="text-[0.75rem] font-medium text-accent no-underline"
        >
          Open
        </Link>
      </div>

      <audio
        ref={audioRef}
        src={audioUrl}
        preload="metadata"
        aria-label={`Audio for ${title}`}
      />
    </div>
  );
};
