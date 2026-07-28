import { NextRequest } from "next/server";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { getFunctionName } from "convex/server";
import { buildArticleNarrationTracks } from "@/lib/section-narration";
import {
  buildTtsMetadataHeaders,
  getTtsMetadata,
  getTtsProfile,
} from "@/lib/tts-profile";
import { createAudioCacheLedgerAssetKey } from "@/lib/audio-cache-ledger";

const auth = vi.hoisted(() => vi.fn());
const fetchQuery = vi.hoisted(() => vi.fn());
const fetchMutation = vi.hoisted(() => vi.fn());
const generateTtsAudioWithMetadata = vi.hoisted(() => vi.fn());
const fetchArticleByTitle = vi.hoisted(() => vi.fn());
const pendingAfterTasks = vi.hoisted(() => [] as Promise<unknown>[]);
const after = vi.hoisted(() =>
  vi.fn((task: () => unknown) => {
    pendingAfterTasks.push(Promise.resolve().then(task));
  }),
);

vi.mock("@clerk/nextjs/server", () => ({ auth }));
vi.mock("convex/nextjs", () => ({ fetchQuery, fetchMutation }));
vi.mock("@/lib/tts-client", () => ({ generateTtsAudioWithMetadata }));
vi.mock("@/convex/lib/wikipedia", () => ({
  fetchArticleByTitle,
  slugToTitle: (slug: string) => slug.replace(/_/g, " "),
}));
vi.mock("next/server", async () => {
  const actual =
    await vi.importActual<typeof import("next/server")>("next/server");
  return { ...actual, after };
});

const article = {
  _id: "article-1",
  title: "The Silmarillion",
  slug: "The_Silmarillion",
  summary: "A history of the elder days of Middle-earth.",
  sections: [],
};
const summary = buildArticleNarrationTracks(article)[0];
const edgeMetadata = getTtsMetadata(getTtsProfile("edge"));
const openAiMetadata = getTtsMetadata(getTtsProfile("openai"));
const brokenLedgerAssetKey = "00000000-0000-4000-8000-000000000001";

const request = (
  provider: "edge" | "openai" = "edge",
  sourceHash = summary.sourceHash,
) =>
  new NextRequest("https://preview.example/api/article/audio/section", {
    method: "POST",
    headers: {
      cookie: "__session=session-cookie",
      "x-forwarded-for": "203.0.113.5",
    },
    body: JSON.stringify({
      slug: article.slug,
      sectionKey: summary.sectionKey,
      sourceHash,
      provider,
    }),
  });

describe("POST /api/article/audio/section", () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  beforeEach(() => {
    vi.clearAllMocks();
    vi.resetModules();
    vi.unstubAllEnvs();
    vi.unstubAllGlobals();
    pendingAfterTasks.length = 0;
    fetchQuery.mockReset();
    fetchMutation.mockReset();
    generateTtsAudioWithMetadata.mockReset();
    fetchArticleByTitle.mockReset();
    vi.stubEnv("AUDIO_GENERATION_BASE_URL", "https://trusted.example");
    vi.stubEnv("TTS_QUOTA_BYPASS_SECRET", "server-secret");
    vi.stubEnv("AI_COST_LEDGER_MODE", "observe");
    auth.mockResolvedValue({ userId: null, getToken: vi.fn() });
    fetchQuery.mockResolvedValueOnce(article);
    fetchMutation.mockImplementation(async (functionReference) => {
      switch (getFunctionName(functionReference)) {
        case "audio:getAllSectionAudioForServer":
          return { urls: {}, durations: {}, metadata: {} };
        case "audio:recordSectionAudioCacheReadResult":
        case "audio:recordSectionAudioCacheWriteFailure":
          return { created: true, disposition: "inserted" };
        case "audio:generateUploadUrl":
          return "https://upload.example/audio";
        case "audio:saveSectionAudioRecord":
          return "audio-record-1";
        default:
          throw new Error(
            `Unexpected mutation: ${getFunctionName(functionReference)}`,
          );
      }
    });
    generateTtsAudioWithMetadata.mockResolvedValue({
      blob: new Blob([Uint8Array.of(1, 2, 3)], { type: "audio/mpeg" }),
      metadata: edgeMetadata,
    });
    fetchArticleByTitle.mockResolvedValue({
      title: article.title,
      summary: article.summary,
      sections: article.sections,
    });
    vi.stubGlobal(
      "fetch",
      vi.fn(async (input: RequestInfo | URL) => {
        if (String(input) === "https://upload.example/audio") {
          return Response.json({ storageId: "storage-1" });
        }
        throw new Error(`Unexpected fetch: ${String(input)}`);
      }),
    );
  });

  it("coerces a guest OpenAI request to Edge and persists canonical audio", async () => {
    const { POST } = await import("./route");
    const response = await POST(request("openai"));
    await Promise.all(pendingAfterTasks);

    expect(response.status).toBe(200);
    expect(response.headers.get("X-Curio-TTS-Provider")).toBe("edge");
    expect(response.headers.get("X-Curio-TTS-Fallback-Reason")).toBe(
      "openai_auth",
    );
    expect(generateTtsAudioWithMetadata).toHaveBeenCalledWith(
      { text: summary.text, provider: "edge" },
      {
        apiBaseUrl: "https://trusted.example",
        headers: expect.objectContaining({
          cookie: "__session=session-cookie",
          "x-forwarded-for": "203.0.113.5",
        }),
      },
    );
    const generatedHeaders = generateTtsAudioWithMetadata.mock.calls[0][1]
      .headers as Record<string, string>;
    expect(generatedHeaders).not.toHaveProperty("x-curio-tts-quota-bypass");
    expect(fetchMutation).toHaveBeenCalledTimes(4);
    expect(fetchMutation.mock.calls[0][1]).toEqual(
      expect.objectContaining({
        articleId: article._id,
        ttsCacheKey: edgeMetadata.ttsCacheKey,
        attestation: expect.any(Object),
      }),
    );
    const saveCall = fetchMutation.mock.calls.find(
      ([functionReference]) =>
        getFunctionName(functionReference) === "audio:saveSectionAudioRecord",
    );
    expect(saveCall?.[1]).toEqual(
      expect.objectContaining({
        articleId: article._id,
        sectionKey: summary.sectionKey,
        sourceHash: summary.sourceHash,
        storageId: "storage-1",
        provider: "edge",
        byteLength: 3,
        ledgerAssetKey: expect.any(String),
        ledgerSource: "interactive_article",
        attestation: expect.any(Object),
      }),
    );
  });

  it("persists generated audio when ledger identity creation fails", async () => {
    vi.stubEnv("NEXT_PUBLIC_LOCAL_MODE", "true");
    fetchQuery.mockReset();
    fetchArticleByTitle.mockResolvedValue(article);
    const warn = vi.spyOn(console, "warn").mockImplementation(() => undefined);
    const audioRequest = request("edge");
    const { POST } = await import("./route");
    vi.spyOn(crypto, "randomUUID").mockImplementation(() => {
      if (
        (new Error().stack ?? "").includes("createAudioCacheLedgerAssetKey")
      ) {
        throw new Error("random source unavailable");
      }
      return "00000000-0000-4000-8000-000000000002";
    });

    const response = await POST(audioRequest);
    await Promise.all(pendingAfterTasks);

    expect(response.status).toBe(200);
    const saveCall = fetchMutation.mock.calls.find(
      ([functionReference]) =>
        getFunctionName(functionReference) === "audio:saveSectionAudioRecord",
    );
    expect(saveCall?.[1]).toEqual(
      expect.objectContaining({
        articleId: article._id,
        storageId: "storage-1",
        attestation: expect.any(Object),
      }),
    );
    expect(saveCall?.[1]).not.toHaveProperty("ledgerAssetKey");
    expect(saveCall?.[1]).not.toHaveProperty("ledgerSource");
    expect(
      fetchMutation.mock.calls.some(
        ([functionReference]) =>
          getFunctionName(functionReference) ===
          "audio:recordSectionAudioCacheWriteFailure",
      ),
    ).toBe(false);
    expect(warn).toHaveBeenCalledWith(
      "[ai-cost-ledger] Audio cache identity was not created.",
    );
  });

  it("keeps cache persistence uninstrumented while the ledger is off", async () => {
    vi.stubEnv("AI_COST_LEDGER_MODE", "off");

    const { POST } = await import("./route");
    const createId = vi.fn(() => "00000000-0000-4000-8000-000000000003");
    expect(
      createAudioCacheLedgerAssetKey({ mode: "off", createId }),
    ).toBeUndefined();
    expect(createId).not.toHaveBeenCalled();
    const response = await POST(request("edge"));
    await Promise.all(pendingAfterTasks);

    expect(response.status).toBe(200);
    const saveCall = fetchMutation.mock.calls.find(
      ([functionReference]) =>
        getFunctionName(functionReference) === "audio:saveSectionAudioRecord",
    );
    expect(saveCall?.[1]).toEqual(
      expect.objectContaining({
        articleId: article._id,
        storageId: "storage-1",
        attestation: expect.any(Object),
      }),
    );
    expect(saveCall?.[1]).not.toHaveProperty("ledgerAssetKey");
    expect(saveCall?.[1]).not.toHaveProperty("expectedExistingLedgerAssetKey");
    expect(saveCall?.[1]).not.toHaveProperty("ledgerSource");
  });

  it("uses OpenAI and an authenticated Convex cache lookup for a signed-in request", async () => {
    const getToken = vi.fn().mockResolvedValue("convex-jwt");
    auth.mockResolvedValue({ userId: "user-1", getToken });
    generateTtsAudioWithMetadata.mockResolvedValue({
      blob: new Blob([Uint8Array.of(4, 5, 6)], { type: "audio/mpeg" }),
      metadata: openAiMetadata,
    });

    const { POST } = await import("./route");
    const response = await POST(request("openai"));
    await Promise.all(pendingAfterTasks);

    expect(response.headers.get("X-Curio-TTS-Provider")).toBe("openai");
    expect(getToken).toHaveBeenCalledWith({ template: "convex" });
    expect(fetchMutation.mock.calls[0][2]).toEqual({ token: "convex-jwt" });
    expect(generateTtsAudioWithMetadata).toHaveBeenCalledWith(
      { text: summary.text, provider: "openai" },
      expect.any(Object),
    );
  });

  it("serves an exact cached variant without regenerating or rewriting it", async () => {
    fetchMutation.mockReset();
    fetchMutation.mockImplementation(async (functionReference) => {
      switch (getFunctionName(functionReference)) {
        case "audio:getAllSectionAudioForServer":
          return {
            urls: { summary: "https://storage.example/summary.mp3" },
            durations: { summary: 12 },
            metadata: { summary: edgeMetadata },
          };
        case "audio:recordSectionAudioCacheReadResult":
          return { created: true, disposition: "inserted" };
        default:
          throw new Error(
            `Unexpected mutation: ${getFunctionName(functionReference)}`,
          );
      }
    });
    vi.stubGlobal(
      "fetch",
      vi.fn(async (input: RequestInfo | URL) => {
        expect(String(input)).toBe("https://storage.example/summary.mp3");
        return new Response(Uint8Array.of(9, 8, 7), {
          status: 200,
          headers: { "Content-Type": "audio/mpeg" },
        });
      }),
    );

    const { POST } = await import("./route");
    const response = await POST(request("edge"));
    await Promise.all(pendingAfterTasks);

    expect(Array.from(new Uint8Array(await response.arrayBuffer()))).toEqual([
      9, 8, 7,
    ]);
    for (const [name, value] of Object.entries(
      buildTtsMetadataHeaders(edgeMetadata),
    )) {
      expect(response.headers.get(name)).toBe(value);
    }
    expect(generateTtsAudioWithMetadata).not.toHaveBeenCalled();
    expect(fetchMutation).toHaveBeenCalledTimes(2);
    expect(fetchMutation.mock.calls[0][1]).toHaveProperty("attestation");
    expect(after).toHaveBeenCalledOnce();
    const cacheResultCall = fetchMutation.mock.calls.find(
      ([functionReference]) =>
        getFunctionName(functionReference) ===
        "audio:recordSectionAudioCacheReadResult",
    );
    expect(cacheResultCall?.[1]).toEqual({
      source: "interactive_article",
      provider: "edge",
      hit: true,
      byteLength: 3,
      durationSeconds: 12,
      attestation: expect.any(Object),
    });
  });

  it("records a miss instead of avoided generation when cached bytes are unusable", async () => {
    fetchMutation.mockReset();
    fetchMutation.mockImplementation(async (functionReference) => {
      switch (getFunctionName(functionReference)) {
        case "audio:getAllSectionAudioForServer":
          return {
            urls: { summary: "https://storage.example/broken.mp3" },
            durations: { summary: 12 },
            metadata: { summary: edgeMetadata },
            ledgerAssetKeys: { summary: brokenLedgerAssetKey },
          };
        case "audio:recordSectionAudioCacheReadResult":
          return { created: true, disposition: "inserted" };
        case "audio:generateUploadUrl":
          return "https://upload.example/audio";
        case "audio:saveSectionAudioRecord":
          return "audio-record-1";
        default:
          throw new Error(
            `Unexpected mutation: ${getFunctionName(functionReference)}`,
          );
      }
    });
    vi.stubGlobal(
      "fetch",
      vi.fn(async (input: RequestInfo | URL) => {
        if (String(input) === "https://storage.example/broken.mp3") {
          return new Response("unavailable", { status: 503 });
        }
        if (String(input) === "https://upload.example/audio") {
          return Response.json({ storageId: "storage-1" });
        }
        throw new Error(`Unexpected fetch: ${String(input)}`);
      }),
    );

    const { POST } = await import("./route");
    const response = await POST(request("edge"));
    await Promise.all(pendingAfterTasks);

    expect(response.status).toBe(200);
    expect(generateTtsAudioWithMetadata).toHaveBeenCalledOnce();
    const cacheResultCall = fetchMutation.mock.calls.find(
      ([functionReference]) =>
        getFunctionName(functionReference) ===
        "audio:recordSectionAudioCacheReadResult",
    );
    expect(cacheResultCall?.[1]).toEqual({
      source: "interactive_article",
      provider: "edge",
      hit: false,
      byteLength: 0,
      durationSeconds: 0,
      attestation: expect.any(Object),
    });
    const saveCall = fetchMutation.mock.calls.find(
      ([functionReference]) =>
        getFunctionName(functionReference) === "audio:saveSectionAudioRecord",
    );
    expect(saveCall?.[1]).toEqual(
      expect.objectContaining({
        expectedExistingLedgerAssetKey: brokenLedgerAssetKey,
        ledgerAssetKey: expect.any(String),
      }),
    );
  });

  it("rejects stale client narration before generation or cache writes", async () => {
    const { POST } = await import("./route");
    const response = await POST(request("edge", "stale-source"));

    expect(response.status).toBe(409);
    await expect(response.json()).resolves.toEqual({
      error: "Article narration changed; refresh and try again.",
    });
    expect(generateTtsAudioWithMetadata).not.toHaveBeenCalled();
    expect(fetchMutation).not.toHaveBeenCalled();
  });

  it("keeps successful playback independent from best-effort cache failure", async () => {
    fetchMutation.mockReset();
    fetchMutation.mockRejectedValue(new Error("Convex unavailable"));
    const warn = vi.spyOn(console, "warn").mockImplementation(() => undefined);

    const { POST } = await import("./route");
    const response = await POST(request("edge"));
    await Promise.all(pendingAfterTasks);

    expect(response.status).toBe(200);
    expect(await response.blob()).toHaveProperty("size", 3);
    expect(warn).toHaveBeenCalledWith(
      "[article-audio-cache] Failed to persist canonical section audio:",
      expect.any(Error),
    );
  });

  it("records a paid-generation cache upload failure without changing playback", async () => {
    fetchMutation.mockReset();
    fetchMutation.mockImplementation(async (functionReference) => {
      switch (getFunctionName(functionReference)) {
        case "audio:getAllSectionAudioForServer":
          return { urls: {}, durations: {}, metadata: {} };
        case "audio:recordSectionAudioCacheReadResult":
        case "audio:recordSectionAudioCacheWriteFailure":
          return { created: true, disposition: "inserted" };
        case "audio:generateUploadUrl":
          return "https://upload.example/audio";
        default:
          throw new Error(
            `Unexpected mutation: ${getFunctionName(functionReference)}`,
          );
      }
    });
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => new Response("unavailable", { status: 503 })),
    );
    vi.spyOn(console, "warn").mockImplementation(() => undefined);

    const { POST } = await import("./route");
    const response = await POST(request("edge"));
    await Promise.all(pendingAfterTasks);

    expect(response.status).toBe(200);
    expect(await response.blob()).toHaveProperty("size", 3);
    const failureCall = fetchMutation.mock.calls.find(
      ([functionReference]) =>
        getFunctionName(functionReference) ===
        "audio:recordSectionAudioCacheWriteFailure",
    );
    expect(failureCall?.[1]).toEqual({
      ledgerAssetKey: expect.any(String),
      source: "interactive_article",
      provider: "edge",
      attestation: expect.any(Object),
    });
  });

  it("keeps local Edge playback independent from Convex", async () => {
    vi.stubEnv("NEXT_PUBLIC_LOCAL_MODE", "true");
    fetchQuery.mockReset();

    const { POST } = await import("./route");
    const response = await POST(request("openai"));

    expect(response.status).toBe(200);
    expect(response.headers.get("X-Curio-TTS-Provider")).toBe("edge");
    expect(fetchArticleByTitle).toHaveBeenCalledWith("The Silmarillion");
    expect(fetchQuery).not.toHaveBeenCalled();
    expect(auth).not.toHaveBeenCalled();
    expect(after).not.toHaveBeenCalled();
  });
});
