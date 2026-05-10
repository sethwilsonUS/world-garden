import {
  generateTtsAudioUrlWithMetadata,
  type TtsAudioUrlResult,
} from "@/lib/tts-client";

type FetchArticleFn = (args: { slug: string }) => Promise<{ summary?: string; thumbnailUrl?: string }>;

/* ── Shared article fetch cache ── */

const articleFetchCache = new Map<string, Promise<{ summary?: string; thumbnailUrl?: string }>>();

const fetchArticleCached = (
  slug: string,
  fetchArticle: FetchArticleFn,
) => {
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

const generateTts = async (text: string): Promise<TtsAudioUrlResult> => {
  return generateTtsAudioUrlWithMetadata({ text });
};

/**
 * Start fetching article data + generating TTS audio for the summary.
 * No-ops if already in-flight/cached for this slug.
 */
export const warmSummaryAudio = (
  slug: string,
  fetchArticle: FetchArticleFn,
): void => {
  if (cache.has(slug)) return;

  const promise = (async (): Promise<TtsAudioUrlResult | null> => {
    const article = await fetchArticleCached(slug, fetchArticle);
    const summary = article.summary ?? "";
    if (summary.length < 10) return null;
    const result = await generateTts(summary);
    const entry = cache.get(slug);
    if (entry) entry.result = result;
    return result;
  })().catch(() => null);

  cache.set(slug, { promise, result: null });
};

/** Returns the cached blob URL if the audio is ready, or `null`. */
export const getCachedSummaryUrl = (slug: string): string | null =>
  cache.get(slug)?.result?.url ?? null;

/** Returns the cached audio result if it is ready, or `null`. */
export const getCachedSummaryAudio = (
  slug: string,
): TtsAudioUrlResult | null => cache.get(slug)?.result ?? null;

/** Returns a promise that resolves when the audio is ready (or `null` on failure). */
export const awaitSummaryAudio = (slug: string): Promise<string | null> | null =>
  cache.get(slug)?.promise.then((result) => result?.url ?? null) ?? null;

export const awaitSummaryAudioWithMetadata = (
  slug: string,
): Promise<TtsAudioUrlResult | null> | null => cache.get(slug)?.promise ?? null;
