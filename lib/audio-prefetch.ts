import { generateArticleSectionAudioUrlWithMetadata } from "@/lib/article-section-audio-client";
import { buildArticleNarrationTracks } from "@/lib/section-narration";
import type { TtsAudioUrlResult } from "@/lib/tts-client";
import type { TtsProfile } from "@/lib/tts-profile";
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

type SummaryTtsProfile = Pick<TtsProfile, "provider" | "ttsCacheKey">;

const cache = new Map<string, CacheEntry>();
const preloadedAudioUrls = new Set<string>();

const summaryCacheKey = (
  slug: string,
  profile: SummaryTtsProfile,
  sourceHash: string,
): string => `${profile.ttsCacheKey}::${slug}::${sourceHash}`;

const generateTts = async (
  slug: string,
  sourceHash: string,
  profile: SummaryTtsProfile,
  localText: string,
): Promise<TtsAudioUrlResult> =>
  await generateArticleSectionAudioUrlWithMetadata({
    slug,
    sectionKey: "summary",
    sourceHash,
    provider: profile.provider,
    localText,
  });

const startSummaryWarm = (
  slug: string,
  profile: SummaryTtsProfile,
  sourceHash: string | undefined,
  work: () => Promise<TtsAudioUrlResult | null>,
): Promise<TtsAudioUrlResult | null> => {
  if (!sourceHash) return Promise.resolve(null);

  const key = summaryCacheKey(slug, profile, sourceHash);
  const existing = cache.get(key);
  if (existing) return existing.promise;

  const entry: CacheEntry = {
    promise: Promise.resolve(null),
    result: null,
  };

  const promise = work()
    .then((result) => {
      if (result && result.metadata.ttsCacheKey !== profile.ttsCacheKey) {
        if (cache.get(key) === entry) cache.delete(key);
        return result;
      }
      if (cache.get(key) === entry) {
        if (result) {
          entry.result = result;
        } else {
          cache.delete(key);
        }
      }
      return result;
    })
    .catch(() => {
      if (cache.get(key) === entry) cache.delete(key);
      return null;
    });

  entry.promise = promise;
  cache.set(key, entry);
  return promise;
};

export const primeSummaryAudio = (
  slug: string,
  result: TtsAudioUrlResult,
  profile: SummaryTtsProfile,
  sourceHash?: string,
): void => {
  if (!sourceHash || result.metadata.ttsCacheKey !== profile.ttsCacheKey)
    return;
  cache.set(summaryCacheKey(slug, profile, sourceHash), {
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
  profile: SummaryTtsProfile,
  sourceHash?: string,
): Promise<TtsAudioUrlResult | null> =>
  startSummaryWarm(slug, profile, sourceHash, async () => {
    const text = summary.trim();
    if (!text || !sourceHash) return null;
    return await generateTts(slug, sourceHash, profile, text);
  });

/**
 * Start fetching article data + generating TTS audio for the summary.
 * No-ops if the exact provider-qualified, revision-bound summary track is
 * already in flight or cached.
 */
export const warmSummaryAudio = async (
  slug: string,
  fetchArticle: FetchArticleFn,
  profile: SummaryTtsProfile,
): Promise<TtsAudioUrlResult | null> => {
  try {
    const article = await fetchArticleCached(slug, fetchArticle);
    const summaryTrack = buildArticleNarrationTracks(article).find(
      (track) => track.sectionKey === "summary",
    );
    if (!summaryTrack) return null;
    return await startSummaryWarm(slug, profile, summaryTrack.sourceHash, () =>
      generateTts(slug, summaryTrack.sourceHash, profile, summaryTrack.text),
    );
  } catch {
    return null;
  }
};

/** Returns the cached blob URL if the audio is ready, or `null`. */
export const getCachedSummaryUrl = (
  slug: string,
  profile: SummaryTtsProfile,
  sourceHash?: string,
): string | null =>
  sourceHash
    ? (cache.get(summaryCacheKey(slug, profile, sourceHash))?.result?.url ??
      null)
    : null;

/** Returns the cached audio result if it is ready, or `null`. */
export const getCachedSummaryAudio = (
  slug: string,
  profile: SummaryTtsProfile,
  sourceHash?: string,
): TtsAudioUrlResult | null =>
  sourceHash
    ? (cache.get(summaryCacheKey(slug, profile, sourceHash))?.result ?? null)
    : null;

/** Returns a promise that resolves when the audio is ready (or `null` on failure). */
export const awaitSummaryAudio = (
  slug: string,
  profile: SummaryTtsProfile,
  sourceHash?: string,
): Promise<string | null> | null =>
  sourceHash
    ? (cache
        .get(summaryCacheKey(slug, profile, sourceHash))
        ?.promise.then((result) => result?.url ?? null) ?? null)
    : null;

export const awaitSummaryAudioWithMetadata = (
  slug: string,
  profile: SummaryTtsProfile,
  sourceHash?: string,
): Promise<TtsAudioUrlResult | null> | null =>
  sourceHash
    ? (cache.get(summaryCacheKey(slug, profile, sourceHash))?.promise ?? null)
    : null;
