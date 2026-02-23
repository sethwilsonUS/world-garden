import { normalizeTtsText } from "@/convex/lib/elevenlabs";

const ELEVENLABS_KEY = "world-garden-elevenlabs-key";

const isElevenLabsConfigured = (): boolean => {
  if (typeof window === "undefined") return false;
  try {
    return !!localStorage.getItem(ELEVENLABS_KEY);
  } catch {
    return false;
  }
};

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
  promise: Promise<string | null>;
  url: string | null;
};

const cache = new Map<string, CacheEntry>();

const generateTts = async (text: string): Promise<string> => {
  const resp = await fetch("/api/tts", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ text: normalizeTtsText(text) }),
  });
  if (!resp.ok) {
    const body = await resp.json().catch(() => ({}));
    throw new Error(
      (body as { error?: string }).error ?? "Audio generation failed",
    );
  }
  const blob = await resp.blob();
  return URL.createObjectURL(blob);
};

/**
 * Start fetching article data + generating TTS audio for the summary.
 * No-ops if already in-flight/cached for this slug, or if ElevenLabs is configured.
 */
export const warmSummaryAudio = (
  slug: string,
  fetchArticle: FetchArticleFn,
): void => {
  if (isElevenLabsConfigured()) return;
  if (cache.has(slug)) return;

  const promise = (async (): Promise<string | null> => {
    const article = await fetchArticleCached(slug, fetchArticle);
    const summary = article.summary ?? "";
    if (summary.length < 10) return null;
    const url = await generateTts(summary);
    const entry = cache.get(slug);
    if (entry) entry.url = url;
    return url;
  })().catch(() => null);

  cache.set(slug, { promise, url: null });
};

/** Returns the cached blob URL if the audio is ready, or `null`. */
export const getCachedSummaryUrl = (slug: string): string | null =>
  cache.get(slug)?.url ?? null;

/** Returns a promise that resolves when the audio is ready (or `null` on failure). */
export const awaitSummaryAudio = (slug: string): Promise<string | null> | null =>
  cache.get(slug)?.promise ?? null;
