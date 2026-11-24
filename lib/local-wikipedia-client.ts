import { normalizeMediaWikiNumericId } from "@/lib/wikipedia-utils";
import type {
  LocalWikipediaRequest,
  LocalWikipediaResponseFor,
  WikipediaParsedPageData,
  WikipediaRelatedArticle,
  WikipediaRevisionIdentity,
} from "@/lib/wikipedia-contracts";
import { createRevisionMetadataClient } from "@/lib/wikipedia-metadata-client";

const isRecord = (value: unknown): value is Record<string, unknown> =>
  Boolean(value) && typeof value === "object" && !Array.isArray(value);

const MAX_LOCAL_RELATED_CACHE_ENTRIES = 100;
const LOCAL_RELATED_SESSION_STORAGE_PREFIX =
  "curio-garden:related-articles:v1:";

const relatedArticleCacheKey = (
  identity: Pick<WikipediaRevisionIdentity, "wikiPageId" | "title" | "language">,
): string =>
  JSON.stringify([
    identity.language.trim().toLowerCase(),
    normalizeMediaWikiNumericId(identity.wikiPageId) ??
      identity.wikiPageId.trim(),
    identity.title.replaceAll("_", " ").replace(/\s+/g, " ").trim(),
  ]);

const relatedSessionStorageKey = (cacheKey: string): string =>
  `${LOCAL_RELATED_SESSION_STORAGE_PREFIX}${cacheKey}`;

const isValidRelatedArticle = (
  value: unknown,
): value is WikipediaRelatedArticle => {
  if (!isRecord(value)) return false;
  if (
    typeof value.wikiPageId !== "string" ||
    !value.wikiPageId ||
    typeof value.title !== "string" ||
    !value.title
  ) {
    return false;
  }
  if (
    value.description !== undefined &&
    typeof value.description !== "string"
  ) {
    return false;
  }
  if (value.thumbnail !== undefined) {
    if (
      !isRecord(value.thumbnail) ||
      typeof value.thumbnail.source !== "string" ||
      typeof value.thumbnail.width !== "number" ||
      !Number.isFinite(value.thumbnail.width) ||
      value.thumbnail.width <= 0 ||
      typeof value.thumbnail.height !== "number" ||
      !Number.isFinite(value.thumbnail.height) ||
      value.thumbnail.height <= 0
    ) {
      return false;
    }
  }
  return true;
};

const readRelatedArticlesFromSession = (
  cacheKey: string,
): WikipediaRelatedArticle[] | null => {
  if (typeof window === "undefined" || !window.sessionStorage) return null;
  try {
    const raw = window.sessionStorage.getItem(
      relatedSessionStorageKey(cacheKey),
    );
    if (!raw) return null;
    const parsed: unknown = JSON.parse(raw);
    if (!Array.isArray(parsed) || !parsed.every(isValidRelatedArticle)) {
      return null;
    }
    return parsed;
  } catch (error: unknown) {
    console.warn(
      "[local-wikipedia] Failed to read related articles from sessionStorage",
      error instanceof Error ? error.message : String(error),
    );
    return null;
  }
};

const writeRelatedArticlesToSession = (
  cacheKey: string,
  articles: WikipediaRelatedArticle[],
): void => {
  if (typeof window === "undefined" || !window.sessionStorage) return;
  try {
    window.sessionStorage.setItem(
      relatedSessionStorageKey(cacheKey),
      JSON.stringify(articles),
    );
  } catch (error: unknown) {
    console.warn(
      "[local-wikipedia] Failed to cache related articles in sessionStorage",
      error instanceof Error ? error.message : String(error),
    );
  }
};

const abortError = (): DOMException =>
  new DOMException("The request was aborted.", "AbortError");

const awaitWithAbort = <Result,>(
  promise: Promise<Result>,
  signal?: AbortSignal,
): Promise<Result> => {
  if (!signal) return promise;
  if (signal.aborted) return Promise.reject(abortError());
  return new Promise<Result>((resolve, reject) => {
    const handleAbort = () => reject(abortError());
    signal.addEventListener("abort", handleAbort, { once: true });
    void promise.then(
      (result) => {
        signal.removeEventListener("abort", handleAbort);
        if (!signal.aborted) resolve(result);
      },
      (error: unknown) => {
        signal.removeEventListener("abort", handleAbort);
        if (!signal.aborted) reject(error);
      },
    );
  });
};

export const requestLocalWikipedia = async <
  Request extends LocalWikipediaRequest,
>(
  request: Request,
  signal?: AbortSignal,
): Promise<LocalWikipediaResponseFor<Request>> => {
  const response = await fetch("/api/local-wikipedia", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(request),
    ...(signal ? { signal } : {}),
  });
  let payload: unknown;
  try {
    payload = await response.json();
  } catch (error: unknown) {
    if (error instanceof SyntaxError || error instanceof TypeError) {
      throw new Error("Local Wikipedia request failed");
    }
    throw error;
  }
  const error =
    isRecord(payload) && typeof payload.error === "string"
      ? payload.error
      : null;
  if (!response.ok || error !== null) {
    throw new Error(error || "Local Wikipedia request failed");
  }
  if (!isRecord(payload) || !("data" in payload)) {
    throw new Error("Local Wikipedia request failed");
  }
  return payload.data as LocalWikipediaResponseFor<Request>;
};

const localMetadataClient = createRevisionMetadataClient((identity) =>
  requestLocalWikipedia({
    operation: "metadata",
    identity,
  }),
);

const localRelatedCache = new Map<string, Promise<WikipediaRelatedArticle[]>>();
let localRelatedCacheEpoch = 0;

/** Test-only isolation hook; production callers never invoke this. */
export const resetLocalWikipediaClientCachesForTests = (): void => {
  localMetadataClient.reset();
  localRelatedCacheEpoch += 1;
  localRelatedCache.clear();
};

/**
 * Share revision metadata work without sharing caller cancellation. Aborting a
 * component request stops only that caller from observing the result; the
 * revision-pinned request can still finish, populate the cache, and serve
 * another mounted consumer.
 */
export const requestLocalWikipediaMetadata = (
  identity: WikipediaRevisionIdentity,
  signal?: AbortSignal,
): Promise<WikipediaParsedPageData> =>
  localMetadataClient.requestMetadata(identity, signal);

/**
 * Fetch and cache related "Listen next" articles per article in memory and
 * browser `sessionStorage` for Local Mode. Failed requests are evicted rather
 * than cached.
 */
export const requestLocalWikipediaRelatedArticles = (
  identity: WikipediaRevisionIdentity,
  signal?: AbortSignal,
): Promise<WikipediaRelatedArticle[]> => {
  if (signal?.aborted) return Promise.reject(abortError());

  const cacheKey = relatedArticleCacheKey(identity);
  const inMemory = localRelatedCache.get(cacheKey);
  if (inMemory) {
    return awaitWithAbort(inMemory, signal);
  }

  const fromSession = readRelatedArticlesFromSession(cacheKey);
  if (fromSession) {
    const resolved = Promise.resolve(fromSession);
    localRelatedCache.set(cacheKey, resolved);
    if (localRelatedCache.size > MAX_LOCAL_RELATED_CACHE_ENTRIES) {
      const oldestKey = localRelatedCache.keys().next().value as
        | string
        | undefined;
      if (oldestKey && oldestKey !== cacheKey) {
        localRelatedCache.delete(oldestKey);
      }
    }
    return awaitWithAbort(resolved, signal);
  }

  const requestEpoch = localRelatedCacheEpoch;
  const pending = requestLocalWikipedia({
    operation: "related",
    identity,
  })
    .then((articles) => {
      if (requestEpoch === localRelatedCacheEpoch) {
        writeRelatedArticlesToSession(cacheKey, articles);
      }
      return articles;
    })
    .catch((error: unknown) => {
      if (localRelatedCache.get(cacheKey) === pending) {
        localRelatedCache.delete(cacheKey);
      }
      throw error;
    });

  localRelatedCache.set(cacheKey, pending);
  if (localRelatedCache.size > MAX_LOCAL_RELATED_CACHE_ENTRIES) {
    const oldestKey = localRelatedCache.keys().next().value as
      | string
      | undefined;
    if (oldestKey && oldestKey !== cacheKey) {
      localRelatedCache.delete(oldestKey);
    }
  }
  return awaitWithAbort(pending, signal);
};
