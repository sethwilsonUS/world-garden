import type { ReactNode } from "react";
import { PodcastEpisodeArtwork } from "@/components/PodcastEpisodeArtwork";
import { PodcastEpisodePlayer } from "@/components/PodcastEpisodePlayer";

type PodcastEpisodeCardProps = {
  /** Stable id used to label the episode's player by its visible heading. */
  headingId: string;
  headingLevel?: 3 | 4;
  artworkSrc: string | null;
  artworkAlt?: string;
  audioUrl: string | null;
  durationSeconds?: number;
  title: string;
  dateLabel: string;
  summary?: string;
  /** Clamp the summary to two lines for overview lists. */
  compact?: boolean;
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
  headingId,
  headingLevel = 3,
  artworkSrc,
  artworkAlt = "",
  audioUrl,
  durationSeconds,
  title,
  dateLabel,
  summary,
  compact = false,
  actions,
}: PodcastEpisodeCardProps) => {
  const durationLabel =
    durationSeconds && durationSeconds > 0
      ? formatDuration(durationSeconds)
      : null;
  const Heading = headingLevel === 4 ? "h4" : "h3";

  return (
    <article className="rounded-xl border border-border bg-surface-2 p-4">
      <div className="flex min-w-0 items-start gap-4">
        {artworkSrc && (
          <PodcastEpisodeArtwork
            src={artworkSrc}
            alt={artworkAlt}
            className="w-16 shrink-0 sm:w-20"
          />
        )}

        <div className="min-w-0 flex-1">
          <Heading
            id={headingId}
            className="break-words font-display text-[1.05rem] font-semibold leading-[1.3] text-foreground [overflow-wrap:anywhere]"
          >
            {title}
          </Heading>
          <p className="mt-1 text-xs text-muted">
            {dateLabel}
            {durationLabel ? (
              <>
                <span aria-hidden="true"> · </span>
                <span className="sr-only">, </span>
                <span className="tabular-nums">{durationLabel}</span>
              </>
            ) : null}
          </p>

          {summary && (
            <p
              className={`mt-2 break-words text-sm leading-[1.6] text-foreground-2 [overflow-wrap:anywhere] ${
                compact ? "line-clamp-2" : ""
              }`.trim()}
            >
              {summary}
            </p>
          )}
        </div>
      </div>

      {audioUrl && (
        <PodcastEpisodePlayer
          audioUrl={audioUrl}
          title={title}
          labelledBy={headingId}
          durationSeconds={durationSeconds}
          className="mt-3"
        />
      )}

      <div className="mt-3 flex flex-wrap gap-2">{actions}</div>
    </article>
  );
};
