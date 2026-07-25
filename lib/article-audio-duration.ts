import {
  buildArticleNarrationTracks,
  type ArticleNarrationSource,
} from "@/lib/section-narration";

export const TTS_WORDS_PER_SECOND = 2.5;

export type SectionDurationMap = Record<string, number>;

export const estimateAudioDurationSeconds = (text: string): number => {
  const words = text.split(/\s+/).filter(Boolean).length;
  return Math.max(1, Math.round(words / TTS_WORDS_PER_SECOND));
};

export const getResolvedDurationSeconds = (
  sectionKey: string,
  text: string,
  durations?: SectionDurationMap,
): number => {
  const actual = durations?.[sectionKey];
  if (actual != null && isFinite(actual) && actual > 0) {
    return Math.max(1, Math.ceil(actual));
  }
  return estimateAudioDurationSeconds(text);
};

export const getPlayableSectionDurations = (
  article: ArticleNarrationSource,
  durations?: SectionDurationMap,
): Array<{ sectionKey: string; durationSeconds: number }> => {
  return buildArticleNarrationTracks(article)
    .filter((track) => track.countsTowardProgress)
    .map((track) => ({
      sectionKey: track.sectionKey,
      durationSeconds: getResolvedDurationSeconds(
        track.sectionKey,
        track.text,
        durations,
      ),
    }));
};

export const getPlayableArticleDurationSeconds = (
  article: ArticleNarrationSource,
  durations?: SectionDurationMap,
): number =>
  getPlayableSectionDurations(article, durations).reduce(
    (total, section) => total + section.durationSeconds,
    0,
  );
