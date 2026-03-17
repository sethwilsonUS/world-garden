export type HeardRange = {
  startSecond: number;
  endSecond: number;
};

export const CONTINUOUS_PLAYBACK_TOLERANCE_SECONDS = 0.75;

export const mergeHeardRanges = (ranges: HeardRange[]): HeardRange[] => {
  if (ranges.length === 0) return [];

  const sorted = [...ranges].sort(
    (left, right) =>
      left.startSecond - right.startSecond ||
      left.endSecond - right.endSecond,
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
  ranges.reduce((total, range) => total + (range.endSecond - range.startSecond), 0);

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
