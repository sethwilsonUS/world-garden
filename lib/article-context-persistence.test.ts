import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  ARTICLE_CONTEXT_EXTRACTOR_VERSION,
  ARTICLE_CONTEXT_SCHEMA_VERSION,
  type ContextManifest,
} from "./article-context-types";

const fetchAction = vi.hoisted(() => vi.fn());
const fetchQuery = vi.hoisted(() => vi.fn());
const getEnhancedArticleContext = vi.hoisted(() => vi.fn());

vi.mock("convex/nextjs", () => ({ fetchAction, fetchQuery }));
vi.mock("@/lib/article-context", () => ({ getEnhancedArticleContext }));

const manifest: ContextManifest = {
  schemaVersion: ARTICLE_CONTEXT_SCHEMA_VERSION,
  wikiPageId: "42",
  title: "Example",
  revisionId: "100",
  language: "en",
  sourceHash: "abc123",
  extractorVersion: ARTICLE_CONTEXT_EXTRACTOR_VERSION,
  generatedAt: "2026-07-13T00:00:00.000Z",
  blocks: [
    {
      id: "context-timeline-example",
      kind: "timeline",
      title: "History timeline",
      caption: "Three events are shown.",
      longDescription: "The events are ordered from 1969 through 1972.",
      section: { index: "1", title: "History" },
      order: 0,
      sources: [
        {
          label: "Example on Wikipedia",
          url: "https://en.wikipedia.org/w/index.php?oldid=100",
          revisionId: "100",
          accessedAt: "2026-07-13T00:00:00.000Z",
        },
      ],
      provenance: {
        articleUrl: "https://en.wikipedia.org/wiki/Example",
        articleRevisionUrl:
          "https://en.wikipedia.org/w/index.php?oldid=100",
        sourceHash: "abc123",
        extractorVersion: ARTICLE_CONTEXT_EXTRACTOR_VERSION,
        descriptionMethod: "deterministic",
      },
      timeline: {
        chronological: true,
        events: [1969, 1970, 1972].map((year) => ({
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

const originalEnv = {
  convexUrl: process.env.NEXT_PUBLIC_CONVEX_URL,
  localMode: process.env.NEXT_PUBLIC_LOCAL_MODE,
  openAiKey: process.env.OPENAI_API_KEY,
  writeSecret: process.env.ARTICLE_CONTEXT_WRITE_SECRET,
  cronSecret: process.env.CRON_SECRET,
};

const restore = (key: string, value: string | undefined) => {
  if (value === undefined) delete process.env[key];
  else process.env[key] = value;
};

beforeEach(() => {
  vi.clearAllMocks();
  process.env.NEXT_PUBLIC_CONVEX_URL = "https://example.convex.cloud";
  process.env.NEXT_PUBLIC_LOCAL_MODE = "false";
  process.env.ARTICLE_CONTEXT_WRITE_SECRET = "context-secret";
  delete process.env.OPENAI_API_KEY;
});

afterEach(() => {
  restore("NEXT_PUBLIC_CONVEX_URL", originalEnv.convexUrl);
  restore("NEXT_PUBLIC_LOCAL_MODE", originalEnv.localMode);
  restore("OPENAI_API_KEY", originalEnv.openAiKey);
  restore("ARTICLE_CONTEXT_WRITE_SECRET", originalEnv.writeSecret);
  restore("CRON_SECRET", originalEnv.cronSecret);
  vi.unstubAllEnvs();
});

describe("published article context persistence", () => {
  it("does not reuse the cron secret for production context writes", async () => {
    vi.stubEnv("NODE_ENV", "production");
    delete process.env.ARTICLE_CONTEXT_WRITE_SECRET;
    process.env.CRON_SECRET = "cron-secret";
    const { getArticleContextWriteSecret } = await import(
      "./article-context-persistence"
    );

    expect(getArticleContextWriteSecret()).toBeNull();
  });

  it("rejects non-English input before touching the English-only durable cache", async () => {
    const { getPublishedArticleContext } = await import(
      "./article-context-persistence"
    );

    await expect(
      getPublishedArticleContext({
        wikiPageId: "42",
        title: "Example",
        revisionId: "100",
        language: "fr",
      }),
    ).rejects.toThrow("English Wikipedia only");
    expect(fetchQuery).not.toHaveBeenCalled();
    expect(fetchAction).not.toHaveBeenCalled();
  });

  it("serves a valid durable cache hit without regenerating", async () => {
    fetchQuery
      .mockResolvedValueOnce({
        manifestJson: JSON.stringify(manifest),
        sourceHash: manifest.sourceHash,
        updatedAt: Date.now(),
      })
      .mockResolvedValueOnce(null);

    const { getPublishedArticleContext } = await import(
      "./article-context-persistence"
    );
    const result = await getPublishedArticleContext({
      wikiPageId: "42",
      title: "Example",
      revisionId: "100",
      language: "en",
    });

    expect(result.cacheStatus).toBe("hit");
    expect(result.context).toEqual(manifest);
    expect(getEnhancedArticleContext).not.toHaveBeenCalled();
    expect(fetchAction).not.toHaveBeenCalled();
  });

  it("treats schema-v1 durable cache rows as inert", async () => {
    fetchQuery
      .mockResolvedValueOnce({
        manifestJson: JSON.stringify({ ...manifest, schemaVersion: 1 }),
        sourceHash: manifest.sourceHash,
        updatedAt: Date.now(),
      })
      .mockResolvedValueOnce(null);
    getEnhancedArticleContext.mockResolvedValue({
      context: manifest,
      cacheStatus: "miss",
    });

    const { getPublishedArticleContext } = await import(
      "./article-context-persistence"
    );
    const result = await getPublishedArticleContext({
      wikiPageId: "42",
      title: "Example",
      revisionId: "100",
    });

    expect(result.context.schemaVersion).toBe(ARTICLE_CONTEXT_SCHEMA_VERSION);
    expect(getEnhancedArticleContext).toHaveBeenCalledOnce();
  });

  it("treats rows from an older extractor as inert and rebuilds them", async () => {
    const staleManifest = {
      ...manifest,
      extractorVersion: "2.0.0",
      blocks: manifest.blocks.map((block) => ({
        ...block,
        provenance: { ...block.provenance, extractorVersion: "2.0.0" },
      })),
    };
    fetchQuery
      .mockResolvedValueOnce({
        manifestJson: JSON.stringify(staleManifest),
        sourceHash: staleManifest.sourceHash,
        updatedAt: Date.now(),
      })
      .mockResolvedValueOnce(null);
    getEnhancedArticleContext.mockResolvedValue({
      context: manifest,
      cacheStatus: "miss",
    });

    const { getPublishedArticleContext } = await import(
      "./article-context-persistence"
    );
    const result = await getPublishedArticleContext({
      wikiPageId: "42",
      title: "Example",
      revisionId: "100",
    });

    expect(fetchQuery).toHaveBeenNthCalledWith(
      1,
      expect.anything(),
      expect.objectContaining({
        extractorVersion: ARTICLE_CONTEXT_EXTRACTOR_VERSION,
      }),
    );
    expect(result.context.extractorVersion).toBe(
      ARTICLE_CONTEXT_EXTRACTOR_VERSION,
    );
    expect(getEnhancedArticleContext).toHaveBeenCalledOnce();
  });

  it("persists a generated miss with the server secret", async () => {
    fetchQuery.mockResolvedValueOnce(null).mockResolvedValueOnce(null);
    getEnhancedArticleContext.mockResolvedValue({
      context: manifest,
      cacheStatus: "miss",
    });
    fetchAction.mockResolvedValue({ created: true });

    const { getPublishedArticleContext } = await import(
      "./article-context-persistence"
    );
    const result = await getPublishedArticleContext({
      wikiPageId: "42",
      title: "Example",
      revisionId: "100",
      language: "en",
    });

    expect(result.cacheStatus).toBe("miss");
    expect(fetchAction).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({
        adminSecret: "context-secret",
        sourceHash: "abc123",
        manifestJson: JSON.stringify(manifest),
      }),
    );
  });

  it("applies owner text overrides at read time", async () => {
    fetchQuery
      .mockResolvedValueOnce({
        manifestJson: JSON.stringify(manifest),
        sourceHash: manifest.sourceHash,
        updatedAt: Date.now(),
      })
      .mockResolvedValueOnce({
        mode: "override",
        override: { caption: "Owner-reviewed visual caption." },
        updatedAt: Date.UTC(2026, 6, 13),
      });

    const { getPublishedArticleContext } = await import(
      "./article-context-persistence"
    );
    const result = await getPublishedArticleContext({
      wikiPageId: "42",
      title: "Example",
      revisionId: "100",
    });

    expect(result.context.blocks[0]?.caption).toBe(
      "Owner-reviewed visual caption.",
    );
    expect(result.context.blocks[0]?.provenance).toMatchObject({
      editorialOverride: { kind: "owner-accessibility-copy" },
    });
  });

  it("maps legacy takeaway moderation to caption and ignores spokenSummary", async () => {
    fetchQuery
      .mockResolvedValueOnce({
        manifestJson: JSON.stringify(manifest),
        sourceHash: manifest.sourceHash,
        updatedAt: Date.now(),
      })
      .mockResolvedValueOnce({
        mode: "override",
        override: {
          takeaway: "Owner-reviewed legacy caption.",
          spokenSummary: "Do not reintroduce context audio.",
        },
        updatedAt: Date.UTC(2026, 6, 13),
      });

    const { getPublishedArticleContext } = await import(
      "./article-context-persistence"
    );
    const result = await getPublishedArticleContext({
      wikiPageId: "42",
      title: "Example",
      revisionId: "100",
    });

    expect(result.context.blocks[0]?.caption).toBe(
      "Owner-reviewed legacy caption.",
    );
    expect(result.context.blocks[0]).not.toHaveProperty("spokenSummary");
  });

  it("removes a suppressed block", async () => {
    fetchQuery
      .mockResolvedValueOnce({
        manifestJson: JSON.stringify(manifest),
        sourceHash: manifest.sourceHash,
        updatedAt: Date.now(),
      })
      .mockResolvedValueOnce({ mode: "suppress", updatedAt: Date.now() });

    const { getPublishedArticleContext } = await import(
      "./article-context-persistence"
    );
    const result = await getPublishedArticleContext({
      wikiPageId: "42",
      title: "Example",
      revisionId: "100",
    });

    expect(result.context.blocks).toEqual([]);
  });
});
