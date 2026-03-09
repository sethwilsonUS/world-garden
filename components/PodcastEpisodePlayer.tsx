"use client";

import { usePlaybackRate, formatRate } from "@/hooks/usePlaybackRate";
import { useAudioElement } from "@/hooks/useAudioElement";
import { formatTime } from "@/lib/formatTime";

type PodcastEpisodePlayerProps = {
  audioUrl: string;
  title: string;
  durationSeconds?: number;
  className?: string;
};

export const PodcastEpisodePlayer = ({
  audioUrl,
  title,
  durationSeconds,
  className = "",
}: PodcastEpisodePlayerProps) => {
  const { rate, setRate } = usePlaybackRate();
  const { audioRef, playing, currentTime, duration, toggle } = useAudioElement({
    url: audioUrl,
    playbackRate: rate,
  });

  const effectiveDuration = duration > 0 ? duration : (durationSeconds ?? 0);
  const progress =
    effectiveDuration > 0 ? Math.min(100, (currentTime / effectiveDuration) * 100) : 0;

  return (
    <div
      className={`rounded-xl border border-border bg-surface px-3 py-2.5 sm:px-3.5 sm:py-3 ${className}`.trim()}
    >
      <div className="flex flex-wrap items-center gap-2.5 sm:gap-3">
        <button
          type="button"
          onClick={toggle}
          aria-label={playing ? `Pause ${title}` : `Play ${title}`}
          className="search-submit flex h-10 w-10 shrink-0 items-center justify-center rounded-full border-0 bg-accent text-white"
        >
          {playing ? (
            <svg viewBox="0 0 24 24" fill="currentColor" width={18} height={18} aria-hidden="true">
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

        <div className="min-w-0 flex-1">
          <p className="m-0 text-[0.68rem] font-semibold uppercase tracking-[0.14em] text-muted">
            Episode audio
          </p>
          <p className="m-0 mt-0.5 truncate font-display text-[0.92rem] font-semibold text-foreground">
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
          className={`min-w-[44px] rounded-lg border border-border px-2.5 py-2 font-mono text-[0.72rem] font-bold leading-none ${
            rate !== 1 ? "text-accent" : "text-muted"
          }`}
        >
          {formatRate(rate)}
        </button>
      </div>

      <div className="mt-2.5 flex items-center gap-2.5 sm:gap-3">
        <div
          aria-hidden="true"
          className="h-1.5 flex-1 overflow-hidden rounded-full bg-surface-3"
        >
          <div
            className="h-full rounded-full bg-accent transition-[width] duration-200"
            style={{ width: `${progress}%` }}
          />
        </div>
        <span className="shrink-0 font-mono text-[0.68rem] text-muted tabular-nums">
          {formatTime(currentTime)} / {formatTime(effectiveDuration)}
        </span>
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
