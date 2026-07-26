import {
  generateTtsAudioUrlWithMetadata,
  type TtsAudioUrlResult,
} from "@/lib/tts-client";
import { buildArticleNarrationTracks } from "@/lib/section-narration";
import { getActiveTtsCacheKey } from "@/lib/tts-profile";
import type { WikipediaArticle } from "@/lib/wikipedia-contracts";

type FetchArticleFn = (args: { slug: string }) => Promise<WikipediaArticle>;

/* ── Shared article fetch cache ── */

const articleFetchCache = new Map<string, Promise<WikipediaArticle>>();

const fetchArticleCached = (slug: string, fetchArticle: FetchArticleFn) => {
  if (!articleFetchCache.has(slug)) {
    articleFetchCache.set(
      slug,
      fetchArticle({ slug }).catch((err) => {
        articleFetchCache.delete(slug);
        throw err;
      }),
    );
  }
  return articleFetchCache.get(slug)!;
};

/* ── Image prefetch ── */

const imagePrefetched = new Set<string>();

export const warmArticleImage = (
  slug: string,
  fetchArticle: FetchArticleFn,
): void => {
  if (imagePrefetched.has(slug)) return;
  imagePrefetched.add(slug);

  fetchArticleCached(slug, fetchArticle)
    .then((article) => {
      if (article.thumbnailUrl) {
        const img = new Image();
        img.src = article.thumbnailUrl;
      }
    })
    .catch(() => {});
};

/* ── Audio prefetch ── */

type CacheEntry = {
  promise: Promise<TtsAudioUrlResult | null>;
  result: TtsAudioUrlResult | null;
};

const cache = new Map<string, CacheEntry>();
const preloadedAudioUrls = new Set<string>();
const summaryCacheKey = (
  slug: string,
  sourceHash: string,
  ttsCacheKey: string,
): string => `${slug}::${sourceHash}::${ttsCacheKey}`;

const generateTts = async (text: string): Promise<TtsAudioUrlResult> => {
  return generateTtsAudioUrlWithMetadata({ text });
};

const startSummaryWarm = (
  slug: string,
  sourceHash: string | undefined,
  ttsCacheKey: string | undefined,
  work: () => Promise<TtsAudioUrlResult | null>,
): Promise<TtsAudioUrlResult | null> => {
  if (!sourceHash || !ttsCacheKey) return Promise.resolve(null);
  const key = summaryCacheKey(slug, sourceHash, ttsCacheKey);
  const existing = cache.get(key);
  if (existing) return existing.promise;

  const entry: CacheEntry = {
    promise: Promise.resolve(null),
    result: null,
  };

  const promise = work()
    .then((result) => {
      if (result && result.metadata.ttsCacheKey !== ttsCacheKey) {
        if (cache.get(key) === entry) cache.delete(key);
        return result;
      }
      if (cache.get(key) === entry) {
        entry.result = result;
      }
      return result;
    })
    .catch(() => {
      if (cache.get(key) === entry) {
        cache.delete(key);
      }
      return null;
    });

  entry.promise = promise;
  cache.set(key, entry);
  return promise;
};

export const primeSummaryAudio = (
  slug: string,
  result: TtsAudioUrlResult,
  sourceHash: string | undefined,
  ttsCacheKey: string,
): void => {
  if (
    !sourceHash ||
    !ttsCacheKey ||
    result.metadata.ttsCacheKey !== ttsCacheKey
  ) {
    return;
  }
  cache.set(summaryCacheKey(slug, sourceHash, ttsCacheKey), {
    promise: Promise.resolve(result),
    result,
  });
};

export const preloadAudioUrl = (url: string): void => {
  if (typeof Audio === "undefined" || preloadedAudioUrls.has(url)) return;
  preloadedAudioUrls.add(url);

  const audio = new Audio();
  audio.preload = "auto";
  audio.src = url;
  audio.load?.();
};

export const warmSummaryAudioFromText = (
  slug: string,
  summary: string,
  sourceHash: string | undefined,
  ttsCacheKey: string,
): Promise<TtsAudioUrlResult | null> =>
  startSummaryWarm(slug, sourceHash, ttsCacheKey, async () => {
    const text = summary.trim();
    if (!text) return null;
    return generateTts(text);
  });

/**
 * Start fetching article data + generating TTS audio for the summary.
 * No-ops if the exact revision-bound summary track is already in flight/cached.
 */
export const warmSummaryAudio = (
  slug: string,
  fetchArticle: FetchArticleFn,
): Promise<TtsAudioUrlResult | null> =>
  fetchArticleCached(slug, fetchArticle)
    .then((article) => {
      const summaryTrack = buildArticleNarrationTracks(article).find(
        (track) => track.sectionKey === "summary",
      );
      if (!summaryTrack) return null;
      const ttsCacheKey = getActiveTtsCacheKey();
      return startSummaryWarm(slug, summaryTrack.sourceHash, ttsCacheKey, () =>
        generateTts(summaryTrack.text),
      );
    })
    .catch(() => null);

/** Returns the cached blob URL if the audio is ready, or `null`. */
export const getCachedSummaryUrl = (
  slug: string,
  sourceHash: string | undefined,
  ttsCacheKey: string,
): string | null =>
  sourceHash && ttsCacheKey
    ? (cache.get(summaryCacheKey(slug, sourceHash, ttsCacheKey))?.result?.url ??
      null)
    : null;

/** Returns the cached audio result if it is ready, or `null`. */
export const getCachedSummaryAudio = (
  slug: string,
  sourceHash: string | undefined,
  ttsCacheKey: string,
): TtsAudioUrlResult | null =>
  sourceHash && ttsCacheKey
    ? (cache.get(summaryCacheKey(slug, sourceHash, ttsCacheKey))?.result ??
      null)
    : null;

/** Returns a promise that resolves when the audio is ready (or `null` on failure). */
export const awaitSummaryAudio = (
  slug: string,
  sourceHash: string | undefined,
  ttsCacheKey: string,
): Promise<string | null> | null =>
  sourceHash && ttsCacheKey
    ? (cache
        .get(summaryCacheKey(slug, sourceHash, ttsCacheKey))
        ?.promise.then((result) => result?.url ?? null) ?? null)
    : null;

export const awaitSummaryAudioWithMetadata = (
  slug: string,
  sourceHash: string | undefined,
  ttsCacheKey: string,
): Promise<TtsAudioUrlResult | null> | null =>
  sourceHash && ttsCacheKey
    ? (cache.get(summaryCacheKey(slug, sourceHash, ttsCacheKey))?.promise ??
      null)
    : null;
