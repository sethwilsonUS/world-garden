import type {
  ArticleContextDownloadFormat,
  ArticleContextRequest,
} from "./article-context-types";
import {
  ArticleContextInputError,
  normalizeArticleContextRequest,
} from "./article-context-extractor";
import { getRequestIpAddress } from "./route-rate-limit";

const MAX_REQUEST_BODY_CHARS = 4_096;
const DEFAULT_RATE_LIMIT = 30;
const DEFAULT_RATE_WINDOW_MS = 5 * 60 * 1_000;
const MAX_RATE_BUCKETS = 5_000;

type RateBucket = { count: number; resetAt: number; lastSeenAt: number };
type RateStore = Map<string, RateBucket>;
const RATE_STORE_KEY = "__curioGardenArticleContextRateStoreV1" as const;

const getRateStore = (): RateStore => {
  const shared = globalThis as typeof globalThis & {
    [RATE_STORE_KEY]?: RateStore;
  };
  shared[RATE_STORE_KEY] ??= new Map();
  return shared[RATE_STORE_KEY];
};

const positiveInteger = (value: string | undefined, fallback: number): number => {
  const parsed = value ? Number(value) : Number.NaN;
  return Number.isSafeInteger(parsed) && parsed > 0 ? parsed : fallback;
};

export const consumeArticleContextRouteQuota = (
  headers: Headers,
  now = Date.now(),
): { allowed: true } | { allowed: false; retryAfterSeconds: number } => {
  if (process.env.NODE_ENV === "test") return { allowed: true };
  const limit = positiveInteger(
    process.env.ARTICLE_CONTEXT_RATE_LIMIT,
    DEFAULT_RATE_LIMIT,
  );
  const windowMs = positiveInteger(
    process.env.ARTICLE_CONTEXT_RATE_WINDOW_MS,
    DEFAULT_RATE_WINDOW_MS,
  );
  const key = getRequestIpAddress(headers) || "unknown";
  const store = getRateStore();
  const existing = store.get(key);
  if (!existing || existing.resetAt <= now) {
    store.set(key, { count: 1, resetAt: now + windowMs, lastSeenAt: now });
  } else {
    existing.count += 1;
    existing.lastSeenAt = now;
    if (existing.count > limit) {
      return {
        allowed: false,
        retryAfterSeconds: Math.max(1, Math.ceil((existing.resetAt - now) / 1_000)),
      };
    }
  }
  if (store.size > MAX_RATE_BUCKETS) {
    const oldest = [...store.entries()]
      .sort((a, b) => a[1].lastSeenAt - b[1].lastSeenAt)
      .slice(0, store.size - MAX_RATE_BUCKETS);
    oldest.forEach(([oldKey]) => store.delete(oldKey));
  }
  return { allowed: true };
};

const isRecord = (value: unknown): value is Record<string, unknown> =>
  Boolean(value) && typeof value === "object" && !Array.isArray(value);

export const parseArticleContextRequest = async (
  request: Request,
): Promise<ArticleContextRequest> => {
  const text = await request.text();
  if (!text || text.length > MAX_REQUEST_BODY_CHARS) {
    throw new ArticleContextInputError(
      text ? "Request body is too large" : "Request body is required",
    );
  }
  let body: unknown;
  try {
    body = JSON.parse(text);
  } catch {
    throw new ArticleContextInputError("Request body must be valid JSON");
  }
  if (!isRecord(body)) {
    throw new ArticleContextInputError("Request body must be a JSON object");
  }
  return normalizeArticleContextRequest({
    wikiPageId: String(body.wikiPageId ?? ""),
    title: String(body.title ?? ""),
    revisionId: String(body.revisionId ?? ""),
    language: body.language == null ? "en" : String(body.language),
  });
};

export const parseArticleContextDownloadRequest = async (
  request: Request,
): Promise<ArticleContextRequest & { format: ArticleContextDownloadFormat }> => {
  const text = await request.text();
  if (!text || text.length > MAX_REQUEST_BODY_CHARS) {
    throw new ArticleContextInputError(
      text ? "Request body is too large" : "Request body is required",
    );
  }
  let body: unknown;
  try {
    body = JSON.parse(text);
  } catch {
    throw new ArticleContextInputError("Request body must be valid JSON");
  }
  if (!isRecord(body)) {
    throw new ArticleContextInputError("Request body must be a JSON object");
  }
  if (body.format !== "json" && body.format !== "csv") {
    throw new ArticleContextInputError("format must be json or csv");
  }
  return {
    ...normalizeArticleContextRequest({
      wikiPageId: String(body.wikiPageId ?? ""),
      title: String(body.title ?? ""),
      revisionId: String(body.revisionId ?? ""),
      language: body.language == null ? "en" : String(body.language),
    }),
    format: body.format,
  };
};

export const clearArticleContextRouteQuotaForTests = (): void => {
  getRateStore().clear();
};
