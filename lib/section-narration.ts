export const ARTICLE_SECTION_NARRATION_VERSION = 2 as const;
export const MAX_STRUCTURED_NARRATION_WORDS = 800;

export type SectionNarrationMode =
  | "verbatim"
  | "structured"
  | "transition"
  | "none";

export type SectionNarrationSourceFormat =
  | "prose"
  | "table"
  | "list"
  | "mixed"
  | "heading";

export type SectionNarration = {
  mode: SectionNarrationMode;
  text: string;
  sourceFormat: SectionNarrationSourceFormat;
  adapted: boolean;
  usedRawFallback: boolean;
  remainingSourceItems?: number;
  sourceHash: string;
};

export type SectionNarrationSource = {
  wikiSectionIndex: string;
  title: string;
  level: number;
  content: string;
};

export type NarratedSection = SectionNarrationSource & {
  narration: SectionNarration;
};

export type ArticleNarrationTrack = {
  sectionKey: string;
  sectionIdx: number | null;
  title: string;
  text: string;
  sourceHash: string;
  mode: "summary" | SectionNarrationMode;
  individuallyPlayable: boolean;
  countsTowardProgress: boolean;
};

export type ArticleNarrationSource = {
  title: string;
  revisionId?: string;
  narrationVersion?: number;
  summary?: string;
  sections?: Array<{
    wikiSectionIndex?: string;
    title: string;
    level: number;
    content: string;
    narration?: SectionNarration;
  }>;
};

const normalizeSpaces = (value: string): string =>
  value.replace(/\s+/g, " ").trim();

/**
 * A compact deterministic content identity that works in browser, Convex, and
 * Node runtimes without introducing an asynchronous hashing seam.
 */
const fmix32 = (input: number): number => {
  let hash = input >>> 0;
  hash ^= hash >>> 16;
  hash = Math.imul(hash, 0x85ebca6b);
  hash ^= hash >>> 13;
  hash = Math.imul(hash, 0xc2b2ae35);
  hash ^= hash >>> 16;
  return hash >>> 0;
};

export const hashNarrationText = (text: string): string => {
  let first = 0x811c9dc5;
  let second = 0x9e3779b9;
  for (let index = 0; index < text.length; index += 1) {
    const code = text.charCodeAt(index);
    first = Math.imul(first ^ code, 0x01000193);
    second = Math.imul(second ^ code, 0x85ebca6b);
    second ^= second >>> 13;
  }
  return [
    `section-narration:${ARTICLE_SECTION_NARRATION_VERSION}`,
    fmix32(first).toString(16).padStart(8, "0"),
    fmix32(second).toString(16).padStart(8, "0"),
    text.length.toString(16),
  ].join(":");
};

const narrationHash = (
  sourceIdentity: string | undefined,
  section: SectionNarrationSource,
  text: string,
): string =>
  hashNarrationText(
    [
      sourceIdentity ?? "plaintext-fallback",
      section.wikiSectionIndex,
      section.title,
      text,
    ].join("\u0000"),
  );

const createVerbatimNarration = (
  section: SectionNarrationSource,
  sourceIdentity?: string,
): SectionNarration => {
  const text = normalizeSpaces(`${section.title}. ${section.content}`);
  return {
    mode: "verbatim",
    text,
    sourceFormat: "prose",
    adapted: false,
    usedRawFallback: true,
    sourceHash: narrationHash(sourceIdentity, section, text),
  };
};

const createHeadingNarration = (
  section: SectionNarrationSource,
  hasChildSection: boolean,
  sourceIdentity?: string,
): SectionNarration => {
  const text = hasChildSection ? `Next section: ${section.title}.` : "";
  return {
    mode: hasChildSection ? "transition" : "none",
    text,
    sourceFormat: "heading",
    adapted: false,
    usedRawFallback: true,
    sourceHash: narrationHash(sourceIdentity, section, text),
  };
};

/**
 * Plaintext-only degradation path. Structural adaptation belongs exclusively
 * to createSectionNarrationsFromDocument and is never guessed from text.
 */
export const createSectionNarrations = ({
  sections,
  sourceIdentity,
}: {
  sections: SectionNarrationSource[];
  sourceIdentity?: string;
}): NarratedSection[] =>
  sections.map((section, index) => {
    const hasContent = Boolean(section.content.trim());
    const hasChildSection =
      !hasContent &&
      index + 1 < sections.length &&
      sections[index + 1].level > section.level;
    return {
      ...section,
      narration: hasContent
        ? createVerbatimNarration(section, sourceIdentity)
        : createHeadingNarration(section, hasChildSection, sourceIdentity),
    };
  });

const normalizeArticleSections = (
  article: ArticleNarrationSource,
): NarratedSection[] => {
  const sections = article.sections ?? [];
  if (
    sections.every((section) =>
      Boolean(section.wikiSectionIndex && section.narration),
    )
  ) {
    return sections.map((section) => ({
      wikiSectionIndex: section.wikiSectionIndex!,
      title: section.title,
      level: section.level,
      content: section.content,
      narration: section.narration!,
    }));
  }

  const generated = createSectionNarrations({
    sections: sections.map((section, index) => ({
      wikiSectionIndex: section.wikiSectionIndex ?? String(index + 1),
      title: section.title,
      level: section.level,
      content: section.content,
    })),
    sourceIdentity: [
      article.title,
      article.revisionId ?? "unknown-revision",
      article.narrationVersion ?? ARTICLE_SECTION_NARRATION_VERSION,
    ].join(":"),
  });
  return generated.map((section, index) => ({
    ...section,
    ...(sections[index].narration
      ? { narration: sections[index].narration }
      : {}),
  }));
};

export const buildArticleNarrationTracks = (
  article: ArticleNarrationSource,
): ArticleNarrationTrack[] => {
  const tracks: ArticleNarrationTrack[] = [];
  const summary = normalizeSpaces(article.summary ?? "");
  if (summary) {
    tracks.push({
      sectionKey: "summary",
      sectionIdx: null,
      title: `${article.title} — Summary`,
      text: summary,
      sourceHash: hashNarrationText(
        [
          article.revisionId ?? "unknown-revision",
          article.narrationVersion ?? ARTICLE_SECTION_NARRATION_VERSION,
          "summary",
          summary,
        ].join("\u0000"),
      ),
      mode: "summary",
      individuallyPlayable: true,
      countsTowardProgress: true,
    });
  }

  const sections = normalizeArticleSections(article);
  for (let index = 0; index < sections.length; index += 1) {
    const section = sections[index];
    if (
      !section ||
      section.narration.mode === "none" ||
      !section.narration.text
    ) {
      continue;
    }
    tracks.push({
      sectionKey: `section-${index}`,
      sectionIdx: index,
      title: `${section.title} — ${article.title}`,
      text: section.narration.text,
      sourceHash: section.narration.sourceHash,
      mode: section.narration.mode,
      individuallyPlayable:
        section.narration.mode === "verbatim" ||
        section.narration.mode === "structured",
      countsTowardProgress:
        section.narration.mode === "verbatim" ||
        section.narration.mode === "structured",
    });
  }

  return tracks;
};

export const buildArticleNarrationHash = (
  article: ArticleNarrationSource,
): string =>
  hashNarrationText(
    [
      article.revisionId ?? "unknown-revision",
      article.narrationVersion ?? ARTICLE_SECTION_NARRATION_VERSION,
      ...buildArticleNarrationTracks(article).map(
        (track) => `${track.sectionKey}:${track.sourceHash}`,
      ),
    ].join("\n"),
  );
