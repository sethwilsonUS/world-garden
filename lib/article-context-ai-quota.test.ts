import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const fetchMutation = vi.hoisted(() => vi.fn());

vi.mock("convex/nextjs", () => ({ fetchMutation }));

const originalEnv = {
  convexUrl: process.env.NEXT_PUBLIC_CONVEX_URL,
  localMode: process.env.NEXT_PUBLIC_LOCAL_MODE,
  dailyLimit: process.env.ARTICLE_CONTEXT_AI_DAILY_LIMIT,
  dailyWindow: process.env.ARTICLE_CONTEXT_AI_DAILY_WINDOW_MS,
};

const restore = (key: string, value: string | undefined) => {
  if (value === undefined) delete process.env[key];
  else process.env[key] = value;
};

beforeEach(() => {
  vi.clearAllMocks();
  process.env.NEXT_PUBLIC_CONVEX_URL = "https://example.convex.cloud";
  process.env.NEXT_PUBLIC_LOCAL_MODE = "false";
  delete process.env.ARTICLE_CONTEXT_AI_DAILY_LIMIT;
  delete process.env.ARTICLE_CONTEXT_AI_DAILY_WINDOW_MS;
});

afterEach(() => {
  restore("NEXT_PUBLIC_CONVEX_URL", originalEnv.convexUrl);
  restore("NEXT_PUBLIC_LOCAL_MODE", originalEnv.localMode);
  restore("ARTICLE_CONTEXT_AI_DAILY_LIMIT", originalEnv.dailyLimit);
  restore("ARTICLE_CONTEXT_AI_DAILY_WINDOW_MS", originalEnv.dailyWindow);
  vi.restoreAllMocks();
});

describe("article context AI quota", () => {
  it("uses the distributed global allowance", async () => {
    fetchMutation.mockResolvedValue({ allowed: true });
    const { consumeArticleContextAIQuota } = await import(
      "./article-context-ai-quota"
    );

    await expect(consumeArticleContextAIQuota()).resolves.toBe(true);
    expect(fetchMutation).toHaveBeenCalledWith(expect.anything(), {
      key: "article-context-ai:global",
      limit: 250,
      windowMs: 86_400_000,
    });
  });

  it("honors configured bounds", async () => {
    process.env.ARTICLE_CONTEXT_AI_DAILY_LIMIT = "40";
    process.env.ARTICLE_CONTEXT_AI_DAILY_WINDOW_MS = "7200000";
    fetchMutation.mockResolvedValue({ allowed: false });
    const { consumeArticleContextAIQuota } = await import(
      "./article-context-ai-quota"
    );

    await expect(consumeArticleContextAIQuota()).resolves.toBe(false);
    expect(fetchMutation).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({ limit: 40, windowMs: 7_200_000 }),
    );
  });

  it("fails closed to deterministic copy when Convex is unavailable", async () => {
    fetchMutation.mockRejectedValue(new Error("offline"));
    const warn = vi.spyOn(console, "warn").mockImplementation(() => undefined);
    const { consumeArticleContextAIQuota } = await import(
      "./article-context-ai-quota"
    );

    await expect(consumeArticleContextAIQuota()).resolves.toBe(false);
    expect(warn).toHaveBeenCalled();
  });

  it("allows local-mode development without a distributed store", async () => {
    process.env.NEXT_PUBLIC_LOCAL_MODE = "true";
    delete process.env.NEXT_PUBLIC_CONVEX_URL;
    const { consumeArticleContextAIQuota } = await import(
      "./article-context-ai-quota"
    );

    await expect(consumeArticleContextAIQuota()).resolves.toBe(true);
    expect(fetchMutation).not.toHaveBeenCalled();
  });
});
