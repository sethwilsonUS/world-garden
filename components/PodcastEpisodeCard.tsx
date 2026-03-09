import type { ReactNode } from "react";
import { PodcastEpisodeArtwork } from "@/components/PodcastEpisodeArtwork";
import { PodcastEpisodePlayer } from "@/components/PodcastEpisodePlayer";

type PodcastEpisodeCardProps = {
  artworkSrc: string | null;
  artworkAlt: string;
  audioUrl: string | null;
  durationSeconds?: number;
  title: string;
  dateLabel: string;
  summary?: string;
  actions: ReactNode;
};

function formatDuration(seconds: number): string {
  if (seconds >= 3600) {
    const h = Math.floor(seconds / 3600);
    const m = Math.floor((seconds % 3600) / 60);
    return m > 0 ? `${h}h ${m}m` : `${h}h`;
  }
  return `${Math.ceil(seconds / 60)} min`;
}

export const PodcastEpisodeCard = ({
  artworkSrc,
  artworkAlt,
  audioUrl,
  durationSeconds,
  title,
  dateLabel,
  summary,
  actions,
}: PodcastEpisodeCardProps) => {
  const durationLabel =
    durationSeconds && durationSeconds > 0
      ? formatDuration(durationSeconds)
      : null;

  return (
    <article className="garden-bed p-4 sm:p-5">
      {/* Info row: artwork + text metadata */}
      <div className="flex flex-col sm:flex-row gap-4 sm:gap-5">
        {artworkSrc && (
          <PodcastEpisodeArtwork
            src={artworkSrc}
            alt={artworkAlt}
            className="mx-auto w-full max-w-[200px] sm:mx-0 sm:w-36 md:w-40 shrink-0"
          />
        )}

        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-x-2 gap-y-0.5">
            <span className="text-[0.68rem] font-semibold uppercase tracking-[0.14em] text-muted">
              {dateLabel}
            </span>
            {durationLabel && (
              <>
                <span
                  className="inline-block h-[3px] w-[3px] rounded-full bg-muted"
                  aria-hidden="true"
                />
                <span className="font-mono text-[0.68rem] text-muted">
                  {durationLabel}
                </span>
              </>
            )}
          </div>

          <h3 className="mt-1.5 font-display text-[1.08rem] font-semibold leading-[1.28] text-foreground sm:text-[1.14rem]">
            {title}
          </h3>

          {summary && (
            <p className="mt-2 text-sm leading-[1.68] text-foreground-2 line-clamp-3">
              {summary}
            </p>
          )}
        </div>
      </div>

      {/* Playback */}
      {audioUrl && (
        <PodcastEpisodePlayer
          audioUrl={audioUrl}
          title={title}
          durationSeconds={durationSeconds}
          className="mt-4"
        />
      )}

      {/* Actions */}
      <div className="mt-3 flex flex-wrap gap-2">{actions}</div>
    </article>
  );
};
