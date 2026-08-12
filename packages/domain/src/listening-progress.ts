import { normalizeMediaWikiNumericId } from "./wikipedia";

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

  if (
    args.previousTime == null ||
    args.elapsedMs <= 0 ||
    !Number.isFinite(args.playbackRate) ||
    args.playbackRate <= 0
  ) {
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

export type ResumeCursorMode = "all" | "single";
export type ResumeCursorSectionKey = "summary" | `section-${number}`;

export const RESUME_CURSOR_LIMITS = Object.freeze({
  maxNarrationVersion: 2_147_483_647,
  maxSectionIndex: 99_999,
  maxDurationSeconds: 7 * 24 * 60 * 60,
});

export type ResumeCursor = Readonly<{
  wikiPageId: string;
  revisionId: string;
  narrationVersion: number;
  mode: ResumeCursorMode;
  sectionKey: ResumeCursorSectionKey;
  positionSeconds: number;
  durationSeconds: number;
}>;

export type ResumeCursorTarget = Readonly<
  Pick<ResumeCursor, "wikiPageId" | "revisionId" | "narrationVersion">
>;

const RESUME_CURSOR_CLIENT_FIELDS: ReadonlySet<PropertyKey> = new Set([
  "wikiPageId",
  "revisionId",
  "narrationVersion",
  "mode",
  "sectionKey",
  "positionSeconds",
  "durationSeconds",
]);

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null && !Array.isArray(value);

const isIntegerInRange = (
  value: unknown,
  minimum: number,
  maximum: number,
): value is number =>
  typeof value === "number" &&
  Number.isInteger(value) &&
  value >= minimum &&
  value <= maximum;

const normalizeSectionKey = (value: unknown): ResumeCursorSectionKey | null => {
  if (value === "summary") return value;
  if (
    typeof value !== "string" ||
    value.length >
      "section-".length + String(RESUME_CURSOR_LIMITS.maxSectionIndex).length ||
    !/^section-(?:0|[1-9]\d*)$/u.test(value) ||
    Number.parseInt(value.slice("section-".length), 10) >
      RESUME_CURSOR_LIMITS.maxSectionIndex
  ) {
    return null;
  }
  return value as ResumeCursorSectionKey;
};

export const normalizeResumeCursor = (value: unknown): ResumeCursor | null => {
  if (!isRecord(value)) return null;
  const fields = Reflect.ownKeys(value);
  if (
    fields.length !== RESUME_CURSOR_CLIENT_FIELDS.size ||
    fields.some((field) => !RESUME_CURSOR_CLIENT_FIELDS.has(field))
  ) {
    return null;
  }

  const wikiPageId =
    typeof value.wikiPageId === "string"
      ? normalizeMediaWikiNumericId(value.wikiPageId)
      : null;
  const revisionId =
    typeof value.revisionId === "string"
      ? normalizeMediaWikiNumericId(value.revisionId)
      : null;
  const sectionKey = normalizeSectionKey(value.sectionKey);

  if (
    !wikiPageId ||
    !revisionId ||
    !isIntegerInRange(
      value.narrationVersion,
      1,
      RESUME_CURSOR_LIMITS.maxNarrationVersion,
    ) ||
    (value.mode !== "all" && value.mode !== "single") ||
    !sectionKey ||
    !isIntegerInRange(
      value.positionSeconds,
      0,
      RESUME_CURSOR_LIMITS.maxDurationSeconds - 1,
    ) ||
    !isIntegerInRange(
      value.durationSeconds,
      1,
      RESUME_CURSOR_LIMITS.maxDurationSeconds,
    ) ||
    value.positionSeconds >= value.durationSeconds
  ) {
    return null;
  }

  return Object.freeze({
    wikiPageId,
    revisionId,
    narrationVersion: value.narrationVersion,
    mode: value.mode,
    sectionKey,
    positionSeconds: value.positionSeconds === 0 ? 0 : value.positionSeconds,
    durationSeconds: value.durationSeconds,
  });
};

export const resumeCursorMatchesTarget = (
  cursor: ResumeCursor,
  target: ResumeCursorTarget,
): boolean =>
  cursor.wikiPageId === target.wikiPageId &&
  cursor.revisionId === target.revisionId &&
  cursor.narrationVersion === target.narrationVersion;
