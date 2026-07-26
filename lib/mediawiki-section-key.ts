export type MediaWikiSpecialSectionIndex = "-1" | "-2";

export type MediaWikiSpecialSectionKey = Readonly<{
  sourceIndex: MediaWikiSpecialSectionIndex;
  occurrence: number;
  fragment: number;
}>;

const SPECIAL_SECTION_KEY_PREFIX = "mw-special";
const MAX_SPECIAL_SECTION_ORDINAL = 500_000;

const normalizeOrdinal = (value: unknown): number | null => {
  const source = String(value ?? "").trim();
  if (!source || source.length > 6) return null;
  if ([...source].some((character) => character < "0" || character > "9")) {
    return null;
  }
  const parsed = Number(source);
  return Number.isSafeInteger(parsed) &&
    parsed >= 1 &&
    parsed <= MAX_SPECIAL_SECTION_ORDINAL
    ? parsed
    : null;
};

export const createMediaWikiSpecialSectionKey = (
  sourceIndex: MediaWikiSpecialSectionIndex,
  occurrence: number,
  fragment = 1,
): string => {
  const normalizedOccurrence = normalizeOrdinal(occurrence);
  const normalizedFragment = normalizeOrdinal(fragment);
  if (normalizedOccurrence == null || normalizedFragment == null) {
    throw new Error("MediaWiki special-section ordinals are out of range.");
  }
  return `${SPECIAL_SECTION_KEY_PREFIX}:${sourceIndex}:${normalizedOccurrence}:${normalizedFragment}`;
};

export const parseMediaWikiSpecialSectionKey = (
  value: unknown,
): MediaWikiSpecialSectionKey | null => {
  if (typeof value !== "string" || value.length > 40) return null;
  const parts = value.trim().split(":");
  if (
    parts.length !== 4 ||
    parts[0] !== SPECIAL_SECTION_KEY_PREFIX ||
    (parts[1] !== "-1" && parts[1] !== "-2")
  ) {
    return null;
  }
  const occurrence = normalizeOrdinal(parts[2]);
  const fragment = normalizeOrdinal(parts[3]);
  return occurrence != null && fragment != null
    ? { sourceIndex: parts[1], occurrence, fragment }
    : null;
};

export const normalizeMediaWikiSpecialSectionKey = (
  value: unknown,
): string | null => {
  const parsed = parseMediaWikiSpecialSectionKey(value);
  return parsed
    ? createMediaWikiSpecialSectionKey(
        parsed.sourceIndex,
        parsed.occurrence,
        parsed.fragment,
      )
    : null;
};
