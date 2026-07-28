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
  getTrendingBriefModel,
  hasCurrentTrendingArtworkVersion,
  isTrendingBriefEnabled,
  normalizeTrendingBrief,
  selectTrendingArtworkItems,
  shouldReuseExistingTrendingBrief,
  syncDailyTrendingBrief,
} from "./trending-brief";
import { getTtsProfile } from "./tts-profile";
import { renderTrendingPodcastArtworkPng } from "./trending-podcast-artwork";
import { verifyPublicAudioWriteAttestation } from "./public-audio-write-attestation";
import { createInstrumentedOpenAiFetch } from "./openai-client";
import type { AiCostProviderAttempt } from "./ai-cost-ledger-contract";
import { TTS_AI_COST_SOURCE_HEADER } from "./tts-source-attestation";

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

const originalOpenAiApiKey = process.env.OPENAI_API_KEY;
const originalAiGatewayApiKey = process.env.AI_GATEWAY_API_KEY;
const originalConvexUrl = process.env.NEXT_PUBLIC_CONVEX_URL;
const originalLocalMode = process.env.NEXT_PUBLIC_LOCAL_MODE;
const originalTrendingBriefModel = process.env.TRENDING_BRIEF_MODEL;
const edgeTtsProfile = getTtsProfile("edge");
const currentTrendingEdgeMetadata = {
  provider: edgeTtsProfile.provider,
  ttsModel: edgeTtsProfile.model,
  voiceId: edgeTtsProfile.voiceId,
  promptVersion: edgeTtsProfile.promptVersion,
  ttsNormVersion: edgeTtsProfile.ttsNormVersion,
  ttsCacheKey: getTrendingAudioCacheKey(),
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
  restoreEnvValue("OPENAI_API_KEY", originalOpenAiApiKey);
  restoreEnvValue("AI_GATEWAY_API_KEY", originalAiGatewayApiKey);
  restoreEnvValue("NEXT_PUBLIC_CONVEX_URL", originalConvexUrl);
  restoreEnvValue("NEXT_PUBLIC_LOCAL_MODE", originalLocalMode);
  restoreEnvValue("TRENDING_BRIEF_MODEL", originalTrendingBriefModel);
  vi.restoreAllMocks();
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

  it("always reuses an existing ready brief, even if a force sync was requested", () => {
    expect(
      shouldReuseExistingTrendingBrief({
        _id: "brief-1",
        trendingDate: "2026-03-11",
        status: "ready",
        audioUrl: "https://cdn.example.com/brief.mp3",
        artworkVersion: 2,
        ...currentTrendingEdgeMetadata,
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
          ...currentTrendingEdgeMetadata,
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
          ...currentTrendingEdgeMetadata,
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
          ...currentTrendingEdgeMetadata,
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
        ...currentTrendingEdgeMetadata,
        ttsCacheKey:
          "tts:edge:edge-tts:en-US-AriaNeural:edge-default:ttsNorm:3",
        updatedAt: Date.now(),
      } as Parameters<typeof shouldReuseExistingTrendingBrief>[0]),
    ).toBe(false);
  });

  it("invalidates incompatible ready audio when its Edge replacement fails", async () => {
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
      ttsCacheKey: getTtsProfile("openai").ttsCacheKey,
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
    const ttsRequests: Array<{ provider?: string }> = [];
    vi.stubGlobal(
      "fetch",
      vi.fn(async (_input: RequestInfo | URL, init?: RequestInit) => {
        ttsRequests.push(
          JSON.parse(String(init?.body)) as { provider?: string },
        );
        return Response.json({ error: "speech unavailable" }, { status: 503 });
      }),
    );

    await expect(
      syncDailyTrendingBrief({ baseUrl: "https://curiogarden.org" }),
    ).rejects.toThrow("speech unavailable");

    expect(ttsRequests).toEqual([
      expect.objectContaining({ provider: "edge" }),
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
      ...currentTrendingEdgeMetadata,
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

  it("attests both upload URL requests before publishing new Edge assets", async () => {
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
    vi.stubGlobal(
      "fetch",
      vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
        const url = String(input);
        if (url === "https://curiogarden.org/api/tts") {
          ttsSources.push(
            new Headers(init?.headers).get(TTS_AI_COST_SOURCE_HEADER),
          );
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
  it("uses Edge cache identity even when a legacy primary is configured", () => {
    vi.stubEnv("TTS_PRIMARY_PROVIDER", "openai");

    expect(getTrendingAudioCacheKey()).toBe(
      `${getTtsProfile("edge").ttsCacheKey}:trending-script:ai-disclosure-v1`,
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
    const create = vi.fn(async () => {
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
    );
    expect(parse).toHaveBeenCalledWith(
      expect.objectContaining({
        model: "gpt-5.6-luna",
        text: expect.objectContaining({ format: expect.any(Object) }),
        store: false,
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
});
