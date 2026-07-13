import {
  ARTICLE_CONTEXT_EXTRACTOR_VERSION,
  type ArticleContextRequest,
  type ContextManifest,
} from "./article-context-types";
import {
  fetchArticleContextManifest,
  normalizeArticleContextRequest,
  type ArticleContextExtractorOptions,
} from "./article-context-extractor";
import {
  CONTEXT_DESCRIPTION_PROMPT_VERSION,
  enhanceArticleContextManifest,
  isArticleContextAIEnabled,
} from "./article-context-ai";

const DEFAULT_CACHE_TTL_MS = 24 * 60 * 60 * 1_000;
export const ARTICLE_CONTEXT_AI_FALLBACK_RETRY_MS = 60 * 60 * 1_000;
const MAX_CACHE_ENTRIES = 96;

type CacheEntry = {
  value?: ContextManifest;
  pending?: Promise<ContextManifest>;
  expiresAt: number;
  lastAccessedAt: number;
};

type ArticleContextCache = {
  deterministic: Map<string, CacheEntry>;
  enhanced: Map<string, CacheEntry>;
};

const CACHE_KEY = "__curioGardenArticleContextCacheV2" as const;

const getCache = (): ArticleContextCache => {
  const shared = globalThis as typeof globalThis & {
    [CACHE_KEY]?: ArticleContextCache;
  };
  shared[CACHE_KEY] ??= {
    deterministic: new Map<string, CacheEntry>(),
    enhanced: new Map<string, CacheEntry>(),
  };
  return shared[CACHE_KEY];
};

const positiveInteger = (value: string | undefined): number | null => {
  if (!value) return null;
  const parsed = Number(value);
  return Number.isSafeInteger(parsed) && parsed > 0 ? parsed : null;
};

const cacheTtlMs = (): number =>
  positiveInteger(process.env.ARTICLE_CONTEXT_CACHE_TTL_MS) ?? DEFAULT_CACHE_TTL_MS;

const deterministicKey = (request: ArticleContextRequest): string =>
  [
    ARTICLE_CONTEXT_EXTRACTOR_VERSION,
    request.language,
    request.wikiPageId,
    request.revisionId,
    request.title.toLocaleLowerCase(),
  ].join(":");

const enhancementVariant = (): string =>
  [
    process.env.CONTEXT_DESCRIPTION_MODEL?.trim() || "gpt-5.6-luna",
    CONTEXT_DESCRIPTION_PROMPT_VERSION,
    process.env.ARTICLE_CONTEXT_AI_ENABLED?.trim() || "default",
    process.env.OPENAI_API_KEY?.trim() ? "configured" : "unconfigured",
  ].join(":");

const evictExpiredAndOldest = (cache: Map<string, CacheEntry>, now: number) => {
  for (const [key, entry] of cache) {
    if (!entry.pending && entry.expiresAt <= now) cache.delete(key);
  }
  while (cache.size > MAX_CACHE_ENTRIES) {
    let oldestKey: string | null = null;
    let oldestTime = Number.POSITIVE_INFINITY;
    for (const [key, entry] of cache) {
      if (!entry.pending && entry.lastAccessedAt < oldestTime) {
        oldestKey = key;
        oldestTime = entry.lastAccessedAt;
      }
    }
    if (!oldestKey) break;
    cache.delete(oldestKey);
  }
};

const readOrCreate = async (
  cache: Map<string, CacheEntry>,
  key: string,
  create: () => Promise<ContextManifest>,
  valueTtlMs: (value: ContextManifest) => number = cacheTtlMs,
): Promise<{ context: ContextManifest; cacheStatus: "hit" | "miss" }> => {
  const now = Date.now();
  const cached = cache.get(key);
  if (cached && cached.expiresAt > now) {
    cached.lastAccessedAt = now;
    if (cached.value) return { context: cached.value, cacheStatus: "hit" };
    if (cached.pending) {
      return { context: await cached.pending, cacheStatus: "hit" };
    }
  }
  if (cached) cache.delete(key);

  const pending = create();
  const entry: CacheEntry = {
    pending,
    expiresAt: now + cacheTtlMs(),
    lastAccessedAt: now,
  };
  cache.set(key, entry);
  evictExpiredAndOldest(cache, now);
  try {
    const value = await pending;
    entry.value = value;
    entry.pending = undefined;
    entry.expiresAt = Date.now() + valueTtlMs(value);
    entry.lastAccessedAt = Date.now();
    return { context: value, cacheStatus: "miss" };
  } catch (error) {
    if (cache.get(key) === entry) cache.delete(key);
    throw error;
  }
};

/**
 * Revision-keyed deterministic cache. The extractor result remains the
 * authoritative fallback when persistence or AI services are unavailable.
 */
export const getArticleContext = async (
  input: ArticleContextRequest,
  options: ArticleContextExtractorOptions = {},
): Promise<{ context: ContextManifest; cacheStatus: "hit" | "miss" }> => {
  const request = normalizeArticleContextRequest(input);
  return readOrCreate(
    getCache().deterministic,
    deterministicKey(request),
    () => fetchArticleContextManifest(request, options),
  );
};

/**
 * Applies the optional, fail-open OpenAI copy pass once per source/model
 * variant. This keeps Luna out of cache-hit paths while retaining complete
 * deterministic accessibility copy when no API key is configured.
 */
export const getEnhancedArticleContext = async (
  input: ArticleContextRequest,
  options: ArticleContextExtractorOptions & {
    enhance?: (manifest: ContextManifest) => Promise<ContextManifest>;
  } = {},
): Promise<{ context: ContextManifest; cacheStatus: "hit" | "miss" }> => {
  const { enhance = enhanceArticleContextManifest, ...extractorOptions } = options;
  const deterministic = await getArticleContext(input, extractorOptions);
  const key = `${ARTICLE_CONTEXT_EXTRACTOR_VERSION}:${deterministic.context.sourceHash}:${enhancementVariant()}`;
  const enhanced = await readOrCreate(
    getCache().enhanced,
    key,
    () => enhance(deterministic.context),
    (value) => {
      const isDeterministicFallback =
        value.blocks.length > 0 &&
        value.blocks.every(
          (block) => block.provenance.descriptionMethod === "deterministic",
        );
      return isArticleContextAIEnabled() && isDeterministicFallback
        ? Math.min(cacheTtlMs(), ARTICLE_CONTEXT_AI_FALLBACK_RETRY_MS)
        : cacheTtlMs();
    },
  );
  return {
    context: enhanced.context,
    cacheStatus:
      deterministic.cacheStatus === "hit" && enhanced.cacheStatus === "hit"
        ? "hit"
        : "miss",
  };
};

export const clearArticleContextMemoryCache = (): void => {
  getCache().deterministic.clear();
  getCache().enhanced.clear();
};
