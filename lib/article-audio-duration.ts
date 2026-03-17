import { hasFullAudio } from "@/lib/audio-suitability";

export const TTS_WORDS_PER_SECOND = 2.5;

export type SectionDurationMap = Record<string, number>;

export type PlayableSectionLike = {
  content: string;
  audioMode?: "full" | "summary_only" | "unavailable";
  audioReason?: string;
};

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
  summaryText: string | undefined,
  sections: PlayableSectionLike[],
  durations?: SectionDurationMap,
): Array<{ sectionKey: string; durationSeconds: number }> => {
  const playable = [
    {
      sectionKey: "summary",
      durationSeconds: getResolvedDurationSeconds(
        "summary",
        summaryText ?? "",
        durations,
      ),
    },
  ];

  sections.forEach((section, index) => {
    if (!hasFullAudio(section)) return;
    playable.push({
      sectionKey: `section-${index}`,
      durationSeconds: getResolvedDurationSeconds(
        `section-${index}`,
        section.content,
        durations,
      ),
    });
  });

  return playable;
};

export const getPlayableArticleDurationSeconds = (
  summaryText: string | undefined,
  sections: PlayableSectionLike[],
  durations?: SectionDurationMap,
): number =>
  getPlayableSectionDurations(summaryText, sections, durations).reduce(
    (total, section) => total + section.durationSeconds,
    0,
  );
