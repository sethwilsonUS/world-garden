export type ArticleSummaryDisclosure = Readonly<{
  lead: string;
  remainder: string | null;
}>;

const CLOSING_PUNCTUATION =
  /["'\u2019\u201d)\]}\uff09\u3011\u3009\u300b\u300d\u300f]/u;
const OPENING_PUNCTUATION =
  /["'\u2018\u201c([{\uff08\u3010\u3008\u300a\u300c\u300e]/u;
const NON_TERMINAL_ABBREVIATIONS = new Set([
  "dr.",
  "mr.",
  "mrs.",
  "ms.",
  "prof.",
  "e.g.",
  "i.e.",
]);
const CONTEXTUAL_ABBREVIATIONS = new Set([
  "jr.",
  "ph.d.",
  "sr.",
  "st.",
  "u.s.",
]);
const UNAMBIGUOUS_SENTENCE_STARTERS = new Set([
  "a",
  "an",
  "he",
  "her",
  "here",
  "his",
  "however",
  "i",
  "it",
  "its",
  "later",
  "meanwhile",
  "my",
  "next",
  "our",
  "she",
  "that",
  "the",
  "their",
  "there",
  "these",
  "they",
  "this",
  "those",
  "we",
  "you",
  "your",
]);
const STRONG_SENTENCE_TERMINATORS = new Set([
  "!",
  "?",
  "\u2026",
  "\u061f",
  "\u06d4",
  "\u3002",
  "\uff01",
  "\uff1f",
]);
const CONTINUATION_PUNCTUATION = new Set([",", ";", ":", "\u2013", "\u2014"]);
const LOWERCASE_CONTINUATION_WORDS = new Set([
  "are",
  "became",
  "began",
  "continues",
  "continued",
  "denotes",
  "follows",
  "had",
  "has",
  "have",
  "he",
  "includes",
  "is",
  "it",
  "means",
  "refers",
  "serves",
  "she",
  "the",
  "then",
  "they",
  "was",
  "were",
]);
const NUMERIC_CONTINUATION_ABBREVIATIONS = new Set([
  "c.",
  "ca.",
  "fig.",
  "figs.",
  "no.",
  "p.",
  "pp.",
  "vol.",
  "vols.",
]);

const periodTokenAt = (source: string, periodIndex: number): string => {
  let tokenStart = periodIndex;
  while (tokenStart > 0 && /[A-Za-z.]/u.test(source[tokenStart - 1] ?? "")) {
    tokenStart -= 1;
  }
  return source.slice(tokenStart, periodIndex + 1).toLowerCase();
};

const contentIndexAfter = (source: string, index: number): number => {
  let cursor = index;
  while (
    cursor < source.length &&
    (CLOSING_PUNCTUATION.test(source[cursor] ?? "") ||
      /\s/u.test(source[cursor] ?? "") ||
      OPENING_PUNCTUATION.test(source[cursor] ?? ""))
  ) {
    cursor += 1;
  }
  return cursor;
};

const firstContentAfter = (source: string, index: number): string | null => {
  const cursor = contentIndexAfter(source, index);
  const codePoint = source.codePointAt(cursor);
  return codePoint === undefined ? null : String.fromCodePoint(codePoint);
};

const wordAfter = (source: string, index: number): string | null => {
  const cursor = contentIndexAfter(source, index);
  return (
    source
      .slice(cursor)
      .match(/^[A-Za-z]+/u)?.[0]
      ?.toLowerCase() ?? null
  );
};

const wordBefore = (source: string, index: number): string | null =>
  source.slice(0, index).match(/([A-Za-z][A-Za-z'\u2019-]*)\s*$/u)?.[1] ?? null;

const isReviewedLowercaseContinuation = (
  source: string,
  index: number,
): boolean => {
  const nextContent = firstContentAfter(source, index);
  if (nextContent === null || !isLowercaseLetter(nextContent)) return false;
  const nextWord = wordAfter(source, index);
  return nextWord !== null && LOWERCASE_CONTINUATION_WORDS.has(nextWord);
};

const isUppercaseLetter = (character: string): boolean =>
  character.toUpperCase() === character &&
  character.toLowerCase() !== character;

const isLowercaseLetter = (character: string): boolean =>
  character.toLowerCase() === character &&
  character.toUpperCase() !== character;

const isPersonalInitialPeriod = (
  source: string,
  periodIndex: number,
): boolean => {
  const initial = source[periodIndex - 1] ?? "";
  const beforeInitial = source[periodIndex - 2] ?? "";
  if (
    !/[A-Z]/u.test(initial) ||
    beforeInitial === "." ||
    /[A-Za-z]/u.test(beforeInitial)
  ) {
    return false;
  }

  let nextIndex = periodIndex + 1;
  while (/\s/u.test(source[nextIndex] ?? "")) nextIndex += 1;
  if (!/[A-Z]/u.test(source[nextIndex] ?? "")) return false;

  const nextWord = wordAfter(source, periodIndex + 1);
  if (nextWord && UNAMBIGUOUS_SENTENCE_STARTERS.has(nextWord)) return false;

  const hasFollowingInitial = source[nextIndex + 1] === ".";
  const precedingText = source.slice(0, periodIndex - 1).trimEnd();
  const hasPrecedingInitial = /(?:^|\s)[A-Z]\.$/u.test(precedingText);
  const previousWord = wordBefore(source, periodIndex - 1);
  const hasCapitalizedNameBefore =
    previousWord !== null && /^[A-Z][A-Za-z'\u2019-]+$/u.test(previousWord);
  return (
    periodIndex === 1 ||
    hasFollowingInitial ||
    hasPrecedingInitial ||
    hasCapitalizedNameBefore
  );
};

const isSentencePeriod = (source: string, periodIndex: number): boolean => {
  if (
    /[0-9]/u.test(source[periodIndex - 1] ?? "") &&
    /[0-9]/u.test(source[periodIndex + 1] ?? "")
  ) {
    return false;
  }
  if (isPersonalInitialPeriod(source, periodIndex)) return false;
  if (/[A-Za-z]/u.test(source[periodIndex + 1] ?? "")) return false;
  const token = periodTokenAt(source, periodIndex);
  const nextContent = firstContentAfter(source, periodIndex + 1);
  if (
    NUMERIC_CONTINUATION_ABBREVIATIONS.has(token) &&
    nextContent !== null &&
    /[0-9]/u.test(nextContent)
  ) {
    return false;
  }
  if (CONTEXTUAL_ABBREVIATIONS.has(token) || /^(?:[a-z]\.){2,}$/u.test(token)) {
    if (nextContent === null) return true;
    const nextWord = wordAfter(source, periodIndex + 1);
    if (!isUppercaseLetter(nextContent) || nextWord === null) return false;
    if (UNAMBIGUOUS_SENTENCE_STARTERS.has(nextWord)) return true;
    // Proper names are indistinguishable here from modified institutional names
    // such as “U.S. Department”; keep the ambiguous text attached rather than
    // returning a sentence fragment.
    return false;
  }
  if (NON_TERMINAL_ABBREVIATIONS.has(token)) return false;
  return !isReviewedLowercaseContinuation(source, periodIndex + 1);
};

const findSentenceBoundary = (source: string): number => {
  for (let index = 0; index < source.length; index += 1) {
    const character = source[index];
    if (character !== undefined && STRONG_SENTENCE_TERMINATORS.has(character)) {
      const nextContent = firstContentAfter(source, index + 1);
      const hasImmediateContinuation =
        nextContent !== null &&
        index + 1 < source.length &&
        !/\s/u.test(source[index + 1] ?? "") &&
        !CLOSING_PUNCTUATION.test(source[index + 1] ?? "");
      if (
        (character === "?" || character === "!" || character === "\u2026") &&
        nextContent !== null &&
        (isReviewedLowercaseContinuation(source, index + 1) ||
          CONTINUATION_PUNCTUATION.has(nextContent) ||
          (character === "\u2026" && hasImmediateContinuation))
      ) {
        continue;
      }
      return index;
    }
    if (character === "." && source[index + 1] === ".") {
      let runEnd = index + 1;
      while (source[runEnd] === ".") runEnd += 1;
      const nextContent = firstContentAfter(source, runEnd);
      const hasImmediateContinuation =
        nextContent !== null &&
        runEnd < source.length &&
        !/\s/u.test(source[runEnd] ?? "") &&
        !CLOSING_PUNCTUATION.test(source[runEnd] ?? "");
      if (
        nextContent !== null &&
        (isReviewedLowercaseContinuation(source, runEnd) ||
          CONTINUATION_PUNCTUATION.has(nextContent) ||
          hasImmediateContinuation)
      ) {
        index = runEnd - 1;
        continue;
      }
      return index;
    }
    if (character === "." && isSentencePeriod(source, index)) return index;
  }
  return -1;
};

/**
 * Split an article summary after its first meaningful sentence without
 * rewriting either returned slice. Outer and separating whitespace is omitted.
 */
export function splitArticleSummary(summary: string): ArticleSummaryDisclosure {
  const source = summary.trim();
  const boundary = findSentenceBoundary(source);

  if (boundary === -1) {
    return { lead: source, remainder: null };
  }

  let leadEnd = boundary + 1;
  while (
    leadEnd < source.length &&
    (CLOSING_PUNCTUATION.test(source[leadEnd] ?? "") ||
      source[leadEnd] === "." ||
      STRONG_SENTENCE_TERMINATORS.has(source[leadEnd] ?? ""))
  ) {
    leadEnd += 1;
  }

  const lead = source.slice(0, leadEnd);
  const remainder = source.slice(leadEnd).trim();
  return { lead, remainder: remainder.length > 0 ? remainder : null };
}
