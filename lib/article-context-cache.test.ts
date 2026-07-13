import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  ARTICLE_CONTEXT_EXTRACTOR_VERSION,
  ARTICLE_CONTEXT_SCHEMA_VERSION,
  type ContextManifest,
} from "./article-context-types";

const fetchArticleContextManifest = vi.hoisted(() => vi.fn());
const normalizeArticleContextRequest = vi.hoisted(() =>
  vi.fn((input: Record<string, unknown>) => ({ ...input, language: "en" })),
);
const enhanceArticleContextManifest = vi.hoisted(() => vi.fn());
const isArticleContextAIEnabled = vi.hoisted(() => vi.fn());

vi.mock("./article-context-extractor", () => ({
  fetchArticleContextManifest,
  normalizeArticleContextRequest,
}));

vi.mock("./article-context-ai", () => ({
  CONTEXT_DESCRIPTION_PROMPT_VERSION: "context-accessibility-v3",
  enhanceArticleContextManifest,
  isArticleContextAIEnabled,
}));

import {
  ARTICLE_CONTEXT_AI_FALLBACK_RETRY_MS,
  clearArticleContextMemoryCache,
  getEnhancedArticleContext,
} from "./article-context";

const request = {
  wikiPageId: "42",
  title: "Example",
  revisionId: "100",
  language: "en",
};

const deterministicManifest: ContextManifest = {
  schemaVersion: ARTICLE_CONTEXT_SCHEMA_VERSION,
  wikiPageId: request.wikiPageId,
  title: request.title,
  revisionId: request.revisionId,
  language: request.language,
  sourceHash: "source-hash",
  extractorVersion: ARTICLE_CONTEXT_EXTRACTOR_VERSION,
  generatedAt: "2026-07-13T00:00:00.000Z",
  blocks: [
    {
      id: "timeline-history",
      kind: "timeline",
      title: "History timeline",
      caption: "Three events are shown.",
      longDescription: "The events are arranged chronologically.",
      section: { index: "1", title: "History" },
      order: 0,
      sources: [],
      provenance: {
        articleUrl: "https://en.wikipedia.org/wiki/Example",
        articleRevisionUrl:
          "https://en.wikipedia.org/w/index.php?oldid=100",
        sourceHash: "source-hash",
        extractorVersion: ARTICLE_CONTEXT_EXTRACTOR_VERSION,
        descriptionMethod: "deterministic",
      },
      timeline: {
        chronological: true,
        events: [1969, 1970, 1971].map((year) => ({
          id: `event-${year}`,
          label: `Event ${year}`,
          start: {
            display: String(year),
            iso: String(year),
            sortKey: year,
            precision: "year" as const,
          },
        })),
      },
    },
  ],
};

const originalCacheTtl = process.env.ARTICLE_CONTEXT_CACHE_TTL_MS;

beforeEach(() => {
  vi.useFakeTimers();
  vi.setSystemTime(new Date("2026-07-13T00:00:00.000Z"));
  vi.clearAllMocks();
  clearArticleContextMemoryCache();
  process.env.ARTICLE_CONTEXT_CACHE_TTL_MS = String(24 * 60 * 60 * 1_000);
  fetchArticleContextManifest.mockResolvedValue(deterministicManifest);
  enhanceArticleContextManifest.mockResolvedValue(deterministicManifest);
  isArticleContextAIEnabled.mockReturnValue(true);
});
afterEach(() => {
  clearArticleContextMemoryCache();
  delete (
    globalThis as typeof globalThis & {
      __curioGardenArticleContextCacheV1?: unknown;
    }
  ).__curioGardenArticleContextCacheV1;
  vi.useRealTimers();
  if (originalCacheTtl === undefined) {
    delete process.env.ARTICLE_CONTEXT_CACHE_TTL_MS;
  } else {
    process.env.ARTICLE_CONTEXT_CACHE_TTL_MS = originalCacheTtl;
  }
});

describe("article context enhanced-memory cache", () => {
  it("does not read entries from the schema-v1 memory namespace", async () => {
    const legacyManifest = {
      ...deterministicManifest,
      schemaVersion: 1,
    } as unknown as ContextManifest;
    (
      globalThis as typeof globalThis & {
        __curioGardenArticleContextCacheV1?: unknown;
      }
    ).__curioGardenArticleContextCacheV1 = {
      deterministic: new Map([
        [
          "en:42:100:example",
          {
            value: legacyManifest,
            expiresAt: Date.now() + 60_000,
            lastAccessedAt: Date.now(),
          },
        ],
      ]),
      enhanced: new Map(),
    };

    await getEnhancedArticleContext(request);

    expect(fetchArticleContextManifest).toHaveBeenCalledOnce();
  });

  it("retries an AI-enabled deterministic fallback after one hour in a long-lived worker", async () => {
    const enhance = vi.fn(async (manifest: ContextManifest) => manifest);

    await getEnhancedArticleContext(request, { enhance });
    vi.advanceTimersByTime(ARTICLE_CONTEXT_AI_FALLBACK_RETRY_MS - 1);
    const cached = await getEnhancedArticleContext(request, { enhance });
    vi.advanceTimersByTime(2);
    const retried = await getEnhancedArticleContext(request, { enhance });

    expect(cached.cacheStatus).toBe("hit");
    expect(retried.cacheStatus).toBe("miss");
    expect(enhance).toHaveBeenCalledTimes(2);
    expect(fetchArticleContextManifest).toHaveBeenCalledTimes(1);
  });

  it("keeps AI-assisted output for the normal configured TTL", async () => {
    const aiAssisted: ContextManifest = {
      ...deterministicManifest,
      blocks: deterministicManifest.blocks.map((block) => ({
        ...block,
        provenance: {
          ...block.provenance,
          descriptionMethod: "ai-assisted" as const,
          model: "gpt-5.6-luna",
          promptVersion: "context-accessibility-v3",
        },
      })),
    };
    const enhance = vi.fn(async () => aiAssisted);

    await getEnhancedArticleContext(request, { enhance });
    vi.advanceTimersByTime(ARTICLE_CONTEXT_AI_FALLBACK_RETRY_MS + 1);
    const cached = await getEnhancedArticleContext(request, { enhance });

    expect(cached.cacheStatus).toBe("hit");
    expect(enhance).toHaveBeenCalledTimes(1);
    expect(fetchArticleContextManifest).toHaveBeenCalledTimes(1);
  });
});
