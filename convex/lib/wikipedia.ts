import {
  ARTICLE_SECTION_NARRATION_VERSION,
  createSectionNarrations,
  type NarratedSection,
  type SectionNarrationSource,
} from "../../lib/section-narration";
import {
  loadMediaWikiDocument,
  MediaWikiSourceError,
  normalizeMediaWikiNumericId,
  type MediaWikiDocument,
  type MediaWikiDocumentRequest,
} from "../../lib/mediawiki-document";
import { createSectionNarrationsFromDocument } from "../../lib/section-narration-document";
import {
  createParsedPageDataFromDocument,
  extractSectionLinkTitlesFromDocument,
  type SectionLinkTitles,
} from "../../lib/mediawiki-document-metadata";
import {
  BADGE_KEYS,
  getBadgeTopicQuery,
  mapWikimediaTopicsToBadgeKeys,
  parseCirrusWeightedArticleTopics,
  WIKIMEDIA_TOPIC_MIN_CONFIDENCE,
  type BadgeKey,
  type WikimediaTopicPrediction,
} from "../../lib/badges";
import {
  DEFAULT_WIKIMEDIA_TIMEOUT_MS,
  extractActionApiPages,
  fetchWikimedia,
  fetchWikimediaActionApi,
  isMissingActionApiPage,
  isWikimediaTimeoutError,
} from "../../lib/wikimedia-client";
import {
  isCategoryNsfw,
  isDisambiguation,
  isDisambiguationPageProps,
} from "../../lib/nsfw-filter";
import {
  fetchWikimediaMediaDetails,
  getAttributionForImageUrl,
  WIKIMEDIA_FEED_THUMBNAIL_WIDTH,
  WIKIMEDIA_THUMBNAIL_WIDTH,
  type WikimediaMediaAttribution,
} from "../../lib/wikimedia-media";
import type {
  WikipediaRelatedArticle,
  WikipediaRelatedArticleThumbnail,
  WikipediaRevisionIdentity,
  WikipediaSearchResponse,
  WikipediaSearchSuggestion,
} from "../../lib/wikipedia-contracts";

const WIKI_ACTION_API = "https://en.wikipedia.org/w/api.php";
const WIKI_REST_API = "https://en.wikipedia.org/api/rest_v1";
export const WIKI_CORE_REST_API = "https://en.wikipedia.org/w/rest.php/v1";
export const SEARCH_SUGGESTION_LIMIT = 6;
export const SEARCH_SUGGESTION_TIMEOUT_MS = 5_000;

/** Keep related-article UI work bounded while preserving source order. */
export const MAX_SECTION_LINK_SOURCE_TITLES = 250;
/** One deadline covers both revision parsing and all description batches. */
export const SECTION_LINKS_TIMEOUT_MS = 25_000;
const SECTION_LINKS_BATCH_SIZE = 50;
const MAX_SECTION_LINK_RESPONSE_BYTES = 15 * 1024 * 1024;
const MAX_SECTION_LINK_TITLE_MAPPINGS = 4_096;

const invalidSectionLinkResponse = (message: string): MediaWikiSourceError =>
  new MediaWikiSourceError({
    code: "invalid-response",
    message,
    retryable: true,
  });

const throwIfAborted = (signal?: AbortSignal): void => {
  if (signal?.aborted) {
    throw (
      signal.reason ??
      new DOMException("The operation was aborted.", "AbortError")
    );
  }
};

const readBoundedSectionLinkJson = async (
  response: Response,
): Promise<unknown> => {
  const declaredLength = Number(response.headers.get("content-length"));
  if (
    Number.isFinite(declaredLength) &&
    declaredLength > MAX_SECTION_LINK_RESPONSE_BYTES
  ) {
    throw new MediaWikiSourceError({
      code: "response-too-large",
      message: "Wikipedia section-link response exceeded the safe size limit",
    });
  }
  if (!response.body) {
    throw invalidSectionLinkResponse(
      "Resolving Wikipedia section links returned an empty body",
    );
  }

  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  const chunks: string[] = [];
  let bytes = 0;
  try {
    while (true) {
      const { value, done } = await reader.read();
      if (done) break;
      bytes += value.byteLength;
      if (bytes > MAX_SECTION_LINK_RESPONSE_BYTES) {
        await reader.cancel().catch(() => undefined);
        throw new MediaWikiSourceError({
          code: "response-too-large",
          message:
            "Wikipedia section-link response exceeded the safe size limit",
        });
      }
      chunks.push(decoder.decode(value, { stream: true }));
    }
    chunks.push(decoder.decode());
  } catch (error) {
    if (error instanceof MediaWikiSourceError) throw error;
    throw invalidSectionLinkResponse(
      "Resolving Wikipedia section links returned an unreadable body",
    );
  } finally {
    reader.releaseLock();
  }

  try {
    return JSON.parse(chunks.join(""));
  } catch {
    throw invalidSectionLinkResponse(
      "Resolving Wikipedia section links returned invalid JSON",
    );
  }
};

const isRecord = (value: unknown): value is Record<string, unknown> =>
  Boolean(value) && typeof value === "object" && !Array.isArray(value);

const comparableWikipediaTitle = (value: string): string =>
  value.replaceAll("_", " ").trim();

const resolveExpectedSectionLinkTitles = (
  batch: readonly string[],
  queryData: Record<string, unknown>,
): Set<string> => {
  let expectedTitles = batch.map(comparableWikipediaTitle);
  for (const field of ["normalized", "converted", "redirects"] as const) {
    const value = queryData[field];
    if (value === undefined) continue;
    if (
      !Array.isArray(value) ||
      value.length > MAX_SECTION_LINK_TITLE_MAPPINGS
    ) {
      throw invalidSectionLinkResponse(
        `Resolving Wikipedia section links returned invalid ${field} mappings`,
      );
    }
    const mappings = new Map<string, string>();
    for (const entry of value) {
      if (
        !isRecord(entry) ||
        typeof entry.from !== "string" ||
        !entry.from.trim() ||
        typeof entry.to !== "string" ||
        !entry.to.trim()
      ) {
        throw invalidSectionLinkResponse(
          `Resolving Wikipedia section links returned invalid ${field} mappings`,
        );
      }
      const from = comparableWikipediaTitle(entry.from);
      const to = comparableWikipediaTitle(entry.to);
      if (mappings.has(from)) {
        throw invalidSectionLinkResponse(
          `Resolving Wikipedia section links returned unexpected ${field} mappings`,
        );
      }
      mappings.set(from, to);
    }
    const usedMappings = new Set<string>();
    expectedTitles = expectedTitles.map((initialTitle) => {
      let title = initialTitle;
      const path = new Set<string>();
      while (mappings.has(title) && !path.has(title)) {
        path.add(title);
        usedMappings.add(title);
        title = mappings.get(title)!;
      }
      return title;
    });
    if (usedMappings.size !== mappings.size) {
      throw invalidSectionLinkResponse(
        `Resolving Wikipedia section links returned unexpected ${field} mappings`,
      );
    }
  }
  return new Set(expectedTitles);
};

export type WikiSearchResult = {
  wikiPageId: string;
  title: string;
  description: string;
  url: string;
};

export type WikiSection = NarratedSection;

export type WikiArticle = {
  wikiPageId: string;
  title: string;
  language: string;
  revisionId: string;
  lastEdited: string;
  summary: string;
  contentText: string;
  sections: WikiSection[];
  narrationVersion: number;
  thumbnailUrl?: string;
  thumbnailWidth?: number;
  thumbnailHeight?: number;
  thumbnailAttribution?: WikimediaMediaAttribution;
};

type WikiThumbnail = {
  source: string;
  width: number;
  height: number;
};

const requireRevisionId = (value: unknown): string => {
  const revisionId = normalizeMediaWikiNumericId(value);
  if (!revisionId) {
    throw new Error("Wikipedia returned no usable revision identity");
  }
  return revisionId;
};

const requirePageId = (value: unknown): string => {
  const pageId = normalizeMediaWikiNumericId(value);
  if (!pageId) {
    throw new Error("Wikipedia returned no usable page identity");
  }
  return pageId;
};

const fetchSummaryThumbnail = async (
  title: string,
): Promise<WikiThumbnail | undefined> => {
  try {
    const response = await fetchWikimedia(
      `${WIKI_REST_API}/page/summary/${encodeURIComponent(title)}`,
    );
    if (!response.ok) return undefined;

    const data = await response.json();
    const thumbnail = data.thumbnail as WikiThumbnail | undefined;
    return thumbnail;
  } catch {
    return undefined;
  }
};

export const searchWikipediaWithMeta = async (
  term: string,
  options: { signal?: AbortSignal } = {},
): Promise<WikipediaSearchResponse> => {
  const normalizedTerm = term.replace(/\s+/gu, " ").trim();
  if (!normalizedTerm) return { results: [] };
  throwIfAborted(options.signal);

  const response = await fetchWikimediaActionApi(
    WIKI_ACTION_API,
    {
      action: "query",
      list: "search",
      srsearch: normalizedTerm,
      srlimit: "10",
      srprop: "snippet",
      srinfo: "suggestion",
      generator: "search",
      gsrsearch: normalizedTerm,
      gsrlimit: "10",
      gsrnamespace: "0",
      prop: "description",
    },
    { signal: options.signal },
  );

  if (!response.ok) {
    await response.body?.cancel().catch(() => undefined);
    throw new Error(`Wikipedia search failed: ${response.status}`);
  }

  const data: unknown = await response.json();
  const query = isRecord(data) && isRecord(data.query) ? data.query : undefined;

  const shortDescriptions = new Map<string, string>();
  const pages = extractActionApiPages<{
    pageid?: number | string;
    description?: unknown;
  }>(query?.pages);
  if (pages) {
    for (const page of pages) {
      const pageId = normalizeMediaWikiNumericId(page.pageid);
      const description =
        typeof page.description === "string"
          ? stripHtml(page.description).trim()
          : "";
      if (pageId && description) {
        shortDescriptions.set(pageId, description);
      }
    }
  }

  const rawSearch = Array.isArray(query?.search) ? query.search : [];
  const results: WikiSearchResult[] = [];
  for (const rawItem of rawSearch) {
    if (!isRecord(rawItem)) continue;
    const wikiPageId = normalizeMediaWikiNumericId(rawItem.pageid);
    const title =
      typeof rawItem.title === "string" ? stripHtml(rawItem.title).trim() : "";
    if (!wikiPageId || !title) continue;

    const snippet =
      typeof rawItem.snippet === "string" ? stripHtml(rawItem.snippet).trim() : "";
    const description = shortDescriptions.get(wikiPageId) || snippet;

    results.push({
      wikiPageId,
      title,
      description,
      url: `https://en.wikipedia.org/wiki/${encodeURIComponent(title.replace(/ /g, "_"))}`,
    });
  }

  const searchInfo = isRecord(query?.searchinfo) ? query.searchinfo : undefined;
  const rawSuggestion =
    typeof searchInfo?.suggestion === "string"
      ? stripHtml(searchInfo.suggestion).replace(/\s+/gu, " ").trim()
      : "";
  const suggestion =
    rawSuggestion &&
    rawSuggestion.toLocaleLowerCase("en-US") !==
      normalizedTerm.toLocaleLowerCase("en-US")
      ? rawSuggestion
      : undefined;

  return {
    results,
    ...(suggestion ? { suggestion } : {}),
  };
};

export const searchWikipedia = async (
  term: string,
): Promise<WikiSearchResult[]> => (await searchWikipediaWithMeta(term)).results;

export const suggestWikipediaTitles = async (
  term: string,
  options: { limit?: number; signal?: AbortSignal } = {},
): Promise<WikipediaSearchSuggestion[]> => {
  const normalizedTerm = term.replace(/\s+/gu, " ").trim();
  if (!normalizedTerm) return [];
  throwIfAborted(options.signal);

  const resolvedLimit =
    options.limit !== undefined &&
    Number.isFinite(options.limit) &&
    options.limit > 0
      ? Math.min(20, Math.floor(options.limit))
      : SEARCH_SUGGESTION_LIMIT;

  const url = new URL(`${WIKI_CORE_REST_API}/search/title`);
  url.searchParams.set("q", normalizedTerm);
  url.searchParams.set("limit", String(resolvedLimit));

  const response = await fetchWikimedia(url, {
    headers: { Accept: "application/json" },
    timeoutMs: SEARCH_SUGGESTION_TIMEOUT_MS,
    maxRetries: 1,
    signal: options.signal,
  });

  if (!response.ok) {
    await response.body?.cancel().catch(() => undefined);
    throw new Error(`Wikipedia title search failed: ${response.status}`);
  }

  const data: unknown = await response.json();
  const rawPages =
    isRecord(data) && Array.isArray(data.pages) ? data.pages : [];

  const suggestions: WikipediaSearchSuggestion[] = [];
  const seenIds = new Set<string>();

  for (const rawPage of rawPages) {
    if (!isRecord(rawPage)) continue;
    const wikiPageId = normalizeMediaWikiNumericId(rawPage.id);
    const title =
      typeof rawPage.title === "string" ? stripHtml(rawPage.title).trim() : "";
    if (!wikiPageId || !title || seenIds.has(wikiPageId)) continue;
    seenIds.add(wikiPageId);

    const key =
      typeof rawPage.key === "string" && rawPage.key.trim()
        ? rawPage.key.trim()
        : title.replace(/ /g, "_");
    const description =
      typeof rawPage.description === "string" && rawPage.description.trim()
        ? stripHtml(rawPage.description).trim()
        : undefined;

    let thumbnail: WikipediaSearchSuggestion["thumbnail"];
    if (isRecord(rawPage.thumbnail) && typeof rawPage.thumbnail.url === "string") {
      thumbnail = normalizeRelatedArticleThumbnail({
        source: rawPage.thumbnail.url,
        width: rawPage.thumbnail.width,
        height: rawPage.thumbnail.height,
      });
    }

    suggestions.push({
      wikiPageId,
      key,
      title,
      ...(description ? { description } : {}),
      ...(thumbnail ? { thumbnail } : {}),
    });

    if (suggestions.length >= resolvedLimit) break;
  }

  return suggestions;
};

export const WIKIMEDIA_OUTLINK_TOPIC_MODEL_URL =
  "https://api.wikimedia.org/service/lw/inference/v1/models/outlink-topic-model:predict";
export const BADGE_TOPIC_LIFT_WING_TIMEOUT_MS = 5_000;
export const BADGE_TOPIC_FALLBACK_MAX_CONCURRENCY = 2;

export type FetchArticleBadgeKeysOptions = {
  title?: string;
  language?: string;
  cirrusTopicPredictions?: readonly WikimediaTopicPrediction[];
  minConfidence?: number;
  signal?: AbortSignal;
};

const extractCirrusTopicPredictionsFromPage = (
  page: Record<string, unknown>,
): WikimediaTopicPrediction[] => {
  const cirrusDocs = page.cirrusdoc;
  if (!Array.isArray(cirrusDocs)) return [];
  for (const entry of cirrusDocs) {
    if (!isRecord(entry) || !isRecord(entry.source)) continue;
    const weightedTags = entry.source.weighted_tags;
    if (!Array.isArray(weightedTags)) continue;
    const parsed = parseCirrusWeightedArticleTopics(weightedTags);
    if (parsed.length > 0) return parsed;
  }
  return [];
};

const fetchLiftWingArticleTopics = async (
  title: string,
  language = "en",
  signal?: AbortSignal,
): Promise<WikimediaTopicPrediction[]> => {
  throwIfAborted(signal);
  const response = await fetchWikimedia(WIKIMEDIA_OUTLINK_TOPIC_MODEL_URL, {
    method: "POST",
    headers: {
      Accept: "application/json",
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      page_title: title,
      lang: language,
    }),
    timeoutMs: BADGE_TOPIC_LIFT_WING_TIMEOUT_MS,
    maxRetries: 1,
    signal,
  });

  if (!response.ok) {
    await response.body?.cancel().catch(() => undefined);
    throw new Error(
      `Wikimedia Lift Wing topic classification failed: ${response.status}`,
    );
  }

  const data: unknown = await response.json();
  const prediction = isRecord(data) ? data.prediction : undefined;
  const rawResults = isRecord(prediction) ? prediction.results : undefined;
  if (!Array.isArray(rawResults)) {
    throw new Error(
      "Wikimedia Lift Wing topic classification returned an invalid payload",
    );
  }

  const predictions: WikimediaTopicPrediction[] = [];
  for (const item of rawResults) {
    if (
      isRecord(item) &&
      typeof item.topic === "string" &&
      item.topic.trim() &&
      typeof item.score === "number" &&
      Number.isFinite(item.score)
    ) {
      predictions.push({
        topic: item.topic.trim(),
        score: item.score,
      });
    }
  }
  if (rawResults.length > 0 && predictions.length === 0) {
    throw new Error(
      "Wikimedia Lift Wing topic classification returned malformed results",
    );
  }
  return predictions;
};

const fetchCirrusArticleTopicLookup = async (
  canonicalPageId: string,
  signal?: AbortSignal,
): Promise<{ title?: string; predictions: WikimediaTopicPrediction[] }> => {
  throwIfAborted(signal);
  const response = await fetchWikimediaActionApi(
    WIKI_ACTION_API,
    {
      action: "query",
      pageids: canonicalPageId,
      prop: "cirrusdoc",
      cdincludes: "weighted_tags",
    },
    {
      timeoutMs: BADGE_TOPIC_LIFT_WING_TIMEOUT_MS,
      maxRetries: 1,
      signal,
    },
  );

  if (!response.ok) {
    await response.body?.cancel().catch(() => undefined);
    throw new Error(`Wikipedia cirrusdoc lookup failed: ${response.status}`);
  }

  const data: unknown = await response.json();
  const queryData = isRecord(data) ? data.query : undefined;
  const pages =
    extractActionApiPages(isRecord(queryData) ? queryData.pages : undefined) ??
    [];
  const page = pages.find(
    (candidate) =>
      normalizeMediaWikiNumericId(candidate.pageid) === canonicalPageId,
  );
  if (!page || isMissingActionApiPage(page)) {
    return { predictions: [] };
  }

  const title =
    typeof page.title === "string" && page.title.trim()
      ? page.title.trim()
      : undefined;
  return {
    ...(title ? { title } : {}),
    predictions: extractCirrusTopicPredictionsFromPage(page),
  };
};

const articleTopicMatches = async (
  wikiPageId: string,
  topics: string,
  signal?: AbortSignal,
): Promise<boolean> => {
  const canonicalPageId = requirePageId(wikiPageId);
  const response = await fetchWikimediaActionApi(
    WIKI_ACTION_API,
    {
      action: "query",
      list: "search",
      srsearch: `pageid:${canonicalPageId} articletopic:${topics}`,
      srlimit: "1",
      srwhat: "text",
    },
    { signal },
  );

  if (!response.ok) {
    await response.body?.cancel().catch(() => undefined);
    throw new Error(`Wikipedia articletopic search failed: ${response.status}`);
  }

  const data = await response.json();
  const results = data.query?.search ?? [];
  return results.some(
    (item: { pageid?: number | string }) =>
      normalizeMediaWikiNumericId(item.pageid) === canonicalPageId,
  );
};

const runWithConcurrencyLimit = async <Item, Result>(
  items: readonly Item[],
  maxConcurrency: number,
  worker: (item: Item) => Promise<Result>,
  signal?: AbortSignal,
): Promise<Result[]> => {
  if (items.length === 0) return [];
  const limit = Math.max(1, Math.min(maxConcurrency, items.length));
  const results = new Array<Result>(items.length);
  let nextIndex = 0;
  let failed = false;

  const runWorker = async (): Promise<void> => {
    while (!failed && nextIndex < items.length) {
      throwIfAborted(signal);
      const current = nextIndex;
      nextIndex += 1;
      try {
        results[current] = await worker(items[current]);
      } catch (error: unknown) {
        failed = true;
        throw error;
      }
    }
  };

  await Promise.all(Array.from({ length: limit }, () => runWorker()));
  return results;
};

/**
 * Classify an article's Curio Garden badge topics without firing an 8-way
 * search burst:
 * 1. Reuse piggybacked `cirrusdoc` `weighted_tags` when available (0 extra calls).
 * 2. Otherwise query Wikimedia Lift Wing `outlink-topic-model` (1 call) — or
 *    a single `cirrusdoc` pageid lookup when no title is supplied.
 * 3. Only if Lift Wing is unavailable, fall back to CirrusSearch `articletopic`
 *    queries capped at 2 concurrent requests.
 */
export const fetchArticleBadgeKeys = async (
  wikiPageId: string,
  options: FetchArticleBadgeKeysOptions = {},
): Promise<BadgeKey[]> => {
  const canonicalPageId = requirePageId(wikiPageId);
  throwIfAborted(options.signal);

  const minConfidence = options.minConfidence ?? WIKIMEDIA_TOPIC_MIN_CONFIDENCE;
  const language = (options.language ?? "en").trim().toLowerCase() || "en";

  if (
    options.cirrusTopicPredictions &&
    options.cirrusTopicPredictions.length > 0
  ) {
    return mapWikimediaTopicsToBadgeKeys(
      options.cirrusTopicPredictions,
      minConfidence,
    );
  }

  let resolvedTitle = options.title?.trim() || undefined;
  if (!resolvedTitle && language === "en") {
    try {
      const lookup = await fetchCirrusArticleTopicLookup(
        canonicalPageId,
        options.signal,
      );
      if (lookup.predictions.length > 0) {
        return mapWikimediaTopicsToBadgeKeys(lookup.predictions, minConfidence);
      }
      resolvedTitle = lookup.title;
    } catch (error: unknown) {
      if (options.signal?.aborted) throw error;
      console.warn(
        `[badge-topics] Cirrusdoc lookup failed for page ${canonicalPageId}; falling back:`,
        error instanceof Error ? error.message : String(error),
      );
    }
  }

  if (resolvedTitle) {
    try {
      const predictions = await fetchLiftWingArticleTopics(
        resolvedTitle,
        language,
        options.signal,
      );
      return mapWikimediaTopicsToBadgeKeys(predictions, minConfidence);
    } catch (error: unknown) {
      if (options.signal?.aborted) throw error;
      console.warn(
        `[badge-topics] Lift Wing topic classification failed for "${resolvedTitle}"; falling back to capped CirrusSearch:`,
        error instanceof Error ? error.message : String(error),
      );
    }
  }

  if (language !== "en") return [];

  const matches = await runWithConcurrencyLimit(
    BADGE_KEYS,
    BADGE_TOPIC_FALLBACK_MAX_CONCURRENCY,
    async (key) => {
      const didMatch = await articleTopicMatches(
        canonicalPageId,
        getBadgeTopicQuery(key),
        options.signal,
      );
      return didMatch ? key : null;
    },
    options.signal,
  );

  return matches.filter((key): key is BadgeKey => key !== null);
};

export type FetchedArticleWithDocument = {
  article: WikiArticle;
  /**
   * Revision-matched semantic HTML document produced during ingestion,
   * present only when Parsoid/legacy HTML parsing succeeded without
   * falling back to plaintext.
   */
  parsedDocument?: MediaWikiDocument;
  /**
   * Pre-extracted CirrusSearch `articletopic` weighted_tags piggybacked on the
   * article query so badge classification needs zero extra Wikimedia requests.
   */
  cirrusTopicPredictions?: WikimediaTopicPrediction[];
};

const hydrateFetchedWikipediaPage = async (
  page: Record<string, unknown>,
): Promise<FetchedArticleWithDocument> => {
  const revisions = page.revisions as
    | Array<Record<string, unknown>>
    | undefined;
  const revision = revisions?.[0];
  const wikiPageId = requirePageId(page.pageid);
  const revisionId = requireRevisionId(revision?.revid);
  const fullText = (page.extract as string) ?? "";
  const contentText = cleanContentForTts(fullText);
  const cirrusTopicPredictions = extractCirrusTopicPredictionsFromPage(page);
  const thumbnail =
    (page.thumbnail as WikiThumbnail | undefined) ??
    (await fetchSummaryThumbnail(page.title as string));
  const [{ summary, sections, parsedDocument }, thumbnailAttribution] =
    await Promise.all([
      buildRevisionNarration({
        wikiPageId,
        title: page.title as string,
        revisionId,
        fullText,
      }),
      getAttributionForImageUrl(thumbnail?.source),
    ]);

  return {
    article: {
      wikiPageId,
      title: page.title as string,
      language: "en",
      revisionId,
      lastEdited: (revision?.timestamp as string) ?? new Date().toISOString(),
      summary,
      contentText,
      sections,
      narrationVersion: ARTICLE_SECTION_NARRATION_VERSION,
      thumbnailUrl: thumbnail?.source,
      thumbnailWidth: thumbnail?.width,
      thumbnailHeight: thumbnail?.height,
      thumbnailAttribution,
    },
    ...(parsedDocument ? { parsedDocument } : {}),
    ...(cirrusTopicPredictions.length > 0 ? { cirrusTopicPredictions } : {}),
  };
};

const ARTICLE_CORE_QUERY_PROPS = "extracts|revisions|info|pageimages";
const ARTICLE_COMBINED_QUERY_PROPS = `${ARTICLE_CORE_QUERY_PROPS}|cirrusdoc`;
/** Total deadline across the combined `cirrusdoc` query and any article-only retry. */
export const ARTICLE_QUERY_DEADLINE_MS = DEFAULT_WIKIMEDIA_TIMEOUT_MS;
/** Bound the combined `cirrusdoc` attempt so a stalled search lookup leaves budget for an article-only retry. */
export const ARTICLE_COMBINED_QUERY_TIMEOUT_MS = Math.floor(
  ARTICLE_QUERY_DEADLINE_MS / 2,
);

const fetchWikipediaArticleQueryPayload = async (
  targetParams: Record<string, string>,
): Promise<Record<string, unknown>> => {
  const baseParams: Record<string, string> = {
    action: "query",
    ...targetParams,
    prop: ARTICLE_CORE_QUERY_PROPS,
    explaintext: "1",
    exsectionformat: "wiki",
    rvprop: "ids|timestamp",
    inprop: "url",
    piprop: "thumbnail",
    pithumbsize: String(WIKIMEDIA_THUMBNAIL_WIDTH),
  };

  const deadlineAt = Date.now() + ARTICLE_QUERY_DEADLINE_MS;
  const deadlineController = new AbortController();
  const deadlineTimer = setTimeout(() => {
    deadlineController.abort(
      new DOMException("The operation was aborted.", "AbortError"),
    );
  }, ARTICLE_QUERY_DEADLINE_MS);

  let combinedFailureStatus: number | undefined;
  let combinedFailureError: unknown;

  try {
    try {
      const combinedResponse = await fetchWikimediaActionApi(
        WIKI_ACTION_API,
        {
          ...baseParams,
          prop: ARTICLE_COMBINED_QUERY_PROPS,
          cdincludes: "weighted_tags",
        },
        {
          timeoutMs: ARTICLE_COMBINED_QUERY_TIMEOUT_MS,
          maxRetries: 0,
          signal: deadlineController.signal,
        },
      );

      if (combinedResponse.ok) {
        const combinedData: unknown = await combinedResponse.json();
        if (
          isRecord(combinedData) &&
          !("error" in combinedData && combinedData.error)
        ) {
          return combinedData;
        }
        combinedFailureError = new Error(
          "Wikipedia combined article query returned an error payload",
        );
      } else {
        combinedFailureStatus = combinedResponse.status;
        await combinedResponse.body?.cancel().catch(() => undefined);
      }
    } catch (error) {
      combinedFailureError = error;
    }

    const remainingMs = deadlineAt - Date.now();
    if (deadlineController.signal.aborted || remainingMs <= 0) {
      if (combinedFailureStatus !== undefined) {
        throw new Error(`Wikipedia fetch failed: ${combinedFailureStatus}`);
      }
      throw combinedFailureError ?? deadlineController.signal.reason;
    }

    console.warn(
      "[wikipedia] Combined cirrusdoc article query failed; retrying without cirrusdoc",
      combinedFailureStatus !== undefined
        ? { status: combinedFailureStatus }
        : combinedFailureError,
    );

    const retryResponse = await fetchWikimediaActionApi(
      WIKI_ACTION_API,
      baseParams,
      {
        timeoutMs: remainingMs,
        signal: deadlineController.signal,
      },
    );

    if (!retryResponse.ok) {
      await retryResponse.body?.cancel().catch(() => undefined);
      throw new Error(`Wikipedia fetch failed: ${retryResponse.status}`);
    }

    const retryData: unknown = await retryResponse.json();
    if (!isRecord(retryData)) {
      throw new Error("Wikipedia fetch returned an invalid payload");
    }
    return retryData;
  } finally {
    clearTimeout(deadlineTimer);
  }
};

export const fetchArticleWithDocumentByPageId = async (
  pageId: string,
): Promise<FetchedArticleWithDocument> => {
  const canonicalPageId = requirePageId(pageId);
  const data = await fetchWikipediaArticleQueryPayload({
    pageids: canonicalPageId,
  });

  const queryData = isRecord(data.query) ? data.query : undefined;
  const pages = extractActionApiPages(queryData?.pages) ?? [];
  const page = pages.find(
    (candidate) =>
      normalizeMediaWikiNumericId(candidate.pageid) === canonicalPageId,
  );

  if (!page || isMissingActionApiPage(page)) {
    throw new Error(`Wikipedia article not found: pageId ${canonicalPageId}`);
  }

  return await hydrateFetchedWikipediaPage(page);
};

export const fetchArticleByPageId = async (
  pageId: string,
): Promise<WikiArticle> =>
  (await fetchArticleWithDocumentByPageId(pageId)).article;

export const titleToSlug = (title: string): string => {
  return title.replace(/ /g, "_");
};

export const slugToTitle = (slug: string): string => {
  return slug.replace(/_/g, " ");
};

export const fetchArticleWithDocumentByTitle = async (
  title: string,
): Promise<FetchedArticleWithDocument> => {
  const data = await fetchWikipediaArticleQueryPayload({
    titles: title,
    redirects: "1",
  });

  const queryData = isRecord(data.query) ? data.query : undefined;
  const pages = extractActionApiPages(queryData?.pages) ?? [];
  const page = pages[0];

  if (!page || isMissingActionApiPage(page)) {
    throw new Error(`Wikipedia article not found: "${title}"`);
  }

  return await hydrateFetchedWikipediaPage(page);
};

export const fetchArticleByTitle = async (
  title: string,
): Promise<WikiArticle> =>
  (await fetchArticleWithDocumentByTitle(title)).article;

const NOISE_SECTIONS = new Set([
  "see also",
  "references",
  "external links",
  "notes",
  "further reading",
  "bibliography",
  "sources",
  "citations",
  "footnotes",
]);

const splitPlaintextArticle = (
  fullText: string,
): NonNullable<MediaWikiDocumentRequest["plaintext"]> => {
  // MediaWiki's plaintext extract represents section boundaries as wikitext
  // headings. This is the only structural regex in the ingestion path; HTML
  // structure is always read from parse5's semantic tree.
  const headingPattern = /^(={2,})\s*(.+?)\s*\1$/gm;
  const matches = [...fullText.matchAll(headingPattern)];
  const leadEnd = matches[0]?.index ?? fullText.length;
  return {
    lead: cleanSectionContent(fullText.slice(0, leadEnd)),
    sections: matches.map((match, index) => ({
      index: String(index + 1),
      title: match[2].trim(),
      level: match[1].length,
      text: cleanSectionContent(
        fullText.slice(
          (match.index ?? 0) + match[0].length,
          matches[index + 1]?.index ?? fullText.length,
        ),
      ),
    })),
  };
};

const buildRevisionNarration = async ({
  wikiPageId,
  title,
  revisionId,
  fullText,
}: {
  wikiPageId: string;
  title: string;
  revisionId: string;
  fullText: string;
}): Promise<{
  summary: string;
  sections: WikiSection[];
  parsedDocument?: MediaWikiDocument;
}> => {
  const plaintext = splitPlaintextArticle(fullText);
  const sourceSections: SectionNarrationSource[] = plaintext.sections
    .filter((section) => !NOISE_SECTIONS.has(section.title.toLowerCase()))
    .map((section) => ({
      wikiSectionIndex: section.index,
      title: section.title,
      level: section.level,
      content: section.text,
    }));

  try {
    const document = await loadMediaWikiDocument({
      wikiPageId,
      title,
      revisionId,
      language: "en",
      plaintext,
    });
    const isCacheableHtml =
      document.sourceFormat !== "plaintext" && !document.fallbackReason;
    return {
      summary: plaintext.lead,
      sections: createSectionNarrationsFromDocument(document),
      ...(isCacheableHtml ? { parsedDocument: document } : {}),
    };
  } catch (error) {
    if (
      error instanceof MediaWikiSourceError &&
      error.code === "identity-mismatch"
    ) {
      throw error;
    }
    // Unavailable parsed HTML must never resurrect the old suitability
    // heuristics. The revision's plaintext stays listenable.
    return {
      summary: plaintext.lead,
      sections: createSectionNarrations({
        sections: sourceSections,
        sourceIdentity: JSON.stringify([wikiPageId, revisionId, title]),
      }),
    };
  }
};

/**
 * Split Wikipedia plaintext (from explaintext=1) into a lead summary
 * and an ordered array of sections. Filters out reference/noise sections.
 */
export const parseSections = (
  fullText: string,
): {
  summary: string;
  sections: WikiSection[];
} => {
  const sectionHeadingRe = /^(={2,})\s*(.+?)\s*\1$/gm;
  const matches = [...fullText.matchAll(sectionHeadingRe)];

  if (matches.length === 0) {
    return { summary: cleanSectionContent(fullText.trim()), sections: [] };
  }

  const summary = cleanSectionContent(
    fullText.substring(0, matches[0].index!).trim(),
  );

  const rawSections: SectionNarrationSource[] = [];
  for (let i = 0; i < matches.length; i++) {
    const m = matches[i];
    const level = m[1].length;
    const title = m[2];

    if (NOISE_SECTIONS.has(title.toLowerCase())) continue;

    const contentStart = m.index! + m[0].length;
    const contentEnd =
      i + 1 < matches.length ? matches[i + 1].index! : fullText.length;
    const content = cleanSectionContent(
      fullText.substring(contentStart, contentEnd),
    );

    rawSections.push({
      wikiSectionIndex: String(i + 1),
      title,
      level,
      content,
    });
  }

  return {
    summary,
    sections: createSectionNarrations({ sections: rawSections }),
  };
};

export const cleanSectionContent = (text: string): string => {
  return text
    .replace(/^={2,}\s*.+?\s*={2,}$/gm, "")
    .replace(/\[\d+\]/g, "")
    .replace(/\[citation needed\]/gi, "")
    .replace(/\[edit\]/gi, "")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
};

const HTML_NAMED_ENTITIES: Record<string, string> = {
  amp: "&",
  apos: "'",
  gt: ">",
  hellip: "\u2026",
  lt: "<",
  mdash: "\u2014",
  nbsp: " ",
  ndash: "\u2013",
  quot: '"',
};

export const stripHtml = (html: string): string => {
  return html
    .replace(/<[^>]*>/g, "")
    .replace(
      /&(?:#x([0-9a-f]+)|#(\d+)|([a-z]+));/gi,
      (match, hex: string | undefined, decimal: string | undefined, named: string | undefined) => {
        if (hex !== undefined) {
          const codePoint = Number.parseInt(hex, 16);
          return Number.isFinite(codePoint) && codePoint >= 0 && codePoint <= 0x10ffff
            ? String.fromCodePoint(codePoint)
            : match;
        }
        if (decimal !== undefined) {
          const codePoint = Number.parseInt(decimal, 10);
          return Number.isFinite(codePoint) && codePoint >= 0 && codePoint <= 0x10ffff
            ? String.fromCodePoint(codePoint)
            : match;
        }
        if (named !== undefined) {
          return HTML_NAMED_ENTITIES[named.toLowerCase()] ?? match;
        }
        return match;
      },
    )
    .replace(/\u00a0/g, " ")
    .replace(/\s+/g, " ")
    .trim();
};

export type WikiSectionLinkCount = {
  index?: string;
  title: string;
  count: number;
};

export type WikiCitation = {
  id: string;
  index: number;
  text: string;
  url?: string;
};

export type SectionCitationInfo = {
  index?: string;
  title: string;
  count: number;
  citationIds: string[];
};

export type WikiLinkedArticle = {
  wikiPageId: string;
  title: string;
  description?: string;
};

export type WikiArticleImage = {
  src: string;
  originalSrc?: string;
  lightboxSrc?: string;
  lightboxWidth?: number;
  lightboxHeight?: number;
  alt: string;
  caption: string;
  width?: number;
  height?: number;
  videoSrc?: string;
  attribution?: WikimediaMediaAttribution;
};

export type ParsedPageData = {
  linkCounts: WikiSectionLinkCount[];
  citations: WikiCitation[];
  sectionCitations: SectionCitationInfo[];
  sectionIndexMap: { title: string; index: string }[];
  images: WikiArticleImage[];
};

export const createCacheableParsedPageData = (
  document: MediaWikiDocument,
): ParsedPageData => {
  if (document.sourceFormat === "plaintext" || document.fallbackReason) {
    throw new MediaWikiSourceError({
      code: "invalid-response",
      message:
        "Wikipedia semantic metadata unexpectedly fell back to plaintext",
      retryable: true,
    });
  }
  return createParsedPageDataFromDocument(document);
};

export const enrichParsedPageDataFromDocument = async (
  document: MediaWikiDocument,
  signal?: AbortSignal,
): Promise<ParsedPageData> => {
  throwIfAborted(signal);
  const parsed = createCacheableParsedPageData(document);
  const images = parsed.images;
  const mediaRequests = images.flatMap((image) => {
    const sourceTitle = image.attribution?.sourceTitle;
    const imageUrl = image.videoSrc ?? image.originalSrc ?? image.src;
    return sourceTitle ? [{ sourceTitle, imageUrl }] : [];
  });
  if (mediaRequests.length === 0) {
    return parsed;
  }

  const mediaDetails = await fetchWikimediaMediaDetails(
    mediaRequests,
    fetch,
    signal,
  );

  return {
    ...parsed,
    images: images.map((image) => {
      const sourceTitle = image.attribution?.sourceTitle;
      const imageUrl = image.videoSrc ?? image.originalSrc ?? image.src;
      const details = sourceTitle ? mediaDetails.get(imageUrl) : undefined;
      if (!details) return image;

      if (image.videoSrc) {
        return { ...image, attribution: details.attribution };
      }

      return {
        ...image,
        ...(details.originalSrc ? { originalSrc: details.originalSrc } : {}),
        ...(details.lightboxSrc &&
        details.lightboxWidth &&
        details.lightboxHeight
          ? {
              lightboxSrc: details.lightboxSrc,
              lightboxWidth: details.lightboxWidth,
              lightboxHeight: details.lightboxHeight,
            }
          : {}),
        attribution: details.attribution,
      };
    }),
  };
};

export type { SectionLinkTitles };

export type CacheableParsedPageData = ParsedPageData & {
  sectionLinkTitles: SectionLinkTitles[];
};

export const enrichCacheableParsedPageDataFromDocument = async (
  document: MediaWikiDocument,
  signal?: AbortSignal,
): Promise<CacheableParsedPageData> => {
  const parsed = await enrichParsedPageDataFromDocument(document, signal);
  return {
    ...parsed,
    sectionLinkTitles: extractSectionLinkTitlesFromDocument(
      document,
      MAX_SECTION_LINK_SOURCE_TITLES,
    ),
  };
};

export const fetchCacheableParsedPageData = async (
  identity: WikipediaRevisionIdentity,
  signal?: AbortSignal,
): Promise<CacheableParsedPageData> => {
  throwIfAborted(signal);
  if (identity.language !== "en") {
    return {
      linkCounts: [],
      citations: [],
      sectionCitations: [],
      sectionIndexMap: [],
      images: [],
      sectionLinkTitles: [],
    };
  }
  const document = await loadMediaWikiDocument(
    {
      wikiPageId: identity.wikiPageId,
      title: identity.title,
      revisionId: identity.revisionId,
      language: "en",
    },
    { signal },
  );
  return await enrichCacheableParsedPageDataFromDocument(document, signal);
};

/**
 * Single parse API call that extracts link counts, citations, per-section
 * citation mappings, and section index mappings. Callers should cache the
 * result in Convex so subsequent requests hit the database.
 */
export const fetchParsedPageData = async (
  identity: WikipediaRevisionIdentity,
  signal?: AbortSignal,
): Promise<ParsedPageData> => {
  const { sectionLinkTitles: _sectionLinkTitles, ...parsed } =
    await fetchCacheableParsedPageData(identity, signal);
  void _sectionLinkTitles;
  return parsed;
};

const resolveSectionLinkDescriptionsWithTimeout = async (
  articleTitles: readonly string[],
  {
    timeoutController,
    signal,
    hasTimedOut,
    markTimedOut,
  }: {
    timeoutController: AbortController;
    signal?: AbortSignal;
    hasTimedOut: () => boolean;
    markTimedOut: () => void;
  },
): Promise<WikiLinkedArticle[]> => {
  if (articleTitles.length === 0) return [];

  const resolved: WikiLinkedArticle[] = [];
  for (
    let index = 0;
    index < articleTitles.length;
    index += SECTION_LINKS_BATCH_SIZE
  ) {
    const batch = articleTitles.slice(
      index,
      index + SECTION_LINKS_BATCH_SIZE,
    );
    let qResponse: Response;
    try {
      qResponse = await fetchWikimediaActionApi(
        WIKI_ACTION_API,
        {
          action: "query",
          titles: batch.join("|"),
          prop: "description",
          redirects: "1",
        },
        {
          signal: timeoutController.signal,
          timeoutMs: SECTION_LINKS_TIMEOUT_MS,
        },
      );
    } catch (error) {
      if (signal?.aborted) throw error;
      if (hasTimedOut() || isWikimediaTimeoutError(error)) {
        markTimedOut();
        throw error;
      }
      throw new MediaWikiSourceError({
        code: "http-error",
        message: "Resolving Wikipedia section links failed",
        retryable: true,
      });
    }
    if (!qResponse.ok) {
      throw new MediaWikiSourceError({
        code: "http-error",
        message: `Resolving Wikipedia section links failed: ${qResponse.status}`,
        retryable: qResponse.status === 429 || qResponse.status >= 500,
      });
    }

    const qData = await readBoundedSectionLinkJson(qResponse);
    const queryData = isRecord(qData) ? qData.query : undefined;
    const rawPages = isRecord(queryData) ? queryData.pages : undefined;
    const pageValues = Array.isArray(rawPages)
      ? rawPages
      : isRecord(rawPages)
        ? Object.values(rawPages)
        : null;
    if (!isRecord(queryData) || !pageValues) {
      throw invalidSectionLinkResponse(
        "Resolving Wikipedia section links returned no pages",
      );
    }
    if (pageValues.length === 0 || pageValues.length > batch.length) {
      throw invalidSectionLinkResponse(
        "Resolving Wikipedia section links returned an invalid page count",
      );
    }
    const expectedTitles = resolveExpectedSectionLinkTitles(batch, queryData);
    if (pageValues.length !== expectedTitles.size) {
      throw invalidSectionLinkResponse(
        "Resolving Wikipedia section links returned an incomplete page set",
      );
    }
    const returnedTitles = new Set<string>();
    for (const value of pageValues) {
      if (!isRecord(value)) {
        throw invalidSectionLinkResponse(
          "Resolving Wikipedia section links returned a malformed page",
        );
      }
      const page = value;
      if (typeof page.title !== "string" || !page.title.trim()) {
        throw invalidSectionLinkResponse(
          "Resolving Wikipedia section links returned a page without a title",
        );
      }
      const title = comparableWikipediaTitle(page.title);
      if (!expectedTitles.has(title) || returnedTitles.has(title)) {
        throw invalidSectionLinkResponse(
          "Resolving Wikipedia section links returned an unexpected page",
        );
      }
      returnedTitles.add(title);

      const missing = Object.hasOwn(page, "missing");
      if (missing) {
        if (page.missing !== "" && page.missing !== true) {
          throw invalidSectionLinkResponse(
            "Resolving Wikipedia section links returned an invalid missing-page marker",
          );
        }
        continue;
      }
      if (
        typeof page.pageid !== "number" ||
        !Number.isSafeInteger(page.pageid) ||
        page.pageid <= 0 ||
        typeof page.ns !== "number" ||
        !Number.isSafeInteger(page.ns)
      ) {
        throw invalidSectionLinkResponse(
          "Resolving Wikipedia section links returned an invalid page identity",
        );
      }
      const wikiPageId = normalizeMediaWikiNumericId(page.pageid);
      if (!wikiPageId) {
        throw invalidSectionLinkResponse(
          "Resolving Wikipedia section links returned an invalid page identity",
        );
      }
      if (page.ns === 0) {
        resolved.push({
          wikiPageId,
          title: page.title,
          ...(typeof page.description === "string"
            ? { description: page.description }
            : {}),
        });
      }
    }
    if (returnedTitles.size !== expectedTitles.size) {
      throw invalidSectionLinkResponse(
        "Resolving Wikipedia section links returned an incomplete page set",
      );
    }
  }

  resolved.sort((a, b) => a.title.localeCompare(b.title));
  return resolved;
};

/**
 * Enrich pre-extracted revision-matched section link target titles with
 * current Wikipedia page IDs and short descriptions without re-parsing HTML.
 */
export const fetchSectionLinkDescriptions = async (
  rawTitles: readonly string[],
  signal?: AbortSignal,
): Promise<WikiLinkedArticle[]> => {
  throwIfAborted(signal);
  const articleTitles = [...new Set(rawTitles)].slice(
    0,
    MAX_SECTION_LINK_SOURCE_TITLES,
  );
  if (articleTitles.length === 0) return [];

  const timeoutController = new AbortController();
  let timedOut = false;
  const abortFromCaller = () => timeoutController.abort(signal?.reason);
  signal?.addEventListener("abort", abortFromCaller, { once: true });
  const timeout = setTimeout(() => {
    timedOut = true;
    timeoutController.abort();
  }, SECTION_LINKS_TIMEOUT_MS);

  try {
    return await resolveSectionLinkDescriptionsWithTimeout(articleTitles, {
      timeoutController,
      signal,
      hasTimedOut: () => timedOut,
      markTimedOut: () => {
        timedOut = true;
      },
    });
  } catch (error) {
    if (signal?.aborted) throw signal.reason ?? error;
    if (timedOut) {
      throw new MediaWikiSourceError({
        code: "timeout",
        message: "Resolving Wikipedia section links timed out",
        retryable: true,
      });
    }
    if (error instanceof MediaWikiSourceError) throw error;
    throw new MediaWikiSourceError({
      code: "http-error",
      message: "Resolving Wikipedia section links failed",
      retryable: true,
    });
  } finally {
    clearTimeout(timeout);
    signal?.removeEventListener("abort", abortFromCaller);
  }
};

/**
 * Resolve internal article links for a known semantic-document section index,
 * then enrich those revision-matched targets with current descriptions.
 */
export const fetchSectionLinksByIndex = async (
  identity: WikipediaRevisionIdentity,
  sectionIndex: string,
  signal?: AbortSignal,
): Promise<WikiLinkedArticle[]> => {
  throwIfAborted(signal);
  if (identity.language !== "en") return [];
  const timeoutController = new AbortController();
  let timedOut = false;
  const abortFromCaller = () => timeoutController.abort(signal?.reason);
  signal?.addEventListener("abort", abortFromCaller, { once: true });
  const timeout = setTimeout(() => {
    timedOut = true;
    timeoutController.abort();
  }, SECTION_LINKS_TIMEOUT_MS);

  try {
    const document = await loadMediaWikiDocument(
      {
        wikiPageId: identity.wikiPageId,
        title: identity.title,
        revisionId: identity.revisionId,
        language: "en",
      },
      { signal: timeoutController.signal },
    );
    if (document.sourceFormat === "plaintext" || document.fallbackReason) {
      throw new MediaWikiSourceError({
        code: "invalid-response",
        message: "Wikipedia section links unexpectedly fell back to plaintext",
        retryable: true,
      });
    }
    const section = document.sections.find(
      (candidate) =>
        candidate.key === (sectionIndex === "0" ? "__summary__" : sectionIndex),
    );
    const articleTitles = [
      ...new Set((section?.links ?? []).map((link) => link.targetTitle)),
    ].slice(0, MAX_SECTION_LINK_SOURCE_TITLES);

    return await resolveSectionLinkDescriptionsWithTimeout(articleTitles, {
      timeoutController,
      signal,
      hasTimedOut: () => timedOut,
      markTimedOut: () => {
        timedOut = true;
      },
    });
  } catch (error) {
    if (signal?.aborted) throw signal.reason ?? error;
    if (timedOut) {
      throw new MediaWikiSourceError({
        code: "timeout",
        message: "Resolving Wikipedia section links timed out",
        retryable: true,
      });
    }
    if (error instanceof MediaWikiSourceError) throw error;
    throw new MediaWikiSourceError({
      code: "http-error",
      message: "Resolving Wikipedia section links failed",
      retryable: true,
    });
  } finally {
    clearTimeout(timeout);
    signal?.removeEventListener("abort", abortFromCaller);
  }
};

export const RELATED_ARTICLES_DEFAULT_LIMIT = 5;
export const RELATED_ARTICLES_CANDIDATE_LIMIT = 12;
export const RELATED_ARTICLES_TIMEOUT_MS = 8_000;

export const buildMoreLikeSearchQuery = (title: string): string =>
  `morelike:${title.replace(/_/g, " ").replace(/\s+/g, " ").trim()}`;

const normalizeRelatedArticleThumbnail = (
  raw: unknown,
): WikipediaRelatedArticleThumbnail | undefined => {
  if (!isRecord(raw) || typeof raw.source !== "string") return undefined;
  const rawSource = raw.source.trim();
  if (!rawSource) return undefined;
  const normalizedUrl = rawSource.startsWith("//")
    ? `https:${rawSource}`
    : rawSource;
  let parsedUrl: URL;
  try {
    parsedUrl = new URL(normalizedUrl);
  } catch (error: unknown) {
    if (error instanceof TypeError) return undefined;
    throw error;
  }
  if (parsedUrl.protocol !== "https:" && parsedUrl.protocol !== "http:") {
    return undefined;
  }
  if (
    typeof raw.width !== "number" ||
    !Number.isFinite(raw.width) ||
    raw.width <= 0 ||
    typeof raw.height !== "number" ||
    !Number.isFinite(raw.height) ||
    raw.height <= 0
  ) {
    return undefined;
  }
  return {
    source: parsedUrl.toString(),
    width: raw.width,
    height: raw.height,
  };
};

const parseCategoryContinuePageId = (continueData: unknown): number | null => {
  if (!isRecord(continueData)) return null;
  if (typeof continueData.ppcontinue === "string") {
    return 0;
  }
  if (typeof continueData.clcontinue !== "string") {
    return null;
  }
  const match = /^(\d+)\|/u.exec(continueData.clcontinue);
  if (!match) return 0;
  const pageId = Number(match[1]);
  return Number.isSafeInteger(pageId) && pageId > 0 ? pageId : 0;
};

type RawRelatedArticlePage = {
  pageid?: number | string;
  ns?: number;
  title?: string;
  index?: number;
  missing?: unknown;
  description?: unknown;
  thumbnail?: unknown;
  pageprops?: unknown;
  categories?: unknown;
};

export type FetchRelatedArticlesOptions = {
  limit?: number;
  signal?: AbortSignal;
};

/**
 * Fetch semantically related mainspace English Wikipedia articles via
 * CirrusSearch `generator=search` + `morelike:<title>` in a single upstream
 * request, preserving CirrusSearch relevance order while excluding the current
 * article, disambiguation pages, and NSFW-categorized pages.
 */
export const fetchRelatedArticles = async (
  identity: Pick<WikipediaRevisionIdentity, "wikiPageId" | "title" | "language">,
  options: FetchRelatedArticlesOptions = {},
): Promise<WikipediaRelatedArticle[]> => {
  const { limit = RELATED_ARTICLES_DEFAULT_LIMIT, signal } = options;
  throwIfAborted(signal);

  const language = identity.language.trim().toLowerCase();
  if (language !== "en") return [];

  const normalizedTitle = comparableWikipediaTitle(identity.title).replace(
    /\s+/g,
    " ",
  );
  if (!normalizedTitle) return [];

  const resolvedLimit =
    Number.isFinite(limit) && limit > 0
      ? Math.floor(limit)
      : RELATED_ARTICLES_DEFAULT_LIMIT;
  const candidateLimit = Math.max(
    RELATED_ARTICLES_CANDIDATE_LIMIT,
    resolvedLimit * 2,
  );

  const response = await fetchWikimediaActionApi(
    WIKI_ACTION_API,
    {
      action: "query",
      generator: "search",
      gsrsearch: buildMoreLikeSearchQuery(normalizedTitle),
      gsrnamespace: "0",
      gsrlimit: String(candidateLimit),
      gsrwhat: "text",
      prop: "description|pageimages|pageprops|categories",
      ppprop: "disambiguation",
      clshow: "!hidden",
      cllimit: "max",
      piprop: "thumbnail",
      pithumbsize: String(WIKIMEDIA_FEED_THUMBNAIL_WIDTH),
    },
    {
      timeoutMs: RELATED_ARTICLES_TIMEOUT_MS,
      maxRetries: 1,
      signal,
    },
  );

  if (!response.ok) {
    await response.body?.cancel().catch(() => undefined);
    throw new Error(
      `Wikipedia related articles search failed: ${response.status}`,
    );
  }

  const data: unknown = await response.json();
  if (!isRecord(data)) {
    throw new Error("Wikipedia related articles search returned an invalid payload");
  }
  if ("error" in data && data.error) {
    throw new Error("Wikipedia related articles search returned an error payload");
  }
  if (data.query === undefined) {
    return [];
  }
  if (!isRecord(data.query)) {
    throw new Error("Wikipedia related articles search returned an invalid query");
  }
  if (data.query.pages === undefined) {
    return [];
  }

  const pages = extractActionApiPages<RawRelatedArticlePage>(data.query.pages);
  if (!pages) {
    throw new Error("Wikipedia related articles search returned invalid pages");
  }

  const truncatedCategoriesFromPageId = parseCategoryContinuePageId(
    data.continue,
  );
  const currentPageId = normalizeMediaWikiNumericId(identity.wikiPageId);
  const rankedPages = pages
    .map((page, position) => ({
      page,
      position,
      rank:
        typeof page.index === "number" && Number.isFinite(page.index)
          ? page.index
          : Number.MAX_SAFE_INTEGER,
    }))
    .sort(
      (left, right) => left.rank - right.rank || left.position - right.position,
    );

  const results: WikipediaRelatedArticle[] = [];
  const seenPageIds = new Set<string>();

  for (const { page } of rankedPages) {
    if (isMissingActionApiPage(page)) continue;
    if (page.ns !== undefined && page.ns !== 0) continue;

    const wikiPageId = normalizeMediaWikiNumericId(page.pageid);
    if (!wikiPageId || seenPageIds.has(wikiPageId)) continue;

    const title =
      typeof page.title === "string"
        ? comparableWikipediaTitle(page.title).replace(/\s+/g, " ")
        : "";
    if (!title) continue;

    if (
      (currentPageId && wikiPageId === currentPageId) ||
      title === normalizedTitle
    ) {
      continue;
    }

    const pageprops = isRecord(page.pageprops) ? page.pageprops : undefined;
    if (isDisambiguationPageProps(pageprops)) continue;

    const categories = Array.isArray(page.categories)
      ? page.categories.filter(
          (entry): entry is { title: string } =>
            isRecord(entry) && typeof entry.title === "string",
        )
      : [];
    if (
      categories.some(
        (category) =>
          isCategoryNsfw(category.title) || isDisambiguation(category.title),
      )
    ) {
      continue;
    }

    // Fail closed if MediaWiki truncated visible categories for this page ID.
    if (
      truncatedCategoriesFromPageId !== null &&
      Number(wikiPageId) >= truncatedCategoriesFromPageId
    ) {
      continue;
    }

    seenPageIds.add(wikiPageId);
    const description =
      typeof page.description === "string" && page.description.trim()
        ? page.description.trim()
        : undefined;
    const thumbnail = normalizeRelatedArticleThumbnail(page.thumbnail);

    results.push({
      wikiPageId,
      title,
      ...(description ? { description } : {}),
      ...(thumbnail ? { thumbnail } : {}),
    });

    if (results.length >= resolvedLimit) break;
  }

  return results;
};

export const cleanContentForTts = (text: string): string => {
  let cleaned = text
    .replace(/\[\d+\]/g, "")
    .replace(/\[citation needed\]/gi, "")
    .replace(/\[edit\]/gi, "")
    .replace(/== See also ==[\s\S]*$/i, "")
    .replace(/== References ==[\s\S]*$/i, "")
    .replace(/== External links ==[\s\S]*$/i, "")
    .replace(/== Notes ==[\s\S]*$/i, "")
    .replace(/== Further reading ==[\s\S]*$/i, "")
    .replace(/^={2,}\s*.+?\s*={2,}$/gm, "")
    .replace(/\n{3,}/g, "\n\n")
    .trim();

  const TTS_CHAR_LIMIT = 4800;
  if (cleaned.length > TTS_CHAR_LIMIT) {
    cleaned = cleaned.slice(0, TTS_CHAR_LIMIT);
    const lastSentence = cleaned.lastIndexOf(". ");
    if (lastSentence > TTS_CHAR_LIMIT * 0.5) {
      cleaned = cleaned.slice(0, lastSentence + 1);
    }
  }

  return cleaned;
};
