import type { WikipediaRevisionIdentity } from "@/lib/wikipedia-contracts";

export const wikipediaRevisionKey = (
  identity: Pick<WikipediaRevisionIdentity, "wikiPageId" | "revisionId">,
): string => `${identity.wikiPageId}:${identity.revisionId}`;

export const slugToWikipediaTitle = (slug: string): string =>
  slug.replaceAll("_", " ");

export const normalizeWikipediaTitle = (title: string): string =>
  title.replaceAll("_", " ").replace(/\s+/g, " ").trim().toLowerCase();

export const normalizeWikipediaSectionTitle = (title: string): string =>
  title.replace(/\s+/g, " ").trim().toLowerCase();

/**
 * Resolve one section-scoped projection without conflating repeated headings.
 * Title matching exists only for callers or cache rows created before section
 * indices were carried alongside metadata.
 */
export const findWikipediaSectionMetadata = <
  Section extends { index?: string; title: string },
>(
  sections: readonly Section[],
  identity: { sectionIndex?: string; sectionTitle: string | null },
): Section | undefined => {
  if (identity.sectionIndex) {
    const indexed = sections.find(
      (section) => section.index === identity.sectionIndex,
    );
    if (indexed) return indexed;

    // A current projection containing section indices must never silently
    // substitute the first same-named section for a missing index.
    if (sections.some((section) => section.index !== undefined)) {
      return undefined;
    }
  }

  const target = normalizeWikipediaSectionTitle(
    identity.sectionTitle ?? "__summary__",
  );
  return sections.find(
    (section) => normalizeWikipediaSectionTitle(section.title) === target,
  );
};
