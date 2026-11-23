import { getResolvedDurationSeconds } from "@/lib/article-audio-duration";
import type { ArticleNarrationTrack } from "@/lib/section-narration";

/**
 * Section-to-section navigation for the Now playing bar, lock screen, and
 * keyboard shortcuts.
 *
 * Listeners move between content sections: the summary plus every section
 * with narrated text. Spoken heading transitions ("Next section: History.")
 * are not stops of their own. Each one belongs to the content section that
 * follows it, so Play all can still speak it as a lead-in.
 */
type NavigableTrack = Pick<
  ArticleNarrationTrack,
  "sectionKey" | "individuallyPlayable"
>;

export type SectionPosition = {
  /** 1-based position among content sections. */
  current: number;
  total: number;
};

export type SectionNavigation = {
  position: SectionPosition | null;
  /** Track index of the previous content section. */
  previousIndex: number | null;
  /**
   * Track index where Play all resumes when moving back: the previous
   * section's heading lead-in when it has one, otherwise the section itself.
   */
  previousStartIndex: number | null;
  /** Track index of the next content section. */
  nextIndex: number | null;
};

const EMPTY_NAVIGATION: SectionNavigation = {
  position: null,
  previousIndex: null,
  previousStartIndex: null,
  nextIndex: null,
};

/** A heading transition resolves to the content section it introduces. */
const resolveContentIndex = (
  tracks: readonly NavigableTrack[],
  trackIndex: number,
): number | null => {
  for (let index = trackIndex; index < tracks.length; index += 1) {
    if (tracks[index].individuallyPlayable) return index;
  }
  for (let index = trackIndex - 1; index >= 0; index -= 1) {
    if (tracks[index].individuallyPlayable) return index;
  }
  return null;
};

const leadInStartIndex = (
  tracks: readonly NavigableTrack[],
  contentIndex: number,
): number => {
  let start = contentIndex;
  while (start > 0 && !tracks[start - 1].individuallyPlayable) start -= 1;
  return start;
};

export const getSectionNavigation = (
  tracks: readonly NavigableTrack[],
  sectionKey: string | null,
): SectionNavigation => {
  if (!sectionKey) return EMPTY_NAVIGATION;
  const trackIndex = tracks.findIndex(
    (track) => track.sectionKey === sectionKey,
  );
  if (trackIndex < 0) return EMPTY_NAVIGATION;
  const contentIndex = resolveContentIndex(tracks, trackIndex);
  if (contentIndex === null) return EMPTY_NAVIGATION;

  const contentIndices = tracks.flatMap((track, index) =>
    track.individuallyPlayable ? [index] : [],
  );
  const ordinal = contentIndices.indexOf(contentIndex);
  const previousIndex = ordinal > 0 ? contentIndices[ordinal - 1] : null;
  // While a lead-in plays, its own section is still ahead of the listener.
  const nextIndex =
    contentIndex > trackIndex
      ? contentIndex
      : (contentIndices[ordinal + 1] ?? null);

  return {
    position: { current: ordinal + 1, total: contentIndices.length },
    previousIndex,
    previousStartIndex:
      previousIndex === null ? null : leadInStartIndex(tracks, previousIndex),
    nextIndex,
  };
};

/**
 * Listening time left in Play all, in wall-clock seconds at the current
 * speed: the rest of the current track plus every track still queued.
 */
export const getPlayAllSecondsRemaining = ({
  tracks,
  sectionKey,
  currentTime,
  duration,
  durations,
  playbackRate,
}: {
  tracks: readonly Pick<ArticleNarrationTrack, "sectionKey" | "text">[];
  sectionKey: string | null;
  currentTime: number;
  duration: number;
  durations?: Record<string, number>;
  playbackRate: number;
}): number | null => {
  if (!sectionKey) return null;
  const trackIndex = tracks.findIndex(
    (track) => track.sectionKey === sectionKey,
  );
  if (trackIndex < 0) return null;

  const current = tracks[trackIndex];
  const currentDuration =
    Number.isFinite(duration) && duration > 0
      ? duration
      : getResolvedDurationSeconds(current.sectionKey, current.text, durations);
  const elapsed = Number.isFinite(currentTime) ? Math.max(0, currentTime) : 0;
  const upcoming = tracks
    .slice(trackIndex + 1)
    .reduce(
      (total, track) =>
        total +
        getResolvedDurationSeconds(track.sectionKey, track.text, durations),
      0,
    );
  const rate = Number.isFinite(playbackRate) && playbackRate > 0 ? playbackRate : 1;
  return Math.max(0, currentDuration - elapsed + upcoming) / rate;
};

const pluralize = (count: number, unit: string) =>
  `${count} ${unit}${count === 1 ? "" : "s"}`;

/** "about 31 minutes left", "about 1 hour 5 minutes left", or "less than a minute left". */
export const formatTimeLeft = (seconds: number): string => {
  if (!Number.isFinite(seconds) || seconds < 60) {
    return "less than a minute left";
  }
  const totalMinutes = Math.round(seconds / 60);
  const hours = Math.floor(totalMinutes / 60);
  const minutes = totalMinutes % 60;
  const parts: string[] = [];
  if (hours > 0) parts.push(pluralize(hours, "hour"));
  if (minutes > 0 || hours === 0) parts.push(pluralize(minutes, "minute"));
  return `about ${parts.join(" ")} left`;
};
