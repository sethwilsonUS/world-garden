import { afterEach, describe, expect, it, vi } from "vitest";
import { getFunctionName } from "convex/server";
import {
  buildTrendingBriefPrompt,
  extractTrendingBriefSources,
  generateTrendingBriefContent,
  getCachedTrendingBriefContent,
  getDailyTrendingBriefState,
  getTrendingAudioCacheKey,
  getTrendingAudioScript,
  getTrendingBriefGenerationProfile,
  getTrendingBriefModel,
  getTrendingBriefPromptVersion,
  hasCurrentTrendingArtworkVersion,
  isTrendingBriefEnabled,
  mergeTrendingBriefSourceGroups,
  normalizeTrendingBrief,
  selectTrendingArtworkItems,
  shouldReuseExistingTrendingBrief,
  syncDailyTrendingBrief,
  TRENDING_BRIEF_OPENAI_REQUEST_TIMEOUT_MS,
} from "./trending-brief";
import { getTrendingTtsProfile } from "./trending-audio-profile";
import { renderTrendingPodcastArtworkPng } from "./trending-podcast-artwork";
import { verifyPublicAudioWriteAttestation } from "./public-audio-write-attestation";
import {
  createInstrumentedOpenAiFetch,
  getOpenAIClient,
} from "./openai-client";
import type { AiCostProviderAttempt } from "./ai-cost-ledger-contract";
import { TTS_AI_COST_SOURCE_HEADER } from "./tts-source-attestation";
import { TTS_QUOTA_BYPASS_HEADER } from "./tts-quota-bypass";

vi.mock("convex/nextjs", () => ({
  fetchMutation: vi.fn(),
  fetchQuery: vi.fn(async () => null),
}));

vi.mock("@/lib/today-snapshot", () => ({
  getTodayWikipediaData: vi.fn(async () => ({
    feedDate: "2026-03-11",
    snapshotIsStale: false,
    trending: [
      {
        title: "Example Trend",
        extract: "A trending article.",
        views: 12345,
      },
    ],
    trendingDate: "2026-03-11",
    trendingIsStale: false,
  })),
}));

vi.mock("@/lib/trending-podcast-artwork", async (importOriginal) => {
  const actual =
    await importOriginal<typeof import("./trending-podcast-artwork")>();
  return {
    ...actual,
    renderTrendingPodcastArtworkPng: vi.fn(
      actual.renderTrendingPodcastArtworkPng,
    ),
  };
});

vi.mock("@/lib/openai-client", async (importOriginal) => {
  const actual = await importOriginal<typeof import("./openai-client")>();
  return {
    ...actual,
    getOpenAIClient: vi.fn(actual.getOpenAIClient),
  };
});

const originalOpenAiApiKey = process.env.OPENAI_API_KEY;
const originalAiGatewayApiKey = process.env.AI_GATEWAY_API_KEY;
const originalConvexUrl = process.env.NEXT_PUBLIC_CONVEX_URL;
const originalLocalMode = process.env.NEXT_PUBLIC_LOCAL_MODE;
const originalTrendingBriefModel = process.env.TRENDING_BRIEF_MODEL;
const trendingTtsProfile = getTrendingTtsProfile();
const currentTrendingContentMetadata = {
  model: getTrendingBriefModel(),
  briefPromptVersion: getTrendingBriefPromptVersion(),
};
const currentTrendingAudioMetadata = {
  provider: trendingTtsProfile.provider,
  ttsModel: trendingTtsProfile.model,
  voiceId: trendingTtsProfile.voiceId,
  promptVersion: trendingTtsProfile.promptVersion,
  ttsNormVersion: trendingTtsProfile.ttsNormVersion,
  ttsCacheKey: getTrendingAudioCacheKey(),
  ...currentTrendingContentMetadata,
};

const restoreEnvValue = (key: string, value: string | undefined) => {
  if (value === undefined) {
    delete process.env[key];
  } else {
    process.env[key] = value;
  }
};

afterEach(async () => {
  const { fetchMutation, fetchQuery } = await import("convex/nextjs");
  vi.mocked(fetchMutation).mockClear();
  vi.mocked(fetchQuery).mockClear();
  vi.mocked(renderTrendingPodcastArtworkPng).mockReset();
  vi.mocked(getOpenAIClient).mockReset();
  restoreEnvValue("OPENAI_API_KEY", originalOpenAiApiKey);
  restoreEnvValue("AI_GATEWAY_API_KEY", originalAiGatewayApiKey);
  restoreEnvValue("NEXT_PUBLIC_CONVEX_URL", originalConvexUrl);
  restoreEnvValue("NEXT_PUBLIC_LOCAL_MODE", originalLocalMode);
  restoreEnvValue("TRENDING_BRIEF_MODEL", originalTrendingBriefModel);
  vi.restoreAllMocks();
  vi.useRealTimers();
  vi.unstubAllGlobals();
  vi.unstubAllEnvs();
});

describe("normalizeTrendingBrief", () => {
  it("dedupes sources, trims fields, and strips URLs from spoken text", () => {
    const brief = normalizeTrendingBrief({
      headline: "  Big day on Wikipedia  ",
      summary: "  A concise summary.  ",
      podcastDescription: "  A compact podcast description.  ",
      spokenSummary: "Read more at https://example.com right now.  ",
      keyPoints: [" First point. ", "", "Second point."],
      sources: [
        { title: " Example ", url: "https://example.com " },
        { title: "Example duplicate", url: "https://example.com" },
        { title: "Second", url: "https://second.example" },
      ],
    });

    expect(brief.headline).toBe("Big day on Wikipedia");
    expect(brief.summary).toBe("A concise summary.");
    expect(brief.podcastDescription).toBe("A compact podcast description.");
    expect(brief.spokenSummary).not.toContain("https://");
    expect(brief.keyPoints).toEqual(["First point.", "Second point."]);
    expect(brief.sources).toEqual([
      { title: "Example", url: "https://example.com" },
      { title: "Second", url: "https://second.example" },
    ]);
  });

  it("round-robins capped deep-research sources across topics", () => {
    const sources = mergeTrendingBriefSourceGroups(
      [
        [
          { title: "Topic one A", url: "https://one.example/a" },
          { title: "Topic one B", url: "https://one.example/b" },
        ],
        [
          { title: "Topic two A", url: "https://two.example/a" },
          { title: "Shared", url: "https://shared.example/story" },
        ],
        [
          { title: "Topic three A", url: "https://three.example/a" },
          {
            title: "Shared tracked duplicate",
            url: "https://shared.example/story?sfmc_id=123&utm_source=openai",
          },
        ],
      ],
      5,
    );

    expect(sources).toEqual([
      { title: "Topic one A", url: "https://one.example/a" },
      { title: "Topic two A", url: "https://two.example/a" },
      { title: "Topic three A", url: "https://three.example/a" },
      { title: "Topic one B", url: "https://one.example/b" },
      { title: "Shared", url: "https://shared.example/story" },
    ]);
  });
});

describe("buildTrendingBriefPrompt", () => {
  it("includes the trending date and article context", () => {
    const prompt = buildTrendingBriefPrompt({
      trendingDate: "2026-03-08",
      articles: [
        {
          title: "Example Topic",
          extract: "An example extract.",
          views: 12345,
        },
      ],
    });

    expect(prompt).toContain("2026-03-08");
    expect(prompt).toContain("Example Topic");
    expect(prompt).toContain("12,345 views");
    expect(prompt).toContain("response schema is enforced separately");
  });

  it("defines the depth-writing contract without losing quieter topics", () => {
    const prompt = buildTrendingBriefPrompt({
      trendingDate: "2026-08-24",
      profile: "depth-writing",
      articles: Array.from({ length: 10 }, (_, index) => ({
        title: `Topic ${index + 1}`,
        extract: `Context for topic ${index + 1}.`,
        views: 10_000 - index,
      })),
    });

    expect(prompt).toContain("300-420 words");
    expect(prompt).toContain("Account for all 10 topics");
    expect(prompt).toContain("supported trigger");
    expect(prompt).toContain("relevant background");
    expect(prompt).toContain("why now");
    expect(prompt).toContain("cause is uncertain");
  });
});

describe("selectTrendingArtworkItems", () => {
  it("keeps title and thumbnail pairs aligned and skips articles without thumbnails", () => {
    expect(
      selectTrendingArtworkItems([
        { title: "One", imageUrl: "1.png" },
        { title: "Two" },
        { title: "Three", imageUrl: "3.png" },
        { title: "Four", imageUrl: "" },
        { title: "Five", imageUrl: "5.png" },
      ]),
    ).toEqual([
      { title: "One", imageUrl: "1.png" },
      { title: "Three", imageUrl: "3.png" },
      { title: "Five", imageUrl: "5.png" },
    ]);
  });
});

describe("cached trending brief reuse", () => {
  it("extracts cached generated content when a brief already has summary fields", () => {
    expect(
      getCachedTrendingBriefContent({
        _id: "brief-1",
        trendingDate: "2026-03-11",
        status: "failed",
        headline: "Cached headline",
        summary: "Cached summary",
        podcastDescription: "Cached podcast description",
        spokenSummary: "Cached spoken summary",
        keyPoints: ["Point one"],
        sources: [{ title: "Reuters", url: "https://reuters.com" }],
        audioUrl: null,
        updatedAt: Date.now(),
      } as Parameters<typeof getCachedTrendingBriefContent>[0]),
    ).toEqual({
      headline: "Cached headline",
      summary: "Cached summary",
      podcastDescription: "Cached podcast description",
      spokenSummary: "Cached spoken summary",
      keyPoints: ["Point one"],
      sources: [{ title: "Reuters", url: "https://reuters.com" }],
    });
  });

  it("does not treat incomplete records as cached generated content", () => {
    expect(
      getCachedTrendingBriefContent({
        _id: "brief-1",
        trendingDate: "2026-03-11",
        status: "failed",
        headline: "Missing the rest",
        audioUrl: null,
        updatedAt: Date.now(),
      } as Parameters<typeof getCachedTrendingBriefContent>[0]),
    ).toBeNull();
  });

  it("does not reuse cached prose from a different model or prompt version", () => {
    const record = {
      _id: "brief-1",
      trendingDate: "2026-08-24",
      status: "ready" as const,
      headline: "Cached headline",
      summary: "Cached summary",
      podcastDescription: "Cached podcast description",
      spokenSummary: "Cached spoken summary",
      keyPoints: ["One", "Two", "Three"],
      sources: [{ title: "Reuters", url: "https://reuters.com" }],
      model: "gpt-5.6-luna",
      briefPromptVersion: "old-prompt",
      audioUrl: "https://cdn.example.com/brief.mp3",
      updatedAt: Date.now(),
    };

    expect(
      getCachedTrendingBriefContent(record, {
        model: "gpt-5.6-terra",
        briefPromptVersion: "new-prompt",
      }),
    ).toBeNull();
  });

  it("always reuses an existing ready brief, even if a force sync was requested", () => {
    expect(
      shouldReuseExistingTrendingBrief({
        _id: "brief-1",
        trendingDate: "2026-03-11",
        status: "ready",
        audioUrl: "https://cdn.example.com/brief.mp3",
        artworkVersion: 2,
        ...currentTrendingAudioMetadata,
        updatedAt: Date.now(),
      } as Parameters<typeof shouldReuseExistingTrendingBrief>[0]),
    ).toBe(true);
  });

  it("does not reuse when regenArt is requested for an older artwork version", () => {
    expect(
      shouldReuseExistingTrendingBrief(
        {
          _id: "brief-1",
          trendingDate: "2026-03-11",
          status: "ready",
          audioUrl: "https://cdn.example.com/brief.mp3",
          artworkVersion: 1,
          ...currentTrendingAudioMetadata,
          updatedAt: Date.now(),
        } as Parameters<typeof shouldReuseExistingTrendingBrief>[0],
        { regenArt: true },
      ),
    ).toBe(false);
  });

  it("reuses when regenArt is requested and artwork is already current", () => {
    expect(
      shouldReuseExistingTrendingBrief(
        {
          _id: "brief-1",
          trendingDate: "2026-03-11",
          status: "ready",
          audioUrl: "https://cdn.example.com/brief.mp3",
          artworkVersion: 2,
          ...currentTrendingAudioMetadata,
          updatedAt: Date.now(),
        } as Parameters<typeof shouldReuseExistingTrendingBrief>[0],
        { regenArt: true },
      ),
    ).toBe(true);
  });

  it("does not reuse when force and regenArt are both requested", () => {
    expect(
      shouldReuseExistingTrendingBrief(
        {
          _id: "brief-1",
          trendingDate: "2026-03-11",
          status: "ready",
          audioUrl: "https://cdn.example.com/brief.mp3",
          artworkVersion: 2,
          ...currentTrendingAudioMetadata,
          updatedAt: Date.now(),
        } as Parameters<typeof shouldReuseExistingTrendingBrief>[0],
        { force: true, regenArt: true },
      ),
    ).toBe(false);
  });

  it("does not reuse ready audio from a different TTS cache key", () => {
    expect(
      shouldReuseExistingTrendingBrief({
        _id: "brief-1",
        trendingDate: "2026-03-11",
        status: "ready",
        audioUrl: "https://cdn.example.com/brief.mp3",
        artworkVersion: 2,
        ...currentTrendingAudioMetadata,
        ttsCacheKey:
          "tts:edge:edge-tts:en-US-AriaNeural:edge-default:ttsNorm:3",
        updatedAt: Date.now(),
      } as Parameters<typeof shouldReuseExistingTrendingBrief>[0]),
    ).toBe(false);
  });

  it("does not reuse ready audio generated by an older content prompt", () => {
    expect(
      shouldReuseExistingTrendingBrief({
        _id: "brief-1",
        trendingDate: "2026-08-24",
        status: "ready",
        audioUrl: "https://cdn.example.com/brief.mp3",
        artworkVersion: 2,
        ...currentTrendingAudioMetadata,
        briefPromptVersion: "trending-brief-control-v0",
        updatedAt: Date.now(),
      } as Parameters<typeof shouldReuseExistingTrendingBrief>[0]),
    ).toBe(false);
  });

  it("invalidates incompatible ready audio when its Mini replacement fails", async () => {
    process.env.OPENAI_API_KEY = "openai-key";
    vi.stubEnv("TTS_QUOTA_BYPASS_SECRET", "server-secret");
    vi.spyOn(console, "info").mockImplementation(() => undefined);
    vi.spyOn(console, "error").mockImplementation(() => undefined);
    vi.mocked(renderTrendingPodcastArtworkPng).mockResolvedValueOnce({
      data: Uint8Array.of(1, 2, 3),
      mimeType: "image/jpeg",
    });
    let persisted: Record<string, unknown> & {
      status: string;
      storageId: string;
      ttsCacheKey: string;
      audioUrl: string | null;
    } = {
      _id: "brief-1",
      trendingDate: "2026-03-11",
      status: "ready",
      headline: "Existing headline",
      summary: "Existing summary",
      podcastDescription: "Existing podcast description",
      spokenSummary: "Existing spoken summary",
      keyPoints: ["One", "Two", "Three"],
      articleTitles: ["Example Trend"],
      sources: [{ title: "Example", url: "https://example.com" }],
      audioUrl: "https://cdn.example.com/openai.mp3",
      storageId: "openai-storage",
      ...currentTrendingAudioMetadata,
      ttsCacheKey: trendingTtsProfile.ttsCacheKey,
      updatedAt: Date.now(),
    };
    const { fetchMutation, fetchQuery } = await import("convex/nextjs");
    vi.mocked(fetchQuery).mockImplementation(async () => persisted as never);
    vi.mocked(fetchMutation).mockImplementation(async (...callArgs) => {
      const [reference, args] = callArgs;
      const functionName = getFunctionName(reference);
      if (functionName === "trending:claimTrendingBriefJob") {
        return { claimed: true } as never;
      }
      if (functionName === "trending:saveTrendingBrief") {
        persisted = {
          ...persisted,
          ...((args ?? {}) as object),
          audioUrl: (args as { storageId?: string }).storageId
            ? "https://cdn.example.com/replacement.mp3"
            : null,
          updatedAt: Date.now(),
        };
      }
      if (functionName === "trending:finalizeTrendingBriefJob") {
        return { updated: true } as never;
      }
      return undefined as never;
    });
    const ttsRequests: Array<{
      provider?: string;
      voiceId?: string;
      fallbackPolicy?: string;
      expectedTtsCacheKey?: string;
    }> = [];
    vi.stubGlobal(
      "fetch",
      vi.fn(async (_input: RequestInfo | URL, init?: RequestInit) => {
        ttsRequests.push(
          JSON.parse(String(init?.body)) as {
            provider?: string;
            voiceId?: string;
            fallbackPolicy?: string;
            expectedTtsCacheKey?: string;
          },
        );
        return Response.json({ error: "speech unavailable" }, { status: 503 });
      }),
    );

    await expect(
      syncDailyTrendingBrief({ baseUrl: "https://curiogarden.org" }),
    ).rejects.toThrow("speech unavailable");

    expect(ttsRequests).toEqual([
      expect.objectContaining({
        provider: "openai",
        voiceId: "marin",
        fallbackPolicy: "forbid",
        expectedTtsCacheKey: trendingTtsProfile.ttsCacheKey,
      }),
    ]);
    expect(persisted).toMatchObject({
      status: "failed",
      audioUrl: null,
    });

    const operationByFunction = {
      "trending:claimTrendingBriefJob": "claim-job",
      "trending:finalizeTrendingBriefJob": "finalize-job",
    } as const;
    const publicationCalls = vi
      .mocked(fetchMutation)
      .mock.calls.filter(([reference]) =>
        Object.hasOwn(operationByFunction, getFunctionName(reference)),
      );
    await expect(
      Promise.all(
        publicationCalls.map(async ([reference, callArgs]) => {
          const functionName = getFunctionName(
            reference,
          ) as keyof typeof operationByFunction;
          const { attestation, ...writeArgs } = (callArgs ?? {}) as Record<
            string,
            unknown
          > & { attestation?: never };
          return await verifyPublicAudioWriteAttestation({
            pipeline: "trending",
            operation: operationByFunction[functionName],
            args: writeArgs,
            attestation,
            secret: "server-secret",
          });
        }),
      ),
    ).resolves.toEqual([true, true]);
  });

  it("attests exact save and successful finalization payloads when reusing assets", async () => {
    vi.stubEnv("OPENAI_API_KEY", "openai-key");
    vi.stubEnv("TTS_QUOTA_BYPASS_SECRET", "server-secret");
    vi.spyOn(console, "info").mockImplementation(() => undefined);
    let persisted: Record<string, unknown> & {
      status: string;
      audioUrl: string | null;
    } = {
      _id: "brief-1",
      trendingDate: "2026-03-11",
      status: "failed",
      headline: "Cached headline",
      summary: "Cached summary",
      podcastDescription: "Cached description",
      spokenSummary: "Cached spoken summary",
      keyPoints: ["One", "Two", "Three"],
      articleTitles: ["Example Trend"],
      sources: [{ title: "Example", url: "https://example.com" }],
      storageId: "edge-storage",
      artworkStorageId: "artwork-storage",
      durationSeconds: 42,
      byteLength: 4_200,
      ...currentTrendingAudioMetadata,
      audioUrl: null,
      updatedAt: Date.now(),
    };
    const { fetchMutation, fetchQuery } = await import("convex/nextjs");
    vi.mocked(fetchQuery).mockImplementation(async () => persisted as never);
    vi.mocked(fetchMutation).mockImplementation(async (...callArgs) => {
      const [reference, args] = callArgs;
      const functionName = getFunctionName(reference);
      if (functionName === "trending:claimTrendingBriefJob") {
        return { claimed: true } as never;
      }
      if (functionName === "trending:saveTrendingBrief") {
        persisted = {
          ...persisted,
          ...((args ?? {}) as object),
          audioUrl:
            (args as { status?: string }).status === "ready"
              ? "https://cdn.example.com/edge.mp3"
              : persisted.audioUrl,
          updatedAt: Date.now(),
        };
        return "brief-1" as never;
      }
      if (functionName === "trending:finalizeTrendingBriefJob") {
        return { updated: true } as never;
      }
      throw new Error(`Unexpected mutation: ${functionName}`);
    });

    await expect(
      syncDailyTrendingBrief({ baseUrl: "https://curiogarden.org" }),
    ).resolves.toMatchObject({ status: "created" });
    expect(renderTrendingPodcastArtworkPng).not.toHaveBeenCalled();

    const operationByFunction = {
      "trending:claimTrendingBriefJob": "claim-job",
      "trending:saveTrendingBrief": "save-record",
      "trending:finalizeTrendingBriefJob": "finalize-job",
    } as const;
    const validity = await Promise.all(
      vi.mocked(fetchMutation).mock.calls.map(async ([reference, callArgs]) => {
        const functionName = getFunctionName(
          reference,
        ) as keyof typeof operationByFunction;
        const { attestation, ...writeArgs } = (callArgs ?? {}) as Record<
          string,
          unknown
        > & { attestation?: never };
        return await verifyPublicAudioWriteAttestation({
          pipeline: "trending",
          operation: operationByFunction[functionName],
          args: writeArgs,
          attestation,
          secret: "server-secret",
        });
      }),
    );
    expect(validity).toEqual([true, true, true, true]);
  });

  it("attests both upload URL requests before publishing new Mini assets", async () => {
    vi.stubEnv("OPENAI_API_KEY", "openai-key");
    vi.stubEnv("AI_COST_LEDGER_MODE", "observe");
    vi.stubEnv("TTS_QUOTA_BYPASS_SECRET", "server-secret");
    vi.spyOn(console, "info").mockImplementation(() => undefined);
    vi.mocked(renderTrendingPodcastArtworkPng).mockResolvedValueOnce({
      data: Uint8Array.of(1, 2, 3),
      mimeType: "image/png",
    });
    let persisted: Record<string, unknown> & {
      status: string;
      audioUrl: string | null;
    } = {
      _id: "brief-1",
      trendingDate: "2026-03-11",
      status: "failed",
      headline: "Cached headline",
      summary: "Cached summary",
      podcastDescription: "Cached description",
      spokenSummary: "Cached spoken summary with enough words for narration.",
      keyPoints: ["One", "Two", "Three"],
      articleTitles: ["Example Trend"],
      sources: [{ title: "Example", url: "https://example.com" }],
      ...currentTrendingContentMetadata,
      audioUrl: null,
      updatedAt: Date.now(),
    };
    const { fetchMutation, fetchQuery } = await import("convex/nextjs");
    vi.mocked(fetchQuery).mockImplementation(async () => persisted as never);
    let uploadUrlCount = 0;
    vi.mocked(fetchMutation).mockImplementation(async (...callArgs) => {
      const [reference, args] = callArgs;
      const functionName = getFunctionName(reference);
      if (functionName === "trending:claimTrendingBriefJob") {
        return { claimed: true } as never;
      }
      if (functionName === "trending:generateUploadUrl") {
        uploadUrlCount += 1;
        return `https://upload.example/${uploadUrlCount}` as never;
      }
      if (functionName === "trending:saveTrendingBrief") {
        persisted = {
          ...persisted,
          ...((args ?? {}) as object),
          audioUrl:
            (args as { status?: string }).status === "ready"
              ? "https://cdn.example.com/edge.mp3"
              : persisted.audioUrl,
          updatedAt: Date.now(),
        };
        return "brief-1" as never;
      }
      if (functionName === "trending:finalizeTrendingBriefJob") {
        return { updated: true } as never;
      }
      throw new Error(`Unexpected mutation: ${functionName}`);
    });
    const ttsSources: Array<string | null> = [];
    const quotaBypassHeaders: Array<string | null> = [];
    vi.stubGlobal(
      "fetch",
      vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
        const url = String(input);
        if (url === "https://curiogarden.org/api/tts") {
          const headers = new Headers(init?.headers);
          ttsSources.push(headers.get(TTS_AI_COST_SOURCE_HEADER));
          quotaBypassHeaders.push(headers.get(TTS_QUOTA_BYPASS_HEADER));
          return new Response(Uint8Array.of(0xff, 0xfb, 0x90, 0x64), {
            status: 200,
            headers: { "Content-Type": "audio/mpeg" },
          });
        }
        if (url.startsWith("https://upload.example/")) {
          return Response.json({
            storageId: url.endsWith("/1") ? "audio-storage" : "artwork-storage",
          });
        }
        throw new Error(`Unexpected fetch: ${url}`);
      }),
    );

    await expect(
      syncDailyTrendingBrief({ baseUrl: "https://curiogarden.org" }),
    ).resolves.toMatchObject({ status: "created" });
    expect(ttsSources).toEqual(["trending_podcast"]);
    expect(quotaBypassHeaders).toEqual([expect.any(String)]);

    const readySaveArgs = vi
      .mocked(fetchMutation)
      .mock.calls.find(
        ([reference, args]) =>
          getFunctionName(reference) === "trending:saveTrendingBrief" &&
          (args as { status?: string }).status === "ready",
      )?.[1] as Record<string, unknown> | undefined;
    expect(readySaveArgs).toMatchObject({
      ledgerAssetKey: expect.any(String),
      ledgerGeneratedAt: expect.any(Number),
    });

    const operationByFunction = {
      "trending:claimTrendingBriefJob": "claim-job",
      "trending:saveTrendingBrief": "save-record",
      "trending:generateUploadUrl": "generate-upload-url",
      "trending:finalizeTrendingBriefJob": "finalize-job",
    } as const;
    const validity = await Promise.all(
      vi.mocked(fetchMutation).mock.calls.map(async ([reference, callArgs]) => {
        const functionName = getFunctionName(
          reference,
        ) as keyof typeof operationByFunction;
        const { attestation, ...writeArgs } = (callArgs ?? {}) as Record<
          string,
          unknown
        > & { attestation?: never };
        return await verifyPublicAudioWriteAttestation({
          pipeline: "trending",
          operation: operationByFunction[functionName],
          args: writeArgs,
          attestation,
          secret: "server-secret",
        });
      }),
    );
    expect(validity).toEqual([true, true, true, true, true, true]);
  });

  it("persists freshly generated prose after TTS failure and reuses it on retry", async () => {
    vi.stubEnv("OPENAI_API_KEY", "openai-key");
    vi.stubEnv("TTS_QUOTA_BYPASS_SECRET", "server-secret");
    vi.spyOn(console, "info").mockImplementation(() => undefined);
    vi.spyOn(console, "error").mockImplementation(() => undefined);
    vi.mocked(renderTrendingPodcastArtworkPng).mockResolvedValue({
      data: Uint8Array.of(1, 2, 3),
      mimeType: "image/png",
    });

    const research = vi.fn(async () => ({
      model: "gpt-5.6-luna",
      output_text: [
        "Trigger: A supported recent event.",
        "Timeline: The event happened this week.",
        "Background: Relevant context.",
        "Confidence: High.",
        "Uncertainty: None material.",
      ].join("\n"),
      output: [
        {
          type: "web_search_call",
          action: {
            sources: [{ url: "https://news.example.com/trending" }],
          },
        },
      ],
      usage: null,
    }));
    const spokenSummary = Array.from(
      { length: 320 },
      (_, index) => `word${index + 1}`,
    ).join(" ");
    const writing = vi.fn(async () => ({
      model: "gpt-5.6-luna",
      output_parsed: {
        headline: "Freshly researched headline",
        summary: "Freshly researched summary.",
        podcastDescription: "Freshly researched description.",
        spokenSummary,
        keyPoints: ["One", "Two", "Three"],
      },
      usage: null,
    }));
    const openAiClient = {
      responses: { create: research, parse: writing },
    } as unknown as ReturnType<typeof getOpenAIClient>;
    vi.mocked(getOpenAIClient).mockReturnValue(openAiClient);

    type PersistedBrief = Record<string, unknown> & {
      status: string;
      audioUrl: string | null;
    };
    let persisted: PersistedBrief | null = null;
    const saveCalls: Array<Record<string, unknown>> = [];
    let uploadUrlCount = 0;
    const { fetchMutation, fetchQuery } = await import("convex/nextjs");
    vi.mocked(fetchQuery).mockImplementation(async () => persisted as never);
    vi.mocked(fetchMutation).mockImplementation(async (...callArgs) => {
      const [reference, rawArgs] = callArgs;
      const functionName = getFunctionName(reference);
      const args = (rawArgs ?? {}) as Record<string, unknown>;
      if (functionName === "trending:claimTrendingBriefJob") {
        return { claimed: true } as never;
      }
      if (functionName === "trending:generateUploadUrl") {
        uploadUrlCount += 1;
        return `https://upload.example/${uploadUrlCount}` as never;
      }
      if (functionName === "trending:saveTrendingBrief") {
        saveCalls.push(args);
        persisted = {
          ...(persisted ?? {}),
          ...args,
          _id: "brief-1",
          audioUrl:
            args.status === "ready" && args.storageId
              ? "https://cdn.example.com/trending.mp3"
              : null,
          updatedAt: Date.now(),
        } as PersistedBrief;
        return "brief-1" as never;
      }
      if (functionName === "trending:finalizeTrendingBriefJob") {
        return { updated: true } as never;
      }
      throw new Error(`Unexpected mutation: ${functionName}`);
    });

    let ttsAttempt = 0;
    vi.stubGlobal(
      "fetch",
      vi.fn(async (input: RequestInfo | URL) => {
        const url = String(input);
        if (url === "https://curiogarden.org/api/tts") {
          ttsAttempt += 1;
          if (ttsAttempt === 1) {
            return Response.json(
              { error: "speech unavailable" },
              { status: 503 },
            );
          }
          return new Response(Uint8Array.of(0xff, 0xfb, 0x90, 0x64), {
            status: 200,
            headers: { "Content-Type": "audio/mpeg" },
          });
        }
        if (url.startsWith("https://upload.example/")) {
          return Response.json({
            storageId: url.endsWith("/1") ? "audio-storage" : "artwork-storage",
          });
        }
        throw new Error(`Unexpected fetch: ${url}`);
      }),
    );

    await expect(
      syncDailyTrendingBrief({ baseUrl: "https://curiogarden.org" }),
    ).rejects.toThrow("speech unavailable");

    expect(persisted).toMatchObject({
      status: "failed",
      headline: "Freshly researched headline",
      spokenSummary,
      model: "gpt-5.6-luna",
      briefPromptVersion: "trending-brief-deep-research-v1",
    });
    expect(getOpenAIClient).toHaveBeenCalledOnce();
    expect(research).toHaveBeenCalledOnce();
    expect(writing).toHaveBeenCalledOnce();
    expect(
      saveCalls.some(
        (args) =>
          args.status === "failed" &&
          args.headline === "Freshly researched headline",
      ),
    ).toBe(true);

    await expect(
      syncDailyTrendingBrief({ baseUrl: "https://curiogarden.org" }),
    ).resolves.toMatchObject({ status: "created" });

    expect(ttsAttempt).toBe(2);
    expect(getOpenAIClient).toHaveBeenCalledOnce();
    expect(research).toHaveBeenCalledOnce();
    expect(writing).toHaveBeenCalledOnce();
    expect(persisted).toMatchObject({
      status: "ready",
      headline: "Freshly researched headline",
      spokenSummary,
    });
  });

  it("keeps a stale-content Mini episode ready while its replacement draft survives a TTS retry", async () => {
    vi.stubEnv("OPENAI_API_KEY", "openai-key");
    vi.stubEnv("TTS_QUOTA_BYPASS_SECRET", "server-secret");
    vi.spyOn(console, "info").mockImplementation(() => undefined);
    vi.spyOn(console, "error").mockImplementation(() => undefined);
    vi.mocked(renderTrendingPodcastArtworkPng).mockResolvedValue({
      data: Uint8Array.of(1, 2, 3),
      mimeType: "image/png",
    });

    const research = vi.fn(async () => ({
      model: "gpt-5.6-luna",
      output_text: [
        "Trigger: A supported recent event.",
        "Timeline: The event happened this week.",
        "Background: Relevant context.",
        "Confidence: High.",
        "Uncertainty: None material.",
      ].join("\n"),
      output: [
        {
          type: "web_search_call",
          action: {
            sources: [{ url: "https://news.example.com/replacement" }],
          },
        },
      ],
      usage: null,
    }));
    const spokenSummary = Array.from(
      { length: 320 },
      (_, index) => `word${index + 1}`,
    ).join(" ");
    const writing = vi.fn(async () => ({
      model: "gpt-5.6-luna",
      output_parsed: {
        headline: "Replacement headline",
        summary: "Replacement summary.",
        podcastDescription: "Replacement description.",
        spokenSummary,
        keyPoints: ["One", "Two", "Three"],
      },
      usage: null,
    }));
    vi.mocked(getOpenAIClient).mockReturnValue({
      responses: { create: research, parse: writing },
    } as unknown as ReturnType<typeof getOpenAIClient>);

    type PersistedBrief = Record<string, unknown> & {
      status: string;
      audioUrl: string | null;
      draftBrief?: Record<string, unknown>;
    };
    let persisted: PersistedBrief = {
      _id: "brief-1",
      trendingDate: "2026-03-11",
      status: "ready",
      headline: "Published headline",
      summary: "Published summary.",
      podcastDescription: "Published description.",
      spokenSummary: "Published spoken summary.",
      keyPoints: ["Published one", "Published two", "Published three"],
      sources: [{ title: "Old news", url: "https://old.example/story" }],
      storageId: "published-audio",
      artworkStorageId: "published-artwork",
      artworkVersion: 2,
      durationSeconds: 60,
      byteLength: 2_048,
      audioUrl: "https://cdn.example.com/published.mp3",
      ...currentTrendingAudioMetadata,
      briefPromptVersion: "trending-brief-control-v0",
      updatedAt: Date.now(),
    };
    const mutationCalls: Array<{
      functionName: string;
      args: Record<string, unknown>;
    }> = [];
    let uploadUrlCount = 0;
    const { fetchMutation, fetchQuery } = await import("convex/nextjs");
    vi.mocked(fetchQuery).mockImplementation(async () => persisted as never);
    vi.mocked(fetchMutation).mockImplementation(async (...callArgs) => {
      const [reference, rawArgs] = callArgs;
      const functionName = getFunctionName(reference);
      const args = (rawArgs ?? {}) as Record<string, unknown>;
      mutationCalls.push({ functionName, args });
      if (functionName === "trending:claimTrendingBriefJob") {
        return { claimed: true } as never;
      }
      if (functionName === "trending:saveTrendingBriefDraft") {
        persisted = {
          ...persisted,
          draftBrief: args.draftBrief as Record<string, unknown>,
        };
        return "brief-1" as never;
      }
      if (functionName === "trending:generateUploadUrl") {
        uploadUrlCount += 1;
        return `https://upload.example/${uploadUrlCount}` as never;
      }
      if (functionName === "trending:saveTrendingBrief") {
        if (args.status !== "ready") {
          throw new Error(
            "The published record must remain ready during retry",
          );
        }
        persisted = {
          ...persisted,
          ...args,
          draftBrief: undefined,
          audioUrl: "https://cdn.example.com/replacement.mp3",
        };
        return "brief-1" as never;
      }
      if (functionName === "trending:finalizeTrendingBriefJob") {
        return { updated: true } as never;
      }
      throw new Error(`Unexpected mutation: ${functionName}`);
    });

    let ttsAttempt = 0;
    vi.stubGlobal(
      "fetch",
      vi.fn(async (input: RequestInfo | URL) => {
        const url = String(input);
        if (url === "https://curiogarden.org/api/tts") {
          ttsAttempt += 1;
          if (ttsAttempt === 1) {
            return Response.json(
              { error: "speech unavailable" },
              { status: 503 },
            );
          }
          return new Response(Uint8Array.of(0xff, 0xfb, 0x90, 0x64), {
            status: 200,
            headers: { "Content-Type": "audio/mpeg" },
          });
        }
        if (url.startsWith("https://upload.example/")) {
          return Response.json({
            storageId: url.endsWith("/1")
              ? "replacement-audio"
              : "replacement-artwork",
          });
        }
        throw new Error(`Unexpected fetch: ${url}`);
      }),
    );

    await expect(
      syncDailyTrendingBrief({ baseUrl: "https://curiogarden.org" }),
    ).rejects.toThrow("speech unavailable");

    expect(persisted).toMatchObject({
      status: "ready",
      headline: "Published headline",
      storageId: "published-audio",
      audioUrl: "https://cdn.example.com/published.mp3",
      draftBrief: {
        headline: "Replacement headline",
        spokenSummary,
        model: "gpt-5.6-luna",
        briefPromptVersion: "trending-brief-deep-research-v1",
      },
    });
    expect(research).toHaveBeenCalledOnce();
    expect(writing).toHaveBeenCalledOnce();
    const draftSave = mutationCalls.find(
      ({ functionName }) => functionName === "trending:saveTrendingBriefDraft",
    );
    expect(draftSave?.args).toMatchObject({
      trendingDate: "2026-03-11",
      owner: expect.any(String),
      draftBrief: expect.objectContaining({
        headline: "Replacement headline",
        briefPromptVersion: "trending-brief-deep-research-v1",
      }),
      attestation: expect.any(Object),
    });
    if (!draftSave) throw new Error("Expected a replacement draft save");
    const { attestation: draftAttestation, ...draftWriteArgs } = draftSave.args;
    await expect(
      verifyPublicAudioWriteAttestation({
        pipeline: "trending",
        operation: "save-record",
        args: draftWriteArgs,
        attestation: draftAttestation as never,
        secret: "server-secret",
      }),
    ).resolves.toBe(true);

    await expect(
      syncDailyTrendingBrief({ baseUrl: "https://curiogarden.org" }),
    ).resolves.toMatchObject({ status: "created" });

    expect(ttsAttempt).toBe(2);
    expect(getOpenAIClient).toHaveBeenCalledOnce();
    expect(research).toHaveBeenCalledOnce();
    expect(writing).toHaveBeenCalledOnce();
    expect(persisted).toMatchObject({
      status: "ready",
      headline: "Replacement headline",
      spokenSummary,
      storageId: "replacement-audio",
      audioUrl: "https://cdn.example.com/replacement.mp3",
    });
    expect(persisted.draftBrief).toBeUndefined();
  });

  it("attests failed brief persistence after generation errors", async () => {
    vi.stubEnv("OPENAI_API_KEY", "openai-key");
    vi.stubEnv("TTS_QUOTA_BYPASS_SECRET", "server-secret");
    vi.spyOn(console, "info").mockImplementation(() => undefined);
    vi.spyOn(console, "error").mockImplementation(() => undefined);
    vi.mocked(renderTrendingPodcastArtworkPng).mockResolvedValueOnce({
      data: Uint8Array.of(1, 2, 3),
      mimeType: "image/png",
    });
    const existing = {
      _id: "brief-1",
      trendingDate: "2026-03-11",
      status: "failed",
      headline: "Cached headline",
      summary: "Cached summary",
      podcastDescription: "Cached description",
      spokenSummary: "Cached spoken summary with enough narration words.",
      keyPoints: ["One", "Two", "Three"],
      articleTitles: ["Example Trend"],
      sources: [{ title: "Example", url: "https://example.com" }],
      audioUrl: null,
      updatedAt: Date.now(),
    };
    const { fetchMutation, fetchQuery } = await import("convex/nextjs");
    vi.mocked(fetchQuery).mockResolvedValue(existing as never);
    vi.mocked(fetchMutation).mockImplementation(async (...callArgs) => {
      const functionName = getFunctionName(callArgs[0]);
      if (functionName === "trending:claimTrendingBriefJob") {
        return { claimed: true } as never;
      }
      if (functionName === "trending:saveTrendingBrief") {
        return "brief-1" as never;
      }
      if (functionName === "trending:finalizeTrendingBriefJob") {
        return { updated: true } as never;
      }
      throw new Error(`Unexpected mutation: ${functionName}`);
    });
    vi.stubGlobal(
      "fetch",
      vi.fn(async () =>
        Response.json({ error: "speech unavailable" }, { status: 503 }),
      ),
    );

    await expect(
      syncDailyTrendingBrief({ baseUrl: "https://curiogarden.org" }),
    ).rejects.toThrow("speech unavailable");

    const operationByFunction = {
      "trending:claimTrendingBriefJob": "claim-job",
      "trending:saveTrendingBrief": "save-record",
      "trending:finalizeTrendingBriefJob": "finalize-job",
    } as const;
    const validity = await Promise.all(
      vi.mocked(fetchMutation).mock.calls.map(async ([reference, callArgs]) => {
        const functionName = getFunctionName(
          reference,
        ) as keyof typeof operationByFunction;
        const { attestation, ...writeArgs } = (callArgs ?? {}) as Record<
          string,
          unknown
        > & { attestation?: never };
        return await verifyPublicAudioWriteAttestation({
          pipeline: "trending",
          operation: operationByFunction[functionName],
          args: writeArgs,
          attestation,
          secret: "server-secret",
        });
      }),
    );
    expect(validity).toEqual([true, true, true, true]);
  });
});

describe("getDailyTrendingBriefState", () => {
  it("returns disabled without querying Convex in local mode without a Convex URL", async () => {
    process.env.OPENAI_API_KEY = "openai-key";
    process.env.NEXT_PUBLIC_LOCAL_MODE = "true";
    process.env.NEXT_PUBLIC_CONVEX_URL = "";

    await expect(getDailyTrendingBriefState()).resolves.toMatchObject({
      enabled: false,
      status: "disabled",
      trendingDate: "2026-03-11",
      articleTitles: ["Example Trend"],
      brief: null,
    });

    const { fetchQuery } = await import("convex/nextjs");
    expect(fetchQuery).not.toHaveBeenCalled();
  });
});

describe("hasCurrentTrendingArtworkVersion", () => {
  it("detects the current artwork version", () => {
    expect(
      hasCurrentTrendingArtworkVersion({
        artworkVersion: 2,
      } as Parameters<typeof hasCurrentTrendingArtworkVersion>[0]),
    ).toBe(true);

    expect(
      hasCurrentTrendingArtworkVersion({
        artworkVersion: 1,
      } as Parameters<typeof hasCurrentTrendingArtworkVersion>[0]),
    ).toBe(false);
  });
});

describe("direct OpenAI trending generation", () => {
  it("uses pinned Mini cache identity regardless of the interactive primary", () => {
    vi.stubEnv("TTS_PRIMARY_PROVIDER", "edge");

    expect(getTrendingAudioCacheKey()).toBe(
      `${trendingTtsProfile.ttsCacheKey}:trending-script:ai-disclosure-v1`,
    );
  });

  it("adds an audible AI disclosure to the generated podcast script", () => {
    const script = getTrendingAudioScript("Here is today's briefing.");

    expect(script).toContain("AI disclosure");
    expect(script).toContain("generated this briefing with OpenAI");
    expect(script).toContain("Here is today's briefing.");
  });

  it("uses Responses web search, Structured Outputs, and cited source metadata", async () => {
    vi.spyOn(console, "info").mockImplementation(() => undefined);
    const record = vi.fn<(attempt: AiCostProviderAttempt) => Promise<void>>(
      async () => undefined,
    );
    const providerFetch = createInstrumentedOpenAiFetch({
      fetch: vi.fn(async () =>
        Response.json({
          model: "gpt-5.6-luna",
          service_tier: "auto",
          usage: { input_tokens: 1, output_tokens: 1 },
        }),
      ),
      record,
    });
    const create = vi.fn(async (request: unknown) => {
      void request;
      await providerFetch("https://api.openai.com/v1/responses");
      return {
        model: "gpt-5.6-luna",
        output_text: "The topic followed a recent announcement.",
        output: [
          {
            type: "web_search_call",
            status: "completed",
            action: {
              type: "search",
              sources: [
                { type: "url", url: "https://www.reuters.com/example" },
                { type: "url", url: "https://www.bbc.com/example" },
              ],
            },
          },
          {
            type: "message",
            content: [
              {
                type: "output_text",
                annotations: [
                  {
                    type: "url_citation",
                    title: "Reuters report",
                    url: "https://www.reuters.com/example",
                  },
                ],
              },
            ],
          },
        ],
        usage: { input_tokens: 100, output_tokens: 30, total_tokens: 130 },
      };
    });
    const parse = vi.fn(async () => {
      await providerFetch("https://api.openai.com/v1/responses");
      return {
        model: "gpt-5.6-luna",
        output_parsed: {
          headline: "  A headline  ",
          summary: "A sourced summary.",
          podcastDescription: "A compact description.",
          spokenSummary: "A natural spoken summary.",
          keyPoints: ["One", "Two", "Three"],
        },
        usage: { input_tokens: 200, output_tokens: 50, total_tokens: 250 },
      };
    });
    const client = {
      responses: { create, parse },
    } as unknown as Parameters<
      typeof generateTrendingBriefContent
    >[0]["client"];

    const brief = await generateTrendingBriefContent({
      client,
      model: "gpt-5.6-luna",
      trendingDate: "2026-07-13",
      articles: [
        {
          title: "Example Topic",
          extract: "An example extract.",
          views: 12_345,
        },
      ],
    });

    expect(create).toHaveBeenCalledWith(
      expect.objectContaining({
        model: "gpt-5.6-luna",
        tools: [{ type: "web_search", search_context_size: "medium" }],
        tool_choice: "required",
        include: ["web_search_call.action.sources"],
        store: false,
      }),
      expect.objectContaining({
        maxRetries: 0,
        signal: expect.any(AbortSignal),
        timeout: TRENDING_BRIEF_OPENAI_REQUEST_TIMEOUT_MS,
      }),
    );
    expect(parse).toHaveBeenCalledWith(
      expect.objectContaining({
        model: "gpt-5.6-luna",
        text: expect.objectContaining({ format: expect.any(Object) }),
        store: false,
      }),
      expect.objectContaining({
        maxRetries: 0,
        signal: expect.any(AbortSignal),
        timeout: TRENDING_BRIEF_OPENAI_REQUEST_TIMEOUT_MS,
      }),
    );
    expect(brief).toMatchObject({
      headline: "A headline",
      sources: [
        {
          title: "Reuters report",
          url: "https://www.reuters.com/example",
        },
        { title: "bbc.com", url: "https://www.bbc.com/example" },
      ],
    });
    await vi.waitFor(() => expect(record).toHaveBeenCalledTimes(5));
    expect(
      record.mock.calls
        .map(([attempt]) => attempt)
        .filter(
          ({ state, lifecycleVersion }) =>
            state === "succeeded" && lifecycleVersion === 1,
        )
        .map(({ operation }) => operation),
    ).toEqual(["trending_brief_research", "trending_brief_writing"]);
    expect(
      record.mock.calls
        .map(([attempt]) => attempt)
        .find(
          ({ operation, lifecycleVersion }) =>
            operation === "trending_brief_research" && lifecycleVersion === 2,
        ),
    ).toMatchObject({
      operation: "trending_brief_research",
      lifecycleVersion: 2,
      state: "succeeded",
      webSearchCalls: 1,
    });
  });

  it("researches each topic with high context before depth writing", async () => {
    vi.spyOn(console, "info").mockImplementation(() => undefined);
    let researchIndex = 0;
    const create = vi.fn(async (request: unknown) => {
      void request;
      researchIndex += 1;
      return {
        model: "gpt-5.6-terra",
        output_text: [
          `Topic ${researchIndex}`,
          "Trigger: A supported recent event.",
          "Timeline: The event happened this week.",
          "Background: Relevant historical context.",
          "Confidence: High.",
          "Uncertainty: None material.",
        ].join("\n"),
        output: [
          {
            type: "web_search_call",
            action: {
              sources: [
                {
                  type: "url",
                  url: `https://news.example.com/topic-${researchIndex}`,
                },
              ],
            },
          },
        ],
        usage: { input_tokens: 100, output_tokens: 30, total_tokens: 130 },
      };
    });
    const parse = vi.fn(async (request: unknown) => {
      void request;
      return {
        model: "gpt-5.6-terra",
        output_parsed: {
          headline: "Three stories in context",
          summary: "A supported summary.",
          podcastDescription: "Three Wikipedia trends, explained.",
          spokenSummary: Array.from(
            { length: 320 },
            (_, index) => `word${index + 1}`,
          ).join(" "),
          keyPoints: ["One", "Two", "Three"],
        },
        usage: { input_tokens: 300, output_tokens: 400, total_tokens: 700 },
      };
    });
    const client = {
      responses: { create, parse },
    } as unknown as Parameters<
      typeof generateTrendingBriefContent
    >[0]["client"];

    const brief = await generateTrendingBriefContent({
      client,
      model: "gpt-5.6-terra",
      profile: "deep-research",
      trendingDate: "2026-08-24",
      articles: [
        { title: "Topic One", extract: "First.", views: 3_000 },
        { title: "Topic Two", extract: "Second.", views: 2_000 },
        { title: "Topic Three", extract: "Third.", views: 1_000 },
      ],
    });

    expect(create).toHaveBeenCalledTimes(3);
    for (const [request] of create.mock.calls) {
      expect(request).toEqual(
        expect.objectContaining({
          tools: [{ type: "web_search", search_context_size: "high" }],
          tool_choice: "required",
        }),
      );
      expect(request).not.toHaveProperty("max_tool_calls");
    }
    expect(parse).toHaveBeenCalledWith(
      expect.objectContaining({
        text: expect.objectContaining({ verbosity: "medium" }),
        input: expect.stringContaining("Confidence: High"),
      }),
      expect.objectContaining({
        maxRetries: 0,
        signal: expect.any(AbortSignal),
        timeout: TRENDING_BRIEF_OPENAI_REQUEST_TIMEOUT_MS,
      }),
    );
    expect(brief.sources).toHaveLength(3);
  });

  it("stops dequeuing after a deep-research worker fails and aborts its peers", async () => {
    vi.spyOn(console, "info").mockImplementation(() => undefined);
    const receivedSignals: AbortSignal[] = [];
    const create = vi.fn(
      async (_request: unknown, options?: { signal?: AbortSignal }) => {
        const signal = options?.signal;
        if (signal) receivedSignals.push(signal);
        if (create.mock.calls.length === 1) {
          throw new Error("first topic research failed");
        }

        return await new Promise<never>((_, reject) => {
          signal?.addEventListener("abort", () => {
            reject(signal.reason);
          });
          setTimeout(() => reject(new Error("late worker failure")), 20);
        });
      },
    );
    const client = {
      responses: { create, parse: vi.fn() },
    } as unknown as Parameters<
      typeof generateTrendingBriefContent
    >[0]["client"];

    await expect(
      generateTrendingBriefContent({
        client,
        model: "gpt-5.6-luna",
        profile: "deep-research",
        trendingDate: "2026-08-24",
        articles: Array.from({ length: 6 }, (_, index) => ({
          title: `Topic ${index + 1}`,
          extract: "Context.",
          views: 1_000 - index,
        })),
      }),
    ).rejects.toThrow("first topic research failed");

    expect(create).toHaveBeenCalledTimes(4);
    expect(receivedSignals).toHaveLength(4);
    expect(new Set(receivedSignals)).toHaveProperty("size", 1);
    expect(receivedSignals.every((signal) => signal.aborted)).toBe(true);
  });

  it("aborts the entire brief workflow at its injected deadline", async () => {
    vi.useFakeTimers();
    const receivedSignals: AbortSignal[] = [];
    const create = vi.fn(
      async (_request: unknown, options?: { signal?: AbortSignal }) =>
        await new Promise<never>((_, reject) => {
          const signal = options?.signal;
          if (signal) receivedSignals.push(signal);
          signal?.addEventListener("abort", () => reject(signal.reason));
        }),
    );
    const parse = vi.fn();
    const client = {
      responses: { create, parse },
    } as unknown as Parameters<
      typeof generateTrendingBriefContent
    >[0]["client"];
    const generation = generateTrendingBriefContent({
      client,
      model: "gpt-5.6-luna",
      profile: "deep-research",
      deadlineMs: 25,
      trendingDate: "2026-08-24",
      articles: Array.from({ length: 4 }, (_, index) => ({
        title: `Topic ${index + 1}`,
        extract: "Context.",
        views: 1_000 - index,
      })),
    });
    const deadlineExpectation = expect(generation).rejects.toThrow(
      "Trending brief generation exceeded its 25ms deadline",
    );

    await vi.advanceTimersByTimeAsync(25);

    await deadlineExpectation;
    expect(create).toHaveBeenCalledTimes(4);
    expect(receivedSignals).toHaveLength(4);
    expect(receivedSignals.every((signal) => signal.aborted)).toBe(true);
    expect(parse).not.toHaveBeenCalled();
  });

  it("repairs an out-of-band depth script once using the same research", async () => {
    vi.spyOn(console, "info").mockImplementation(() => undefined);
    const create = vi.fn(async () => ({
      model: "gpt-5.6-terra",
      output_text: "Trigger: A supported event. Uncertainty: none material.",
      output: [
        {
          type: "web_search_call",
          action: {
            sources: [{ url: "https://news.example.com/story" }],
          },
        },
      ],
      usage: null,
    }));
    let writingAttempt = 0;
    const parse = vi.fn(async (request: unknown) => {
      void request;
      writingAttempt += 1;
      return {
        model: "gpt-5.6-terra",
        output_parsed: {
          headline: "A headline",
          summary: "A supported summary.",
          podcastDescription: "A compact description.",
          spokenSummary: Array.from(
            { length: writingAttempt === 1 ? 120 : 320 },
            (_, index) => `word${index + 1}`,
          ).join(" "),
          keyPoints: ["One", "Two", "Three"],
        },
        usage: null,
      };
    });
    const events: Array<{ type: string; attempt?: string }> = [];
    const client = {
      responses: { create, parse },
    } as unknown as Parameters<
      typeof generateTrendingBriefContent
    >[0]["client"];

    const brief = await generateTrendingBriefContent({
      client,
      model: "gpt-5.6-terra",
      profile: "depth-writing",
      trendingDate: "2026-08-24",
      articles: [{ title: "Topic", extract: "Context.", views: 1_000 }],
      onEvent: (event) => events.push(event),
    });

    expect(create).toHaveBeenCalledTimes(1);
    expect(parse).toHaveBeenCalledTimes(2);
    expect(parse.mock.calls[1]?.[0]).toEqual(
      expect.objectContaining({
        input: expect.stringContaining(
          "Trigger: A supported event. Uncertainty: none material.",
        ),
        text: expect.objectContaining({ verbosity: "medium" }),
      }),
    );
    expect(brief.spokenSummary.split(/\s+/)).toHaveLength(320);
    expect(events.filter((event) => event.type === "writing")).toEqual([
      expect.objectContaining({ attempt: "initial" }),
      expect.objectContaining({ attempt: "repair" }),
    ]);
  });

  it("fails depth generation when the single repair still misses the word band", async () => {
    vi.spyOn(console, "info").mockImplementation(() => undefined);
    const create = vi.fn(async () => ({
      model: "gpt-5.6-terra",
      output_text: "Trigger: supported. Uncertainty: labelled.",
      output: [
        {
          type: "web_search_call",
          action: { sources: [{ url: "https://news.example.com/story" }] },
        },
      ],
      usage: null,
    }));
    const parse = vi.fn(async () => ({
      model: "gpt-5.6-terra",
      output_parsed: {
        headline: "Headline",
        summary: "Summary",
        podcastDescription: "Description",
        spokenSummary: Array.from(
          { length: 120 },
          (_, index) => `word${index + 1}`,
        ).join(" "),
        keyPoints: ["One", "Two", "Three"],
      },
      usage: null,
    }));
    const client = {
      responses: { create, parse },
    } as unknown as Parameters<
      typeof generateTrendingBriefContent
    >[0]["client"];

    await expect(
      generateTrendingBriefContent({
        client,
        model: "gpt-5.6-terra",
        profile: "depth-writing",
        trendingDate: "2026-08-24",
        articles: [{ title: "Topic", extract: "Context.", views: 1_000 }],
      }),
    ).rejects.toThrow("outside 300-420 words after one repair");
    expect(parse).toHaveBeenCalledTimes(2);
  });

  it("rejects normalized output that loses required non-empty key points", async () => {
    vi.spyOn(console, "info").mockImplementation(() => undefined);
    const create = vi.fn(async () => ({
      model: "gpt-5.6-luna",
      output_text: "A researched explanation.",
      output: [
        {
          type: "web_search_call",
          action: {
            sources: [{ type: "url", url: "https://www.reuters.com/example" }],
          },
        },
      ],
      usage: null,
    }));
    const parse = vi.fn(async () => ({
      model: "gpt-5.6-luna",
      output_parsed: {
        headline: "Headline",
        summary: "Summary",
        podcastDescription: "Description",
        spokenSummary: "Spoken summary",
        keyPoints: ["One", "   ", "Three"],
      },
      usage: null,
    }));
    const client = {
      responses: { create, parse },
    } as unknown as Parameters<
      typeof generateTrendingBriefContent
    >[0]["client"];

    await expect(
      generateTrendingBriefContent({
        client,
        model: "gpt-5.6-luna",
        trendingDate: "2026-07-13",
        articles: [
          { title: "Example", extract: "Example extract", views: 1_000 },
        ],
      }),
    ).rejects.toThrow();
  });

  it("extracts titled citations before consulted URLs and rejects unsafe URLs", () => {
    expect(
      extractTrendingBriefSources([
        {
          type: "web_search_call",
          action: {
            sources: [
              { url: "https://example.com/story" },
              { url: "javascript:alert(1)" },
            ],
          },
        },
        {
          type: "message",
          content: [
            {
              annotations: [
                {
                  type: "url_citation",
                  title: "Example story",
                  url: "https://example.com/story",
                },
              ],
            },
          ],
        },
      ]),
    ).toEqual([{ title: "Example story", url: "https://example.com/story" }]);
  });

  it("enables Trending from OPENAI_API_KEY rather than AI Gateway", () => {
    delete process.env.OPENAI_API_KEY;
    process.env.AI_GATEWAY_API_KEY = "legacy-key";
    expect(isTrendingBriefEnabled()).toBe(false);

    process.env.OPENAI_API_KEY = "openai-key";
    expect(isTrendingBriefEnabled()).toBe(true);
  });

  it("defaults to Luna and translates legacy Gateway model identifiers", () => {
    delete process.env.TRENDING_BRIEF_MODEL;
    expect(getTrendingBriefModel()).toBe("gpt-5.6-luna");

    process.env.TRENDING_BRIEF_MODEL = "openai/gpt-5.6-luna";
    expect(getTrendingBriefModel()).toBe("gpt-5.6-luna");

    vi.spyOn(console, "warn").mockImplementation(() => undefined);
    process.env.TRENDING_BRIEF_MODEL = "anthropic/claude-opus-4.5";
    expect(getTrendingBriefModel()).toBe("gpt-5.6-luna");
  });

  it("defaults production Trending generation to the evaluated deep-research profile", () => {
    expect(getTrendingBriefGenerationProfile()).toBe("deep-research");
    expect(getTrendingBriefPromptVersion()).toBe(
      "trending-brief-deep-research-v1",
    );
  });
});
