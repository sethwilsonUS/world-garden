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

  const effectiveDuration = duration > 0 ? duration : (durationSeconds ?? 0);
  const progress =
    effectiveDuration > 0
      ? Math.min(100, (currentTime / effectiveDuration) * 100)
      : 0;

  return (
    <div className="mb-5 rounded-2xl border border-border bg-surface-2 px-4 py-3">
      <div className="flex min-w-0 flex-wrap items-start gap-[12px]">
        <button
          type="button"
          onClick={toggle}
          aria-label={
            playing
              ? "Pause AI-generated daily trending briefing"
              : "Play AI-generated daily trending briefing"
          }
          className="search-submit flex h-[44px] w-[44px] shrink-0 items-center justify-center rounded-full border-0 bg-accent text-white"
        >
          {playing ? (
            <svg
              viewBox="0 0 24 24"
              fill="currentColor"
              width={18}
              height={18}
              aria-hidden="true"
            >
              <rect x="6" y="4" width="4" height="16" rx="1" />
              <rect x="14" y="4" width="4" height="16" rx="1" />
            </svg>
          ) : (
            <svg
              viewBox="0 0 24 24"
              fill="currentColor"
              width={18}
              height={18}
              aria-hidden="true"
              className="ml-0.5"
            >
              <polygon points="5 3 19 12 5 21 5 3" />
            </svg>
          )}
        </button>

        <div className="min-w-[min(100%,10rem)] flex-[1_1_10rem] break-words [overflow-wrap:anywhere]">
          <p className="m-0 text-[0.7rem] font-semibold uppercase tracking-[0.16em] text-muted">
            AI-generated daily audio briefing
          </p>
          <p className="m-0 mt-1 font-display text-sm font-semibold leading-snug text-foreground">
            {title}
          </p>
        </div>

        <button
          type="button"
          onClick={() => {
            const rates = [0.5, 0.75, 1, 1.25, 1.5, 1.75, 2, 2.5, 3] as const;
            const currentIndex = rates.indexOf(rate);
            setRate(rates[(currentIndex + 1) % rates.length]);
          }}
          aria-label={`Playback speed ${formatRate(rate)}. Click to change.`}
          className={`min-h-[44px] min-w-[44px] shrink-0 rounded-lg border border-border px-[10px] py-[8px] font-mono text-xs font-bold leading-none ${rate !== 1 ? "text-accent" : "text-muted"}`}
        >
          {formatRate(rate)}
        </button>
      </div>

      <div className="mt-[12px] grid min-w-0 grid-cols-[minmax(0,1fr)_auto] items-center gap-x-[12px] gap-y-[8px]">
        <div
          aria-hidden="true"
          className="col-span-2 h-1.5 overflow-hidden rounded-full bg-surface-3"
        >
          <div
            className="h-full rounded-full bg-accent transition-[width] duration-200"
            style={{ width: `${progress}%` }}
          />
        </div>
        <span className="min-w-0 font-mono text-[0.7rem] text-muted tabular-nums">
          {formatTime(currentTime)} / {formatTime(effectiveDuration)}
        </span>
        <Link
          href="/trending"
          className="inline-flex min-h-[44px] items-center justify-self-end rounded-lg px-[8px] text-[0.75rem] font-medium text-accent no-underline"
        >
          Open
        </Link>
      </div>

      <audio
        ref={audioRef}
        src={audioUrl}
        preload="metadata"
        aria-label={`AI-generated audio briefing: ${title}`}
      />
    </div>
  );
};
