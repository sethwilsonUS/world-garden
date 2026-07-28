export type HeardRange = {
  startSecond: number;
  endSecond: number;
};

export const CONTINUOUS_PLAYBACK_TOLERANCE_SECONDS = 0.75;

export const mergeHeardRanges = (ranges: HeardRange[]): HeardRange[] => {
  if (ranges.length === 0) return [];

  const sorted = [...ranges].sort(
    (left, right) =>
      left.startSecond - right.startSecond || left.endSecond - right.endSecond,
  );

  const merged: HeardRange[] = [];

  for (const range of sorted) {
    const previous = merged[merged.length - 1];
    if (!previous || range.startSecond > previous.endSecond) {
      merged.push({ ...range });
      continue;
    }

    previous.endSecond = Math.max(previous.endSecond, range.endSecond);
  }

  return merged;
};

export const normalizeHeardRanges = (
  ranges: HeardRange[],
  durationSeconds: number,
): HeardRange[] => {
  const max = Math.max(1, Math.ceil(durationSeconds));

  return mergeHeardRanges(
    ranges
      .map((range) => ({
        startSecond: Math.max(0, Math.min(max, Math.floor(range.startSecond))),
        endSecond: Math.max(0, Math.min(max, Math.ceil(range.endSecond))),
      }))
      .filter((range) => range.endSecond > range.startSecond),
  );
};

export const sumHeardRangeSeconds = (ranges: HeardRange[]): number =>
  ranges.reduce(
    (total, range) => total + (range.endSecond - range.startSecond),
    0,
  );

export const calculateNewlyHeardSeconds = ({
  existingRanges,
  incomingRanges,
  durationSeconds,
}: {
  existingRanges: HeardRange[];
  incomingRanges: HeardRange[];
  durationSeconds: number;
}): number => {
  const normalizedExisting = normalizeHeardRanges(
    existingRanges,
    durationSeconds,
  );
  const merged = normalizeHeardRanges(
    [...normalizedExisting, ...incomingRanges],
    durationSeconds,
  );

  return Math.max(
    0,
    sumHeardRangeSeconds(merged) - sumHeardRangeSeconds(normalizedExisting),
  );
};

export type MeaningfulUseQualification =
  | "sixty_unique_heard_seconds"
  | "eighty_percent_of_item";

export type MeaningfulUseSection = {
  durationSeconds: number;
  heardRanges: HeardRange[];
  countsTowardProgress: boolean;
};

export const getMeaningfulUseQualification = (
  sections: MeaningfulUseSection[],
): MeaningfulUseQualification | null => {
  const progressSections = sections
    .filter((section) => section.countsTowardProgress)
    .map((section) => ({
      ...section,
      heardSeconds: sumHeardRangeSeconds(
        normalizeHeardRanges(section.heardRanges, section.durationSeconds),
      ),
    }));
  const heardSeconds = progressSections.reduce(
    (total, section) => total + section.heardSeconds,
    0,
  );

  if (heardSeconds >= 60) return "sixty_unique_heard_seconds";
  if (
    progressSections.some(
      (section) =>
        section.durationSeconds >= 15 &&
        section.heardSeconds / section.durationSeconds >= 0.8,
    )
  ) {
    return "eighty_percent_of_item";
  }

  return null;
};

export const detectContinuousPlaybackWindow = (args: {
  previousTime: number | null;
  currentTime: number;
  elapsedMs: number;
  playbackRate: number;
  toleranceSeconds?: number;
}): HeardRange | null => {
  const toleranceSeconds =
    args.toleranceSeconds ?? CONTINUOUS_PLAYBACK_TOLERANCE_SECONDS;

  if (args.previousTime == null || args.elapsedMs <= 0) {
    return null;
  }

  const progressedSeconds = args.currentTime - args.previousTime;
  if (progressedSeconds <= 0) {
    return null;
  }

  const expectedMaxProgressSeconds =
    (args.elapsedMs / 1000) * args.playbackRate + toleranceSeconds;
  if (progressedSeconds > expectedMaxProgressSeconds) {
    return null;
  }

  return {
    startSecond: args.previousTime,
    endSecond: args.currentTime,
  };
};
