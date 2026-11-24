import { NextResponse } from "next/server";
import {
  enrichParsedPageDataFromDocument,
  fetchArticleBadgeKeys,
  fetchArticleWithDocumentByTitle,
  fetchParsedPageData,
  fetchRelatedArticles,
  fetchSectionLinkDescriptions,
  fetchSectionLinksByIndex,
  MAX_SECTION_LINK_SOURCE_TITLES,
  searchWikipediaWithMeta,
  suggestWikipediaTitles,
  type SectionLinkTitles,
} from "@/convex/lib/wikipedia";
import { extractSectionLinkTitlesFromDocument } from "@/lib/mediawiki-document-metadata";
import type {
  LocalWikipediaRequest,
  WikipediaArticle,
  WikipediaLinkedArticle,
  WikipediaParsedPageData,
  WikipediaRelatedArticle,
  WikipediaRevisionIdentity,
  WikipediaSearchSuggestion,
} from "@/lib/wikipedia-contracts";
import {
  normalizeMediaWikiNumericId,
  type MediaWikiDocument,
} from "@/lib/mediawiki-document/types";
import {
  normalizeWikipediaSectionTitle,
  slugToWikipediaTitle,
  wikipediaRevisionKey,
} from "@/lib/wikipedia-utils";

const NO_CACHE_HEADERS = { "Cache-Control": "no-store" } as const;
const MAX_PARSED_CACHE_ENTRIES = 32;
const MAX_SECTION_LINK_CACHE_ENTRIES = 128;
const MAX_RELATED_ARTICLES_CACHE_ENTRIES = 128;
const MAX_SEARCH_SUGGESTIONS_CACHE_ENTRIES = 128;
const parsedCache = new Map<string, Promise<WikipediaParsedPageData>>();
const sectionLinkTitlesCache = new Map<string, SectionLinkTitles[]>();
const sectionLinksCache = new Map<string, Promise<WikipediaLinkedArticle[]>>();
const relatedArticlesCache = new Map<
  string,
  Promise<WikipediaRelatedArticle[]>
>();
const searchSuggestionsCache = new Map<
  string,
  Promise<WikipediaSearchSuggestion[]>
>();

export const dynamic = "force-dynamic";
export const revalidate = 0;

const isRecord = (value: unknown): value is Record<string, unknown> =>
  Boolean(value) && typeof value === "object" && !Array.isArray(value);

const localModeEnabled = (): boolean =>
  process.env.NEXT_PUBLIC_LOCAL_MODE === "true" ||
  process.env.LOCAL_MODE === "true";

const normalizeIdentity = (
  value: unknown,
): WikipediaRevisionIdentity | null => {
  if (!isRecord(value)) return null;
  const wikiPageId = normalizeMediaWikiNumericId(value.wikiPageId);
  const revisionId = normalizeMediaWikiNumericId(value.revisionId);
  const title =
    typeof value.title === "string"
      ? value.title.replaceAll("_", " ").replace(/\s+/g, " ").trim()
      : "";
  const language =
    typeof value.language === "string"
      ? value.language.trim().toLowerCase()
      : "";
  if (
    !wikiPageId ||
    !revisionId ||
    !title ||
    title.length > 300 ||
    language !== "en"
  ) {
    return null;
  }
  return { wikiPageId, revisionId, title, language };
};

const parseRequest = (value: unknown): LocalWikipediaRequest | null => {
  if (!isRecord(value) || typeof value.operation !== "string") return null;
  if (value.operation === "search") {
    const term = typeof value.term === "string" ? value.term.trim() : "";
    return term && term.length <= 300 ? { operation: "search", term } : null;
  }
  if (value.operation === "suggest") {
    const term = typeof value.term === "string" ? value.term.trim() : "";
    return term && term.length <= 300 ? { operation: "suggest", term } : null;
  }
  if (value.operation === "article") {
    const slug = typeof value.slug === "string" ? value.slug.trim() : "";
    return slug && slug.length <= 500 ? { operation: "article", slug } : null;
  }
  const identity = normalizeIdentity(value.identity);
  if (!identity) return null;
  if (value.operation === "metadata") {
    return { operation: "metadata", identity };
  }
  if (value.operation === "related") {
    return { operation: "related", identity };
  }
  if (
    value.operation === "section-links" &&
    (value.sectionTitle === null || typeof value.sectionTitle === "string")
  ) {
    const sectionTitle = value.sectionTitle;
    const sectionIndex =
      typeof value.sectionIndex === "string"
        ? value.sectionIndex.trim()
        : undefined;
    if (typeof sectionTitle === "string" && sectionTitle.length > 500) {
      return null;
    }
    if (
      value.sectionIndex !== undefined &&
      (!sectionIndex || sectionIndex.length > 40)
    ) {
      return null;
    }
    return {
      operation: "section-links",
      identity,
      sectionTitle,
      sectionIndex,
    };
  }
  return null;
};

const storeParsedPagePromise = (
  key: string,
  loader: () => Promise<WikipediaParsedPageData>,
): Promise<WikipediaParsedPageData> => {
  const pending = loader().catch((error) => {
    if (parsedCache.get(key) === pending) {
      parsedCache.delete(key);
      sectionLinkTitlesCache.delete(key);
    }
    throw error;
  });
  parsedCache.set(key, pending);
  if (parsedCache.size > MAX_PARSED_CACHE_ENTRIES) {
    const oldestKey = parsedCache.keys().next().value as string | undefined;
    if (oldestKey && oldestKey !== key) {
      parsedCache.delete(oldestKey);
      sectionLinkTitlesCache.delete(oldestKey);
    }
  }
  return pending;
};

const getParsedPage = (
  identity: WikipediaRevisionIdentity,
): Promise<WikipediaParsedPageData> => {
  const key = wikipediaRevisionKey(identity);
  const cached = parsedCache.get(key);
  if (cached) return cached;

  return storeParsedPagePromise(key, () => fetchParsedPageData(identity));
};

const seedParsedPageFromDocument = async (
  source: Pick<
    WikipediaArticle,
    "wikiPageId" | "revisionId" | "title" | "language"
  >,
  parsedDocument: MediaWikiDocument | undefined,
): Promise<void> => {
  if (
    !parsedDocument ||
    parsedDocument.sourceFormat === "plaintext" ||
    parsedDocument.fallbackReason
  ) {
    return;
  }

  const identity = normalizeIdentity(source);
  const documentIdentity = normalizeIdentity(parsedDocument.identity);
  if (
    !identity ||
    !documentIdentity ||
    wikipediaRevisionKey(identity) !== wikipediaRevisionKey(documentIdentity)
  ) {
    return;
  }

  const key = wikipediaRevisionKey(identity);
  if (!sectionLinkTitlesCache.has(key)) {
    sectionLinkTitlesCache.set(
      key,
      extractSectionLinkTitlesFromDocument(
        parsedDocument,
        MAX_SECTION_LINK_SOURCE_TITLES,
      ),
    );
  }
  if (parsedCache.has(key)) return;

  const pending = storeParsedPagePromise(key, () =>
    enrichParsedPageDataFromDocument(parsedDocument),
  );
  try {
    await pending;
  } catch (error: unknown) {
    console.warn(
      "[/api/local-wikipedia] Failed to seed parsed page cache from article document",
      error instanceof Error ? error.message : String(error),
    );
  }
};

const findSectionIndex = (
  parsed: WikipediaParsedPageData,
  sectionTitle: string | null,
): string | null => {
  if (sectionTitle === null) return "0";
  const target = normalizeWikipediaSectionTitle(sectionTitle);
  return (
    parsed.sectionIndexMap.find(
      (section) => normalizeWikipediaSectionTitle(section.title) === target,
    )?.index ?? null
  );
};

const getSectionLinks = (
  identity: WikipediaRevisionIdentity,
  sectionIndex: string,
): Promise<WikipediaLinkedArticle[]> => {
  const revisionKey = wikipediaRevisionKey(identity);
  const key = JSON.stringify([revisionKey, sectionIndex]);
  const cached = sectionLinksCache.get(key);
  if (cached) return cached;

  const seededTitles = sectionLinkTitlesCache.get(revisionKey);
  const loader = seededTitles
    ? () => {
        const targetKey = sectionIndex === "0" ? "__summary__" : sectionIndex;
        const entry = seededTitles.find((item) => item.index === targetKey);
        return fetchSectionLinkDescriptions(entry?.titles ?? []);
      }
    : () => fetchSectionLinksByIndex(identity, sectionIndex);

  const pending = loader().catch((error) => {
    if (sectionLinksCache.get(key) === pending) sectionLinksCache.delete(key);
    throw error;
  });
  sectionLinksCache.set(key, pending);
  if (sectionLinksCache.size > MAX_SECTION_LINK_CACHE_ENTRIES) {
    const oldestKey = sectionLinksCache.keys().next().value as
      | string
      | undefined;
    if (oldestKey && oldestKey !== key) sectionLinksCache.delete(oldestKey);
  }
  return pending;
};

const getRelatedArticles = (
  identity: WikipediaRevisionIdentity,
): Promise<WikipediaRelatedArticle[]> => {
  const key = JSON.stringify([
    identity.language,
    identity.wikiPageId,
    identity.title,
  ]);
  const cached = relatedArticlesCache.get(key);
  if (cached) return cached;

  const pending = fetchRelatedArticles(identity).catch((error: unknown) => {
    if (relatedArticlesCache.get(key) === pending) {
      relatedArticlesCache.delete(key);
    }
    throw error;
  });
  relatedArticlesCache.set(key, pending);
  if (relatedArticlesCache.size > MAX_RELATED_ARTICLES_CACHE_ENTRIES) {
    const oldestKey = relatedArticlesCache.keys().next().value as
      | string
      | undefined;
    if (oldestKey && oldestKey !== key) {
      relatedArticlesCache.delete(oldestKey);
    }
  }
  return pending;
};

const getSearchSuggestions = (
  term: string,
): Promise<WikipediaSearchSuggestion[]> => {
  const normalizedTerm = term.replace(/\s+/gu, " ").trim();
  const key = normalizedTerm.toLocaleLowerCase("en-US");
  const cached = searchSuggestionsCache.get(key);
  if (cached) return cached;

  const pending = suggestWikipediaTitles(normalizedTerm).catch(
    (error: unknown) => {
      if (searchSuggestionsCache.get(key) === pending) {
        searchSuggestionsCache.delete(key);
      }
      throw error;
    },
  );
  searchSuggestionsCache.set(key, pending);
  if (searchSuggestionsCache.size > MAX_SEARCH_SUGGESTIONS_CACHE_ENTRIES) {
    const oldestKey = searchSuggestionsCache.keys().next().value as
      | string
      | undefined;
    if (oldestKey && oldestKey !== key) {
      searchSuggestionsCache.delete(oldestKey);
    }
  }
  return pending;
};

export const POST = async (request: Request) => {
  if (!localModeEnabled()) {
    return NextResponse.json(
      { error: "Not found" },
      { status: 404, headers: NO_CACHE_HEADERS },
    );
  }

  let input: LocalWikipediaRequest | null = null;
  try {
    input = parseRequest(await request.json());
  } catch {
    // The common invalid-input response below deliberately hides parse detail.
  }
  if (!input) {
    return NextResponse.json(
      { error: "Invalid local Wikipedia request" },
      { status: 400, headers: NO_CACHE_HEADERS },
    );
  }

  try {
    if (input.operation === "search") {
      return NextResponse.json(
        { data: await searchWikipediaWithMeta(input.term) },
        { status: 200, headers: NO_CACHE_HEADERS },
      );
    }

    if (input.operation === "suggest") {
      return NextResponse.json(
        { data: await getSearchSuggestions(input.term) },
        { status: 200, headers: NO_CACHE_HEADERS },
      );
    }

    if (input.operation === "article") {
      const {
        article: source,
        parsedDocument,
        cirrusTopicPredictions,
      } = await fetchArticleWithDocumentByTitle(
        slugToWikipediaTitle(input.slug),
      );
      const [badgeKeys] = await Promise.all([
        fetchArticleBadgeKeys(source.wikiPageId, {
          title: source.title,
          language: source.language,
          cirrusTopicPredictions,
        }).catch((error: unknown) => {
          console.warn(
            "[/api/local-wikipedia] Failed to fetch badge keys",
            error instanceof Error ? error.message : String(error),
          );
          return undefined;
        }),
        seedParsedPageFromDocument(source, parsedDocument),
      ]);
      const article: WikipediaArticle = {
        wikiPageId: source.wikiPageId,
        revisionId: source.revisionId,
        title: source.title,
        language: source.language,
        narrationVersion: source.narrationVersion,
        lastEdited: source.lastEdited,
        summary: source.summary,
        thumbnailUrl: source.thumbnailUrl,
        thumbnailWidth: source.thumbnailWidth,
        thumbnailHeight: source.thumbnailHeight,
        thumbnailAttribution: source.thumbnailAttribution,
        sections: source.sections,
        badgeKeys,
      };
      return NextResponse.json(
        { data: article },
        { status: 200, headers: NO_CACHE_HEADERS },
      );
    }

    if (input.operation === "metadata") {
      return NextResponse.json(
        { data: await getParsedPage(input.identity) },
        { status: 200, headers: NO_CACHE_HEADERS },
      );
    }

    if (input.operation === "related") {
      return NextResponse.json(
        { data: await getRelatedArticles(input.identity) },
        { status: 200, headers: NO_CACHE_HEADERS },
      );
    }

    const sectionIndex =
      input.sectionIndex ??
      (input.sectionTitle === null
        ? "0"
        : findSectionIndex(
            await getParsedPage(input.identity),
            input.sectionTitle,
          ));
    const links = sectionIndex
      ? await getSectionLinks(input.identity, sectionIndex)
      : [];
    return NextResponse.json(
      { data: links },
      { status: 200, headers: NO_CACHE_HEADERS },
    );
  } catch (error) {
    console.error(
      "[/api/local-wikipedia] Wikipedia request failed",
      error instanceof Error ? error.message : "Unknown error",
    );
    return NextResponse.json(
      { error: "Unable to load local Wikipedia data right now." },
      { status: 502, headers: NO_CACHE_HEADERS },
    );
  }
};
