import type { WikipediaRevisionIdentity } from "@/lib/wikipedia-contracts";

/**
 * Canonicalize MediaWiki's positive decimal identifiers at every boundary.
 * This lives in the client-safe identity module so cache keys do not pull the
 * server-only semantic parser into the browser bundle.
 */
export const normalizeMediaWikiNumericId = (value: unknown): string | null => {
  if (
    typeof value === "number" &&
    (!Number.isSafeInteger(value) || value <= 0)
  ) {
    return null;
  }
  const source = String(value ?? "").trim();
  if (!source || source.length > 64 || !/^\d+$/.test(source)) return null;
  const canonical = source.replace(/^0+/, "");
  return canonical && canonical.length <= 20 ? canonical : null;
};

export const wikipediaRevisionKey = (
  identity: WikipediaRevisionIdentity,
): string =>
  JSON.stringify([
    normalizeMediaWikiNumericId(identity.wikiPageId) ??
      String(identity.wikiPageId).trim(),
    normalizeMediaWikiNumericId(identity.revisionId) ??
      String(identity.revisionId).trim(),
    normalizeWikipediaTitle(identity.title),
    identity.language.trim().toLowerCase(),
  ]);

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
