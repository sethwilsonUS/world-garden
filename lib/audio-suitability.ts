export const MIN_AUDIO_CONTENT_LENGTH = 20;

export type AudioMode = "full" | "summary_only" | "unavailable";

export type AudioReason =
  | "eligible"
  | "too_short"
  | "list_like"
  | "table_like"
  | "metadata_heavy"
  | "low_prose_density";

export type SectionAudioMetadata = {
  audioMode: AudioMode;
  audioReason: AudioReason;
};

export type AudioSectionLike = {
  title: string;
  content: string;
  audioMode?: AudioMode;
  audioReason?: AudioReason;
};

const METADATA_HEAVY_TITLES = new Set([
  "awards",
  "cast",
  "charts",
  "discography",
  "election results",
  "filmography",
  "medal table",
  "results",
  "statistics",
  "track listing",
]);

const SENTENCE_END_RE = /[.!?]["')\]]?$/;
const SENTENCE_BOUNDARY_RE = /[.!?]+(?=\s|$)/g;
const NUMERIC_FIELD_RE = /\b\d[\d,./:%-]*\b/g;

const normalizeHeading = (title: string): string =>
  title.trim().toLowerCase().replace(/\s+/g, " ");

const countWords = (text: string): number =>
  text.split(/\s+/).filter(Boolean).length;

const getNonEmptyLines = (text: string): string[] =>
  text
    .split("\n")
    .map((line) => line.trim())
    .filter(Boolean);

const stripOuterPunctuation = (token: string): string =>
  token.replace(/^[([{'"`]+|[)\]}"'`,.;:!?]+$/g, "");

const isMetadataHeavyToken = (token: string): boolean => {
  const cleaned = stripOuterPunctuation(token);
  if (!cleaned) return false;

  const letterCount = (cleaned.match(/[A-Za-z]/g) ?? []).length;
  const digitCount = (cleaned.match(/\d/g) ?? []).length;
  const symbolCount = (cleaned.match(/[^A-Za-z0-9]/g) ?? []).length;

  if (digitCount > 0 && letterCount === 0) return true;

  return digitCount + symbolCount > letterCount && (digitCount > 0 || symbolCount >= 2);
};

const isTableLikeLine = (line: string): boolean => {
  const hasColumnSeparators =
    (line.match(/\s{2,}|\t|\|/g) ?? []).length > 0;
  const numericFieldCount = (line.match(NUMERIC_FIELD_RE) ?? []).length;
  return hasColumnSeparators || numericFieldCount >= 3;
};

const isListLike = (text: string): boolean => {
  const lines = getNonEmptyLines(text);
  if (lines.length < 4) return false;

  const listishLineCount = lines.filter((line) => {
    if (isTableLikeLine(line)) return false;
    const wordCount = countWords(line);
    return wordCount <= 8 || !SENTENCE_END_RE.test(line);
  }).length;

  return listishLineCount / lines.length >= 0.7;
};

const isTableLike = (text: string): boolean => {
  const lines = getNonEmptyLines(text);
  if (lines.length < 3) return false;

  const tableLikeLineCount = lines.filter(isTableLikeLine).length;

  return tableLikeLineCount / lines.length >= 0.5;
};

const isMetadataHeavy = (title: string, text: string): boolean => {
  if (METADATA_HEAVY_TITLES.has(normalizeHeading(title))) {
    return true;
  }

  const tokens = text.split(/\s+/).filter(Boolean);
  if (tokens.length === 0) return false;

  const heavyTokenCount = tokens.filter(isMetadataHeavyToken).length;
  return heavyTokenCount / tokens.length >= 0.3;
};

const hasLowProseDensity = (text: string): boolean =>
  (text.match(SENTENCE_BOUNDARY_RE) ?? []).length < 2;

export const classifySectionAudio = ({
  title,
  content,
}: Pick<AudioSectionLike, "title" | "content">): SectionAudioMetadata => {
  if (content.length < MIN_AUDIO_CONTENT_LENGTH) {
    return { audioMode: "unavailable", audioReason: "too_short" };
  }

  if (isListLike(content)) {
    return { audioMode: "unavailable", audioReason: "list_like" };
  }

  if (isTableLike(content)) {
    return { audioMode: "unavailable", audioReason: "table_like" };
  }

  if (isMetadataHeavy(title, content)) {
    return { audioMode: "unavailable", audioReason: "metadata_heavy" };
  }

  if (hasLowProseDensity(content)) {
    return { audioMode: "unavailable", audioReason: "low_prose_density" };
  }

  return { audioMode: "full", audioReason: "eligible" };
};

export const attachAudioSuitability = <T extends Pick<AudioSectionLike, "title" | "content">>(
  section: T,
): T & SectionAudioMetadata => ({
  ...section,
  ...classifySectionAudio(section),
});

export const hasFullAudio = (
  section: Pick<AudioSectionLike, "content" | "audioMode">,
): boolean =>
  section.audioMode ? section.audioMode === "full" : section.content.length >= MIN_AUDIO_CONTENT_LENGTH;

export const getAudioReasonLabel = (
  reason: AudioReason | undefined,
): string => {
  switch (reason) {
    case "too_short":
      return "section is too short to read well aloud";
    case "list_like":
      return "section reads like a list";
    case "table_like":
      return "section reads like a table";
    case "metadata_heavy":
      return "section is mostly metadata or stats";
    case "low_prose_density":
      return "section does not contain enough narrative prose";
    case "eligible":
      return "section is available for audio";
    default:
      return "section is not available for audio";
  }
};

export const getSoftAudioTooltip = (
  reason: AudioReason | undefined,
): string => {
  switch (reason) {
    case "too_short":
      return "This section is a bit too brief to make for a useful listening segment.";
    case "list_like":
      return "This section reads more like a list than a natural audio passage.";
    case "table_like":
      return "This section is mostly table-like content, which usually does not sound great read aloud.";
    case "metadata_heavy":
      return "This section is mostly stats, credits, or other metadata that does not translate well to audio.";
    case "low_prose_density":
      return "This section does not have enough narrative prose to make for smooth listening.";
    case "eligible":
      return "This section is available for audio.";
    default:
      return "This section does not translate especially well to audio.";
  }
};
