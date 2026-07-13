import { anyApi } from "convex/server";
import { fetchMutation } from "convex/nextjs";

const DEFAULT_DAILY_LIMIT = 250;
const DEFAULT_DAILY_WINDOW_MS = 24 * 60 * 60 * 1_000;
const GLOBAL_QUOTA_KEY = "article-context-ai:global";

const positiveInteger = (value: string | undefined, fallback: number): number => {
  const parsed = value ? Number(value) : Number.NaN;
  return Number.isSafeInteger(parsed) && parsed > 0 ? parsed : fallback;
};

const hasDistributedQuotaStore = (): boolean =>
  process.env.NEXT_PUBLIC_LOCAL_MODE !== "true" &&
  Boolean(process.env.NEXT_PUBLIC_CONVEX_URL?.trim());

/**
 * Protect the optional OpenAI copy-editing pass with a global, cross-instance
 * allowance. A quota outage fails closed to the deterministic descriptions;
 * rich context itself remains available and accessible.
 */
export const consumeArticleContextAIQuota = async (): Promise<boolean> => {
  if (process.env.NEXT_PUBLIC_LOCAL_MODE === "true") return true;
  if (!hasDistributedQuotaStore()) return false;

  try {
    const quota = await fetchMutation(anyApi.rateLimits.consumeRouteQuota, {
      key: GLOBAL_QUOTA_KEY,
      limit: positiveInteger(
        process.env.ARTICLE_CONTEXT_AI_DAILY_LIMIT,
        DEFAULT_DAILY_LIMIT,
      ),
      windowMs: positiveInteger(
        process.env.ARTICLE_CONTEXT_AI_DAILY_WINDOW_MS,
        DEFAULT_DAILY_WINDOW_MS,
      ),
    });
    return Boolean(quota.allowed);
  } catch (error) {
    console.warn(
      "[article-context] AI quota check failed; using deterministic copy.",
      error instanceof Error ? error.message : "Unknown error",
    );
    return false;
  }
};
