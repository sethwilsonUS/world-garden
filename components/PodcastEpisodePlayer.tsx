"use client";

import { usePlaybackRate } from "@/hooks/usePlaybackRate";
import { PlaybackSpeedControl } from "@/components/PlaybackSpeedControl";
import { useAudioElement } from "@/hooks/useAudioElement";
import { formatTime } from "@/lib/formatTime";

type PodcastEpisodePlayerProps = {
  audioUrl: string;
  title: string;
  /** Id of the visible episode heading that names this player group. */
  labelledBy?: string;
  durationSeconds?: number;
  className?: string;
};

export const PodcastEpisodePlayer = ({
  audioUrl,
  title,
  labelledBy,
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
    effectiveDuration > 0
      ? Math.min(100, (currentTime / effectiveDuration) * 100)
      : 0;

  return (
    // The title is printed once, in the card heading; the player group points
    // at it instead of repeating it visually.
    <div
      role="group"
      aria-labelledby={labelledBy}
      aria-label={labelledBy ? undefined : `Episode audio: ${title}`}
      className={`rounded-xl border border-border bg-surface px-3 py-2 ${className}`.trim()}
    >
      <div className="flex min-w-0 flex-wrap items-center gap-[10px] sm:gap-[12px]">
        <button
          type="button"
          onClick={toggle}
          aria-label={playing ? `Pause ${title}` : `Play ${title}`}
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

        <div className="grid min-w-[min(100%,8rem)] flex-[1_1_8rem] gap-[6px]">
          <div
            aria-hidden="true"
            className="h-1.5 overflow-hidden rounded-full bg-surface-3"
          >
            <div
              className="h-full rounded-full bg-accent transition-[width] duration-200"
              style={{ width: `${progress}%` }}
            />
          </div>
          <span className="min-w-0 break-words text-xs text-muted tabular-nums [overflow-wrap:anywhere]">
            {formatTime(currentTime)} / {formatTime(effectiveDuration)}
          </span>
        </div>

        <PlaybackSpeedControl rate={rate} onRateChange={setRate} />
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
