import { afterEach, describe, expect, it, vi } from "vitest";
import type OpenAI from "openai";
import {
  enhanceArticleContextManifest,
  isArticleContextAIEnabled,
} from "./article-context-ai";
import type { ContextManifest } from "./article-context-types";

const manifest: ContextManifest = {
  schemaVersion: 1,
  wikiPageId: "42",
  title: "Example",
  revisionId: "100",
  language: "en",
  sourceHash: "hash",
  extractorVersion: "1.0.0",
  generatedAt: "2026-07-13T00:00:00.000Z",
  blocks: [
    {
      id: "timeline-1",
      kind: "timeline",
      title: "A short chronology",
      takeaway: "Two dated events are shown.",
      spokenSummary: "The first event was in 1969 and the second in 1972.",
      longDescription: "In chronological order: launch in 1969, then return in 1972.",
      section: { index: "1", title: "History" },
      order: 0,
      sources: [
        {
          label: "Wikipedia revision",
          url: "https://en.wikipedia.org/w/index.php?oldid=100",
          accessedAt: "2026-07-13T00:00:00.000Z",
        },
      ],
      provenance: {
        articleUrl: "https://en.wikipedia.org/wiki/Example",
        articleRevisionUrl:
          "https://en.wikipedia.org/w/index.php?title=Example&oldid=100",
        sourceHash: "hash",
        extractorVersion: "1.0.0",
        descriptionMethod: "deterministic",
      },
      timeline: {
        chronological: true,
        events: [
          {
            id: "event-1",
            label: "Launch",
            start: {
              display: "1969",
              iso: "1969",
              sortKey: 1969,
              precision: "year",
            },
          },
          {
            id: "event-2",
            label: "Return",
            start: {
              display: "1972",
              iso: "1972",
              sortKey: 1972,
              precision: "year",
            },
          },
        ],
      },
    },
  ],
};

const originalApiKey = process.env.OPENAI_API_KEY;
const originalEnabled = process.env.ARTICLE_CONTEXT_AI_ENABLED;

afterEach(() => {
  if (originalApiKey === undefined) delete process.env.OPENAI_API_KEY;
  else process.env.OPENAI_API_KEY = originalApiKey;
  if (originalEnabled === undefined) delete process.env.ARTICLE_CONTEXT_AI_ENABLED;
  else process.env.ARTICLE_CONTEXT_AI_ENABLED = originalEnabled;
  vi.restoreAllMocks();
});

const clientWith = (outputParsed: unknown) =>
  ({
    responses: {
      parse: vi.fn(async () => ({ output_parsed: outputParsed })),
    },
  }) as unknown as Pick<OpenAI, "responses">;

describe("article context AI descriptions", () => {
  it("keeps deterministic copy when OpenAI is not configured", async () => {
    delete process.env.OPENAI_API_KEY;
    expect(isArticleContextAIEnabled()).toBe(false);
    await expect(enhanceArticleContextManifest(manifest)).resolves.toBe(manifest);
  });

  it("requires an explicit production opt-in", () => {
    process.env.OPENAI_API_KEY = "test-key";
    delete process.env.ARTICLE_CONTEXT_AI_ENABLED;
    expect(isArticleContextAIEnabled()).toBe(false);
    process.env.ARTICLE_CONTEXT_AI_ENABLED = "true";
    expect(isArticleContextAIEnabled()).toBe(true);
  });

  it("keeps deterministic copy when the distributed allowance is exhausted", async () => {
    process.env.OPENAI_API_KEY = "test-key";
    process.env.ARTICLE_CONTEXT_AI_ENABLED = "true";
    const consumeQuota = vi.fn(async () => false);

    const unchanged = await enhanceArticleContextManifest(manifest, {
      consumeQuota,
    });

    expect(unchanged).toBe(manifest);
    expect(consumeQuota).toHaveBeenCalledOnce();
  });

  it("accepts copy-only enhancement and records provenance", async () => {
    const client = clientWith({
      blocks: [
        {
          id: "timeline-1",
          takeaway: "Two milestones span 1969 to 1972.",
          spokenSummary: "Launch came in 1969, followed by return in 1972.",
          longDescription:
            "The chronology begins with launch in 1969 and ends with return in 1972.",
        },
      ],
    });
    const enhanced = await enhanceArticleContextManifest(manifest, {
      client,
      model: "gpt-5.6-luna",
    });

    expect(client.responses.parse).toHaveBeenCalledWith(
      expect.anything(),
      { timeout: 20_000 },
    );

    expect(enhanced.blocks[0]?.takeaway).toContain("1969");
    expect(enhanced.blocks[0]?.provenance).toMatchObject({
      descriptionMethod: "ai-assisted",
      model: "gpt-5.6-luna",
      promptVersion: "context-accessibility-v2",
    });
  });

  it("rejects an invented number", async () => {
    const enhanced = await enhanceArticleContextManifest(manifest, {
      client: clientWith({
        blocks: [
          {
            id: "timeline-1",
            takeaway: "Three milestones are shown.",
            spokenSummary: "An extra milestone appeared in 1975.",
            longDescription: "Events occurred in 1969, 1972, and 1975.",
          },
        ],
      }),
    });

    expect(enhanced).toBe(manifest);
  });

  it("does not accept a revision identifier as a content fact", async () => {
    const enhanced = await enhanceArticleContextManifest(manifest, {
      client: clientWith({
        blocks: [
          {
            id: "timeline-1",
            takeaway: "A milestone happened in 100.",
            spokenSummary: "The chronology starts in 100.",
            longDescription: "The source chronology records the year 100.",
          },
        ],
      }),
    });

    expect(enhanced).toBe(manifest);
  });

  it("does not borrow a valid number from another context block", async () => {
    const secondBlock = structuredClone(manifest.blocks[0]!);
    secondBlock.id = "timeline-2";
    secondBlock.title = "A separate chronology";
    if (secondBlock.kind !== "timeline") throw new Error("Expected timeline fixture");
    secondBlock.takeaway = "One milestone is shown in 1984.";
    secondBlock.spokenSummary = "The separate event happened in 1984.";
    secondBlock.longDescription = "This chronology contains an event in 1984.";
    secondBlock.timeline.events = [
      {
        id: "event-1984",
        label: "Separate event",
        start: {
          display: "1984",
          iso: "1984",
          sortKey: 1984,
          precision: "year",
        },
      },
    ];
    const twoBlockManifest = {
      ...manifest,
      blocks: [manifest.blocks[0]!, secondBlock],
    };

    const enhanced = await enhanceArticleContextManifest(twoBlockManifest, {
      client: clientWith({
        blocks: [
          {
            id: "timeline-1",
            takeaway: "Two milestones span 1969 to 1984.",
            spokenSummary: "Launch came in 1969, followed by return in 1984.",
            longDescription:
              "The first chronology begins in 1969 and ends in 1984.",
          },
          {
            id: "timeline-2",
            takeaway: "One milestone is shown in 1984.",
            spokenSummary: "The separate event happened in 1984.",
            longDescription: "This chronology contains an event in 1984.",
          },
        ],
      }),
    });

    expect(enhanced).toBe(twoBlockManifest);
  });

  it("falls back when the model omits a block", async () => {
    const enhanced = await enhanceArticleContextManifest(manifest, {
      client: clientWith({ blocks: [] }),
    });
    expect(enhanced).toBe(manifest);
  });
});
