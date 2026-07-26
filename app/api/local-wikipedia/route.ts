import { NextResponse } from "next/server";
import {
  fetchArticleBadgeKeys,
  fetchArticleByTitle,
  fetchParsedPageData,
  fetchSectionLinksByIndex,
  searchWikipedia,
} from "@/convex/lib/wikipedia";
import type {
  LocalWikipediaRequest,
  WikipediaArticle,
  WikipediaLinkedArticle,
  WikipediaParsedPageData,
  WikipediaRevisionIdentity,
} from "@/lib/wikipedia-contracts";
import {
  normalizeWikipediaSectionTitle,
  slugToWikipediaTitle,
  wikipediaRevisionKey,
} from "@/lib/wikipedia-utils";

const NO_CACHE_HEADERS = { "Cache-Control": "no-store" } as const;
const MAX_PARSED_CACHE_ENTRIES = 32;
const MAX_SECTION_LINK_CACHE_ENTRIES = 128;
const parsedCache = new Map<string, Promise<WikipediaParsedPageData>>();
const sectionLinksCache = new Map<string, Promise<WikipediaLinkedArticle[]>>();

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
  const wikiPageId =
    typeof value.wikiPageId === "string" ? value.wikiPageId.trim() : "";
  const revisionId =
    typeof value.revisionId === "string" ? value.revisionId.trim() : "";
  const title = typeof value.title === "string" ? value.title.trim() : "";
  const language =
    typeof value.language === "string"
      ? value.language.trim().toLowerCase()
      : "";
  if (
    !/^\d{1,20}$/.test(wikiPageId) ||
    wikiPageId === "0" ||
    !/^\d{1,20}$/.test(revisionId) ||
    revisionId === "0" ||
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
  if (value.operation === "article") {
    const slug = typeof value.slug === "string" ? value.slug.trim() : "";
    return slug && slug.length <= 500 ? { operation: "article", slug } : null;
  }
  const identity = normalizeIdentity(value.identity);
  if (!identity) return null;
  if (value.operation === "metadata") {
    return { operation: "metadata", identity };
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

const getParsedPage = (
  identity: WikipediaRevisionIdentity,
): Promise<WikipediaParsedPageData> => {
  const key = wikipediaRevisionKey(identity);
  const cached = parsedCache.get(key);
  if (cached) return cached;

  const pending = fetchParsedPageData(identity).catch((error) => {
    if (parsedCache.get(key) === pending) parsedCache.delete(key);
    throw error;
  });
  parsedCache.set(key, pending);
  if (parsedCache.size > MAX_PARSED_CACHE_ENTRIES) {
    const oldestKey = parsedCache.keys().next().value as string | undefined;
    if (oldestKey && oldestKey !== key) parsedCache.delete(oldestKey);
  }
  return pending;
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
  const key = JSON.stringify([wikipediaRevisionKey(identity), sectionIndex]);
  const cached = sectionLinksCache.get(key);
  if (cached) return cached;

  const pending = fetchSectionLinksByIndex(identity, sectionIndex).catch(
    (error) => {
      if (sectionLinksCache.get(key) === pending) sectionLinksCache.delete(key);
      throw error;
    },
  );
  sectionLinksCache.set(key, pending);
  if (sectionLinksCache.size > MAX_SECTION_LINK_CACHE_ENTRIES) {
    const oldestKey = sectionLinksCache.keys().next().value as
      | string
      | undefined;
    if (oldestKey && oldestKey !== key) sectionLinksCache.delete(oldestKey);
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
        { data: await searchWikipedia(input.term) },
        { status: 200, headers: NO_CACHE_HEADERS },
      );
    }

    if (input.operation === "article") {
      const source = await fetchArticleByTitle(
        slugToWikipediaTitle(input.slug),
      );
      let badgeKeys: WikipediaArticle["badgeKeys"];
      try {
        badgeKeys = await fetchArticleBadgeKeys(source.wikiPageId);
      } catch {
        badgeKeys = undefined;
      }
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
