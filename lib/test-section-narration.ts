import {
  createSectionNarrations,
  hashNarrationText,
  type NarratedSection,
  type SectionNarration,
} from "./section-narration";

type TestSectionInput = {
  wikiSectionIndex?: string;
  title: string;
  level?: number;
  content: string;
  narration?: Partial<SectionNarration>;
};

/** Builds source-faithful section fixtures through the production narration path. */
export const createTestSection = ({
  wikiSectionIndex = "1",
  title,
  level = 2,
  content,
  narration,
}: TestSectionInput): NarratedSection => {
  const [section] = createSectionNarrations({
    sections: [{ wikiSectionIndex, title, level, content }],
  });
  if (!narration) return section;

  const text = narration.text ?? section.narration.text;
  return {
    ...section,
    narration: {
      ...section.narration,
      ...narration,
      text,
      sourceHash: narration.sourceHash ?? hashNarrationText(text),
    },
  };
};
