import { NextRequest } from "next/server";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  getTrustedTtsGenerationHeaders,
  getTtsQuotaBypassHeaders,
} from "@/lib/tts-quota-bypass";
import type { AiCostProviderAttempt } from "@/lib/ai-cost-ledger-contract";
import { TTS_AI_COST_SOURCE_HEADER } from "@/lib/tts-source-attestation";

const fetchMutation = vi.hoisted(() => vi.fn());
const track = vi.hoisted(() => vi.fn(async () => {}));
const after = vi.hoisted(() => vi.fn((task: () => void) => task()));
const auth = vi.hoisted(() => vi.fn());
const recordProviderAttempt = vi.hoisted(() =>
  vi.fn<(attempt: AiCostProviderAttempt) => Promise<void>>(
    async () => undefined,
  ),
);

vi.mock("@clerk/nextjs/server", () => ({
  auth,
}));

vi.mock("convex/nextjs", () => ({
  fetchMutation,
}));

vi.mock("@vercel/analytics/server", () => ({
  track,
}));

vi.mock("@/lib/ai-cost-provider-recorder", () => ({
  recordProviderAttemptFailOpen: recordProviderAttempt,
}));

vi.mock("next/server", async () => {
  const actual =
    await vi.importActual<typeof import("next/server")>("next/server");
  return {
    ...actual,
    after,
  };
});

describe("POST /api/tts", () => {
  beforeEach(() => {
    vi.useRealTimers();
    vi.clearAllMocks();
    vi.resetModules();
    vi.unstubAllEnvs();
    vi.unstubAllGlobals();
    vi.stubEnv("TTS_QUOTA_BYPASS_SECRET", "quota-attestation-secret");
    vi.stubEnv("AI_COST_LEDGER_MODE", "observe");
    recordProviderAttempt.mockReset();
    recordProviderAttempt.mockResolvedValue(undefined);
    fetchMutation.mockResolvedValue({
      allowed: true,
      remaining: 119,
      resetAt: Date.now() + 60_000,
    });
    auth.mockResolvedValue({ userId: "user_test" });
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("uses Edge by default for signed-out requests", async () => {
    auth.mockResolvedValue({ userId: null });
    const fetchMock = vi.fn<typeof fetch>(async (input: RequestInfo | URL) => {
      expect(String(input)).toBe("https://curiogarden.org/api/tts/edge");
      return new Response(new Uint8Array([0xff, 0xfb, 0x89]), {
        status: 200,
        headers: { "Content-Type": "audio/mpeg" },
      });
    });
    vi.stubGlobal("fetch", fetchMock);

    const { POST } = await import("./route");
    const response = await POST(
      new NextRequest("https://curiogarden.org/api/tts", {
        method: "POST",
        body: JSON.stringify({
          text: "This article section text is comfortably long enough.",
        }),
      }),
    );

    expect(response.status).toBe(200);
    expect(response.headers.get("X-Curio-TTS-Provider")).toBe("edge");
    expect(response.headers.get("X-Curio-TTS-Fallback")).toBe("false");
    expect(response.headers.get("X-Curio-TTS-Quota-Mode")).toBe(
      "edge_requested",
    );
    expect(auth).toHaveBeenCalledOnce();
    expect(fetchMutation).not.toHaveBeenCalled();
    expect(fetchMock).toHaveBeenCalledOnce();
    await vi.waitFor(() =>
      expect(recordProviderAttempt).toHaveBeenCalledTimes(2),
    );
    expect(
      recordProviderAttempt.mock.calls.map(([attempt]) => attempt.source),
    ).toEqual(["interactive_article", "interactive_article"]);
  });

  it("rejects direct requests above the speech character limit", async () => {
    const fetchMock = vi.fn<typeof fetch>();
    vi.stubGlobal("fetch", fetchMock);

    const { POST } = await import("./route");
    const response = await POST(
      new NextRequest("https://curiogarden.org/api/tts", {
        method: "POST",
        body: JSON.stringify({ text: "x".repeat(4_097) }),
      }),
    );

    expect(response.status).toBe(400);
    await expect(response.json()).resolves.toEqual({
      error:
        "Text exceeds 4096 characters; split it into smaller chunks before requesting TTS",
    });
    expect(fetchMock).not.toHaveBeenCalled();
    expect(auth).not.toHaveBeenCalled();
  });

  it("records a server-attested source on every TTS lifecycle write", async () => {
    auth.mockResolvedValue({ userId: null });
    vi.stubGlobal(
      "fetch",
      vi.fn(
        async () =>
          new Response(new Uint8Array([0xff, 0xfb, 0x89]), {
            status: 200,
            headers: { "Content-Type": "audio/mpeg" },
          }),
      ),
    );
    const headers = await getTrustedTtsGenerationHeaders(
      "https://curiogarden.org",
      "featured_podcast",
    );

    const { POST } = await import("./route");
    const response = await POST(
      new NextRequest("https://curiogarden.org/api/tts", {
        method: "POST",
        headers,
        body: JSON.stringify({
          text: "This featured episode text is comfortably long enough.",
        }),
      }),
    );

    expect(response.status).toBe(200);
    await vi.waitFor(() =>
      expect(recordProviderAttempt).toHaveBeenCalledTimes(2),
    );
    expect(
      recordProviderAttempt.mock.calls.map(([attempt]) => attempt.source),
    ).toEqual(["featured_podcast", "featured_podcast"]);
  });

  it("does not trust a public client's self-declared TTS source", async () => {
    auth.mockResolvedValue({ userId: null });
    vi.stubGlobal(
      "fetch",
      vi.fn(
        async () =>
          new Response(new Uint8Array([0xff, 0xfb, 0x89]), {
            status: 200,
            headers: { "Content-Type": "audio/mpeg" },
          }),
      ),
    );

    const { POST } = await import("./route");
    const response = await POST(
      new NextRequest("https://curiogarden.org/api/tts", {
        method: "POST",
        headers: {
          [TTS_AI_COST_SOURCE_HEADER]: "picture_of_day",
        },
        body: JSON.stringify({
          text: "This public request text is comfortably long enough.",
        }),
      }),
    );

    expect(response.status).toBe(200);
    await vi.waitFor(() =>
      expect(recordProviderAttempt).toHaveBeenCalledTimes(2),
    );
    expect(
      recordProviderAttempt.mock.calls.map(([attempt]) => attempt.source),
    ).toEqual(["unknown", "unknown"]);
  });

  it("coerces a signed-out OpenAI request to Edge with an auth fallback reason", async () => {
    auth.mockResolvedValue({ userId: null });
    vi.stubEnv("TTS_EDGE_FALLBACK", "false");
    const fetchMock = vi.fn<typeof fetch>(async (input: RequestInfo | URL) => {
      expect(String(input)).toBe("https://curiogarden.org/api/tts/edge");
      return new Response(new Uint8Array([0xff, 0xfb, 0x88]), {
        status: 200,
        headers: { "Content-Type": "audio/mpeg" },
      });
    });
    vi.stubGlobal("fetch", fetchMock);

    const { POST } = await import("./route");
    const response = await POST(
      new NextRequest("https://curiogarden.org/api/tts", {
        method: "POST",
        body: JSON.stringify({
          text: "This article section text is comfortably long enough.",
          provider: "openai",
          voiceId: "marin",
        }),
      }),
    );

    expect(response.status).toBe(200);
    expect(response.headers.get("X-Curio-TTS-Provider")).toBe("edge");
    expect(response.headers.get("X-Curio-TTS-Voice")).toBe("en-US-AriaNeural");
    expect(response.headers.get("X-Curio-TTS-Fallback")).toBe("true");
    expect(response.headers.get("X-Curio-TTS-Fallback-Reason")).toBe(
      "openai_auth",
    );
    expect(response.headers.get("X-Curio-TTS-Quota-Mode")).toBe(
      "edge_requested",
    );
    expect(fetchMutation).not.toHaveBeenCalled();
    expect(fetchMock).toHaveBeenCalledOnce();
    expect(track).toHaveBeenCalledWith(
      "TTS Route",
      expect.objectContaining({
        requestedProvider: "openai",
        provider: "edge",
        fallback: true,
        fallbackReason: "openai_auth",
      }),
    );
  });

  it("allows a trusted internal request to explicitly select OpenAI without Clerk or quota", async () => {
    vi.stubEnv("OPENAI_API_KEY", "test-openai-key");
    vi.stubEnv("TTS_QUOTA_BYPASS_SECRET", "internal-secret");
    auth.mockRejectedValue(new Error("Clerk should not be consulted"));
    const fetchMock = vi.fn<typeof fetch>(async (input: RequestInfo | URL) => {
      expect(String(input)).toBe("https://api.openai.com/v1/audio/speech");
      return new Response(new Uint8Array([0xff, 0xfb, 0x87]), {
        status: 200,
        headers: { "Content-Type": "audio/mpeg" },
      });
    });
    vi.stubGlobal("fetch", fetchMock);

    const { POST } = await import("./route");
    const response = await POST(
      new NextRequest("https://curiogarden.org/api/tts", {
        method: "POST",
        headers: await getTtsQuotaBypassHeaders("https://curiogarden.org"),
        body: JSON.stringify({
          text: "This article section text is comfortably long enough.",
          provider: "openai",
        }),
      }),
    );

    expect(response.status).toBe(200);
    expect(response.headers.get("X-Curio-TTS-Provider")).toBe("openai");
    expect(response.headers.get("X-Curio-TTS-Quota-Mode")).toBe("bypass");
    expect(response.headers.get("X-Curio-TTS-Fallback")).toBe("false");
    expect(auth).not.toHaveBeenCalled();
    expect(fetchMutation).not.toHaveBeenCalled();
    expect(fetchMock).toHaveBeenCalledOnce();
  });

  it("fails closed to Edge when Clerk authentication cannot be resolved", async () => {
    auth.mockRejectedValue(new Error("Clerk unavailable"));
    const consoleWarn = vi
      .spyOn(console, "warn")
      .mockImplementation(() => undefined);
    const fetchMock = vi.fn<typeof fetch>(async (input: RequestInfo | URL) => {
      expect(String(input)).toBe("https://curiogarden.org/api/tts/edge");
      return new Response(new Uint8Array([0xff, 0xfb, 0x86]), {
        status: 200,
        headers: { "Content-Type": "audio/mpeg" },
      });
    });
    vi.stubGlobal("fetch", fetchMock);

    const { POST } = await import("./route");
    const response = await POST(
      new NextRequest("https://curiogarden.org/api/tts", {
        method: "POST",
        body: JSON.stringify({
          text: "This article section text is comfortably long enough.",
          provider: "openai",
        }),
      }),
    );

    expect(response.status).toBe(200);
    expect(response.headers.get("X-Curio-TTS-Provider")).toBe("edge");
    expect(response.headers.get("X-Curio-TTS-Fallback")).toBe("true");
    expect(response.headers.get("X-Curio-TTS-Fallback-Reason")).toBe(
      "openai_auth",
    );
    expect(fetchMutation).not.toHaveBeenCalled();
    expect(fetchMock).toHaveBeenCalledOnce();
    consoleWarn.mockRestore();
  });

  it("uses Edge in local mode without consulting Clerk", async () => {
    vi.stubEnv("NEXT_PUBLIC_LOCAL_MODE", "true");
    vi.stubEnv("TTS_EDGE_FALLBACK", "false");
    vi.stubEnv("TTS_QUOTA_BYPASS_SECRET", "internal-secret");
    auth.mockResolvedValue({ userId: "user_local" });
    const fetchMock = vi.fn<typeof fetch>(async (input: RequestInfo | URL) => {
      expect(String(input)).toBe("https://curiogarden.org/api/tts/edge");
      return new Response(new Uint8Array([0xff, 0xfb, 0x85]), {
        status: 200,
        headers: { "Content-Type": "audio/mpeg" },
      });
    });
    vi.stubGlobal("fetch", fetchMock);

    const { POST } = await import("./route");
    const response = await POST(
      new NextRequest("https://curiogarden.org/api/tts", {
        method: "POST",
        headers: {
          "x-curio-tts-quota-bypass": "internal-secret",
        },
        body: JSON.stringify({
          text: "This article section text is comfortably long enough.",
          provider: "openai",
        }),
      }),
    );

    expect(response.status).toBe(200);
    expect(response.headers.get("X-Curio-TTS-Provider")).toBe("edge");
    expect(response.headers.get("X-Curio-TTS-Fallback")).toBe("true");
    expect(response.headers.get("X-Curio-TTS-Fallback-Reason")).toBe(
      "openai_auth",
    );
    expect(auth).not.toHaveBeenCalled();
    expect(fetchMutation).not.toHaveBeenCalled();
    expect(fetchMock).toHaveBeenCalledOnce();
  });

  it("generates OpenAI speech by default for signed-in requests and returns provider metadata headers", async () => {
    vi.stubEnv("OPENAI_API_KEY", "test-openai-key");
    vi.stubGlobal(
      "fetch",
      vi.fn(
        async () =>
          new Response(new Uint8Array([0xff, 0xfb, 0x90]), {
            status: 200,
            headers: { "Content-Type": "audio/mpeg" },
          }),
      ),
    );

    const { POST } = await import("./route");
    const response = await POST(
      new NextRequest("https://curiogarden.org/api/tts", {
        method: "POST",
        body: JSON.stringify({
          text: "This article section text is comfortably long enough.",
        }),
      }),
    );

    const bytes = new Uint8Array(await response.arrayBuffer());

    expect(response.status).toBe(200);
    expect(response.headers.get("Content-Type")).toBe("audio/mpeg");
    expect(response.headers.get("X-Curio-TTS-Provider")).toBe("openai");
    expect(response.headers.get("X-Curio-TTS-Model")).toBe("gpt-4o-mini-tts");
    expect(response.headers.get("X-Curio-TTS-Voice")).toBe("marin");
    expect(response.headers.get("X-Curio-TTS-Prompt-Version")).toBe(
      "curio-warm-narrator-v1",
    );
    expect(response.headers.get("X-Curio-TTS-Cache-Key")).toBe(
      "tts:openai:gpt-4o-mini-tts:marin:curio-warm-narrator-v1:ttsNorm:3",
    );
    expect(response.headers.get("X-Curio-TTS-Fallback")).toBe("false");
    expect(response.headers.get("X-Curio-TTS-Quota-Mode")).toBe("public");
    expect(response.headers.get("X-Curio-TTS-Quota-Exceeded")).toBe("false");
    expect(Array.from(bytes)).toEqual([0xff, 0xfb, 0x90]);

    expect(fetch).toHaveBeenCalledWith(
      "https://api.openai.com/v1/audio/speech",
      expect.objectContaining({
        method: "POST",
        headers: expect.objectContaining({
          Authorization: "Bearer test-openai-key",
          "Content-Type": "application/json",
        }),
        body: JSON.stringify({
          model: "gpt-4o-mini-tts",
          voice: "marin",
          input: "This article section text is comfortably long enough.",
          instructions:
            "Narrate clearly and calmly for an accessibility-first Wikipedia listening app. Use a warm, natural tone, steady pacing, and crisp pronunciation. Avoid theatrics, impressions, whispers, and exaggerated emotion.",
          response_format: "mp3",
        }),
      }),
    );
  });

  it("rejects a stale expected profile before quota checks or generation", async () => {
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);
    const { POST } = await import("./route");

    const response = await POST(
      new NextRequest("https://curiogarden.org/api/tts", {
        method: "POST",
        body: JSON.stringify({
          text: "This request was queued under an older narration profile.",
          provider: "openai",
          voiceId: "cedar",
          expectedTtsCacheKey:
            "tts:openai:retired-model:cedar:retired-prompt:ttsNorm:3",
        }),
      }),
    );

    expect(response.status).toBe(409);
    await expect(response.json()).resolves.toEqual({
      error:
        "The requested TTS profile is no longer active; retry with the current profile.",
    });
    expect(fetchMutation).not.toHaveBeenCalled();
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("does not forward raw request headers to analytics", async () => {
    vi.stubEnv("OPENAI_API_KEY", "test-openai-key");
    vi.stubEnv("TTS_QUOTA_BYPASS_SECRET", "internal-secret");
    vi.stubGlobal(
      "fetch",
      vi.fn(
        async () =>
          new Response(new Uint8Array([0xff, 0xfb, 0x90]), {
            status: 200,
            headers: { "Content-Type": "audio/mpeg" },
          }),
      ),
    );

    const { POST } = await import("./route");
    const response = await POST(
      new NextRequest("https://curiogarden.org/api/tts", {
        method: "POST",
        headers: {
          cookie: "session=secret",
          authorization: "Bearer user-token",
          ...(await getTtsQuotaBypassHeaders("https://curiogarden.org")),
        },
        body: JSON.stringify({
          text: "This article section text is comfortably long enough.",
        }),
      }),
    );

    expect(response.status).toBe(200);
    expect(track).toHaveBeenCalledOnce();
    const trackCalls = track.mock.calls as unknown as Array<
      [string, Record<string, unknown>, unknown?]
    >;
    expect(trackCalls[0]?.[0]).toBe("TTS Route");
    expect(trackCalls[0]?.[2]).toBeUndefined();
  });

  it("falls back to Edge when OpenAI speech generation fails", async () => {
    vi.stubEnv("OPENAI_API_KEY", "test-openai-key");
    vi.stubEnv("VERCEL_AUTOMATION_BYPASS_SECRET", "preview-bypass-secret");
    vi.stubEnv("VERCEL_URL", "world-garden-preview.vercel.app");
    const fetchMock = vi.fn<typeof fetch>(async (input: RequestInfo | URL) => {
      const url = String(input);
      if (url === "https://api.openai.com/v1/audio/speech") {
        return Response.json(
          { error: { message: "OpenAI unavailable" } },
          { status: 503 },
        );
      }

      if (url === "https://world-garden-preview.vercel.app/api/tts/edge") {
        return new Response(new Uint8Array([0xff, 0xfb, 0x91, 0x64]), {
          status: 200,
          headers: { "Content-Type": "audio/mpeg" },
        });
      }

      throw new Error(`Unexpected fetch: ${url}`);
    });
    vi.stubGlobal("fetch", fetchMock);

    const { POST } = await import("./route");
    const response = await POST(
      new NextRequest("https://curiogarden.org/api/tts", {
        method: "POST",
        body: JSON.stringify({
          text: "This article section text is comfortably long enough.",
        }),
      }),
    );

    const bytes = new Uint8Array(await response.arrayBuffer());

    expect(response.status).toBe(200);
    expect(Array.from(bytes)).toEqual([0xff, 0xfb, 0x91, 0x64]);
    expect(response.headers.get("X-Curio-TTS-Provider")).toBe("edge");
    expect(response.headers.get("X-Curio-TTS-Model")).toBe("edge-tts");
    expect(response.headers.get("X-Curio-TTS-Voice")).toBe("en-US-AriaNeural");
    expect(response.headers.get("X-Curio-TTS-Cache-Key")).toBe(
      "tts:edge:edge-tts:en-US-AriaNeural:edge-default:ttsNorm:3",
    );
    expect(response.headers.get("X-Curio-TTS-Fallback")).toBe("true");
    expect(response.headers.get("X-Curio-TTS-Fallback-Reason")).toBe(
      "openai_error",
    );
    const edgeRequest = fetchMock.mock.calls.find(
      ([input]) =>
        String(input) ===
        "https://world-garden-preview.vercel.app/api/tts/edge",
    );
    expect(
      new Headers(edgeRequest?.[1]?.headers).get("x-vercel-protection-bypass"),
    ).toBe("preview-bypass-secret");
    expect(response.headers.has("x-vercel-protection-bypass")).toBe(false);
    expect(JSON.stringify(track.mock.calls)).not.toContain(
      "preview-bypass-secret",
    );

    await vi.waitFor(() =>
      expect(recordProviderAttempt).toHaveBeenCalledTimes(4),
    );
    const attempts = recordProviderAttempt.mock.calls.map(
      ([attempt]) => attempt,
    );
    const terminalAttempts = attempts.filter(
      (attempt) => attempt.lifecycleVersion === 1,
    );
    expect(terminalAttempts).toEqual([
      expect.objectContaining({
        operation: "tts",
        requestedProvider: "openai",
        effectiveProvider: "openai",
        state: "failed_after_dispatch",
        failureCategory: "provider_http_5xx",
        inputCharacters: 53,
        inputWords: 8,
        isFallbackAttempt: false,
      }),
      expect.objectContaining({
        operation: "tts",
        requestedProvider: "openai",
        effectiveProvider: "edge",
        state: "succeeded",
        failureCategory: null,
        responseAudioBytes: 4,
        audioDurationMs: 3_200,
        durationMeasurement: "estimated",
        isFallbackAttempt: true,
      }),
    ]);
    expect(
      new Set(attempts.map(({ correlationId }) => correlationId)).size,
    ).toBe(1);
    expect(new Set(attempts.map(({ eventKey }) => eventKey)).size).toBe(2);
  });

  it("does not synthesize Edge after a trusted strict OpenAI failure", async () => {
    vi.stubEnv("OPENAI_API_KEY", "test-openai-key");
    vi.stubEnv("TTS_QUOTA_BYPASS_SECRET", "internal-secret");
    const consoleError = vi
      .spyOn(console, "error")
      .mockImplementation(() => undefined);
    const fetchMock = vi.fn<typeof fetch>(async (input: RequestInfo | URL) => {
      const url = String(input);
      if (url === "https://api.openai.com/v1/audio/speech") {
        return Response.json(
          { error: { message: "OpenAI unavailable" } },
          { status: 503 },
        );
      }
      throw new Error(`Unexpected fetch: ${url}`);
    });
    vi.stubGlobal("fetch", fetchMock);

    const headers = await getTrustedTtsGenerationHeaders(
      "https://curiogarden.org",
      "trending_podcast",
      { bypassOpenAiQuota: true },
    );
    const { POST } = await import("./route");
    const response = await POST(
      new NextRequest("https://curiogarden.org/api/tts", {
        method: "POST",
        headers,
        body: JSON.stringify({
          text: "This trusted podcast narration must keep one voice.",
          provider: "openai",
          fallbackPolicy: "forbid",
        }),
      }),
    );

    expect(response.status).toBe(500);
    await expect(response.json()).resolves.toEqual({
      error: "OpenAI unavailable",
    });
    expect(fetchMock.mock.calls.map(([input]) => String(input))).toEqual([
      "https://api.openai.com/v1/audio/speech",
    ]);
    expect(auth).not.toHaveBeenCalled();
    expect(fetchMutation).not.toHaveBeenCalled();
    expect(track).toHaveBeenCalledWith(
      "TTS Route",
      expect.objectContaining({
        provider: "openai",
        requestedProvider: "openai",
        fallback: false,
        fallbackReason: "none",
        status: "error",
      }),
    );
    consoleError.mockRestore();
  });

  it("fails before Edge synthesis when provider access downgrades a trusted strict OpenAI request", async () => {
    vi.stubEnv("TTS_QUOTA_BYPASS_SECRET", "internal-secret");
    vi.doMock("@/lib/tts-access-policy", async (importOriginal) => {
      const actual =
        await importOriginal<typeof import("@/lib/tts-access-policy")>();
      return {
        ...actual,
        resolveTtsProviderAccess: () => ({
          requestedProvider: "openai" as const,
          provider: "edge" as const,
          fallbackReason: "openai_auth" as const,
        }),
      };
    });
    const fetchMock = vi.fn<typeof fetch>();
    vi.stubGlobal("fetch", fetchMock);

    try {
      const headers = await getTrustedTtsGenerationHeaders(
        "https://curiogarden.org",
        "trending_podcast",
        { bypassOpenAiQuota: true },
      );
      const { POST } = await import("./route");
      const response = await POST(
        new NextRequest("https://curiogarden.org/api/tts", {
          method: "POST",
          headers,
          body: JSON.stringify({
            text: "This trusted podcast narration must never use Edge.",
            provider: "openai",
            fallbackPolicy: "forbid",
          }),
        }),
      );

      expect(response.status).toBe(503);
      await expect(response.json()).resolves.toEqual({
        error: "OpenAI TTS is unavailable and Edge fallback is forbidden",
      });
      expect(fetchMock).not.toHaveBeenCalled();
      expect(fetchMutation).not.toHaveBeenCalled();
    } finally {
      vi.doUnmock("@/lib/tts-access-policy");
    }
  });

  it("fails before Edge synthesis when quota is exceeded for a trusted strict OpenAI request", async () => {
    vi.stubEnv("TTS_QUOTA_BYPASS_SECRET", "internal-secret");
    vi.doMock("@/lib/tts-quota", async (importOriginal) => {
      const actual = await importOriginal<typeof import("@/lib/tts-quota")>();
      return {
        ...actual,
        isTtsQuotaBypassRequest: vi.fn(async () => true),
        resolveOpenAiTtsQuota: vi.fn(async () => ({
          mode: "public" as const,
          exceeded: true,
          exceededWindow: "daily" as const,
          fallbackReason: "openai_quota" as const,
        })),
      };
    });
    const fetchMock = vi.fn<typeof fetch>();
    vi.stubGlobal("fetch", fetchMock);

    try {
      const headers = await getTrustedTtsGenerationHeaders(
        "https://curiogarden.org",
        "trending_podcast",
        { bypassOpenAiQuota: true },
      );
      const { POST } = await import("./route");
      const response = await POST(
        new NextRequest("https://curiogarden.org/api/tts", {
          method: "POST",
          headers,
          body: JSON.stringify({
            text: "This trusted podcast narration must never use Edge.",
            provider: "openai",
            fallbackPolicy: "forbid",
          }),
        }),
      );

      expect(response.status).toBe(503);
      await expect(response.json()).resolves.toEqual({
        error: "OpenAI TTS quota is exceeded and Edge fallback is forbidden",
      });
      expect(fetchMock).not.toHaveBeenCalled();
    } finally {
      vi.doUnmock("@/lib/tts-quota");
    }
  });

  it("gives a trusted strict OpenAI request the full upstream timeout", async () => {
    vi.useFakeTimers();
    vi.stubEnv("OPENAI_API_KEY", "test-openai-key");
    vi.stubEnv("TTS_QUOTA_BYPASS_SECRET", "internal-secret");
    vi.stubEnv("TTS_UPSTREAM_TIMEOUT_MS", "100");
    vi.stubEnv("TTS_OPENAI_INTERACTIVE_FALLBACK_MS", "25");
    let openAiAborted = false;
    const fetchMock = vi.fn<typeof fetch>(
      async (input: RequestInfo | URL, init?: RequestInit) => {
        const url = String(input);
        if (url !== "https://api.openai.com/v1/audio/speech") {
          throw new Error(`Unexpected fetch: ${url}`);
        }
        const signal = init?.signal as AbortSignal | undefined;
        return new Promise<Response>((resolve, reject) => {
          signal?.addEventListener("abort", () => {
            openAiAborted = true;
            reject(
              new DOMException("The operation was aborted.", "AbortError"),
            );
          });
          setTimeout(() => {
            resolve(
              new Response(new Uint8Array([0xff, 0xfb, 0x90]), {
                status: 200,
                headers: { "Content-Type": "audio/mpeg" },
              }),
            );
          }, 50);
        });
      },
    );
    vi.stubGlobal("fetch", fetchMock);

    const headers = await getTrustedTtsGenerationHeaders(
      "https://curiogarden.org",
      "trending_podcast",
      { bypassOpenAiQuota: true },
    );
    const { POST } = await import("./route");
    const responsePromise = POST(
      new NextRequest("https://curiogarden.org/api/tts", {
        method: "POST",
        headers,
        body: JSON.stringify({
          text: "This trusted podcast narration may use the full timeout.",
          provider: "openai",
          fallbackPolicy: "forbid",
        }),
      }),
    );

    await vi.waitFor(() => expect(fetchMock).toHaveBeenCalledOnce());
    await vi.advanceTimersByTimeAsync(50);
    const response = await responsePromise;

    expect(response.status).toBe(200);
    expect(response.headers.get("X-Curio-TTS-Provider")).toBe("openai");
    expect(openAiAborted).toBe(false);
    expect(fetchMock).toHaveBeenCalledOnce();
  });

  it("pins strict Trending speech even when general OpenAI overrides differ", async () => {
    vi.stubEnv("OPENAI_API_KEY", "test-openai-key");
    vi.stubEnv("TTS_QUOTA_BYPASS_SECRET", "internal-secret");
    vi.stubEnv("OPENAI_TTS_MODEL", "general-override-model");
    vi.stubEnv("OPENAI_TTS_VOICE", "coral");
    vi.stubEnv("OPENAI_TTS_PROMPT_VERSION", "general-override-v9");
    vi.stubEnv("OPENAI_TTS_INSTRUCTIONS", "General override instructions.");
    const { getTrendingTtsProfile } =
      await import("@/lib/trending-audio-profile");
    const trendingProfile = getTrendingTtsProfile();
    const fetchMock = vi.fn<typeof fetch>(
      async (input: RequestInfo | URL, init?: RequestInit) => {
        expect(String(input)).toBe("https://api.openai.com/v1/audio/speech");
        expect(JSON.parse(String(init?.body))).toEqual({
          input: "This strict Trending narration uses its pinned profile.",
          instructions: trendingProfile.instructions,
          model: "gpt-4o-mini-tts",
          response_format: "mp3",
          voice: "marin",
        });
        return new Response(new Uint8Array([0xff, 0xfb, 0x90]), {
          status: 200,
          headers: { "Content-Type": "audio/mpeg" },
        });
      },
    );
    vi.stubGlobal("fetch", fetchMock);

    const headers = await getTrustedTtsGenerationHeaders(
      "https://curiogarden.org",
      "trending_podcast",
      { bypassOpenAiQuota: true },
    );
    const { POST } = await import("./route");
    const response = await POST(
      new NextRequest("https://curiogarden.org/api/tts", {
        method: "POST",
        headers,
        body: JSON.stringify({
          text: "This strict Trending narration uses its pinned profile.",
          provider: "openai",
          voiceId: "marin",
          fallbackPolicy: "forbid",
          expectedTtsCacheKey: trendingProfile.ttsCacheKey,
        }),
      }),
    );

    expect(response.status).toBe(200);
    expect(response.headers.get("X-Curio-TTS-Model")).toBe("gpt-4o-mini-tts");
    expect(response.headers.get("X-Curio-TTS-Voice")).toBe("marin");
    expect(response.headers.get("X-Curio-TTS-Prompt-Version")).toBe(
      trendingProfile.promptVersion,
    );
    expect(fetchMock).toHaveBeenCalledOnce();
  });

  it("does not synthesize Edge when a trusted strict OpenAI request times out", async () => {
    vi.useFakeTimers();
    vi.stubEnv("OPENAI_API_KEY", "test-openai-key");
    vi.stubEnv("TTS_QUOTA_BYPASS_SECRET", "internal-secret");
    vi.stubEnv("TTS_UPSTREAM_TIMEOUT_MS", "25");
    vi.stubEnv("TTS_OPENAI_INTERACTIVE_FALLBACK_MS", "5");
    const consoleError = vi
      .spyOn(console, "error")
      .mockImplementation(() => undefined);
    let openAiAborted = false;
    const fetchMock = vi.fn<typeof fetch>(
      async (input: RequestInfo | URL, init?: RequestInit) => {
        const url = String(input);
        if (url !== "https://api.openai.com/v1/audio/speech") {
          throw new Error(`Unexpected fetch: ${url}`);
        }
        const signal = init?.signal as AbortSignal | undefined;
        return new Promise<Response>((_resolve, reject) => {
          signal?.addEventListener("abort", () => {
            openAiAborted = true;
            reject(
              new DOMException("The operation was aborted.", "AbortError"),
            );
          });
        });
      },
    );
    vi.stubGlobal("fetch", fetchMock);

    const headers = await getTrustedTtsGenerationHeaders(
      "https://curiogarden.org",
      "trending_podcast",
      { bypassOpenAiQuota: true },
    );
    const { POST } = await import("./route");
    const responsePromise = POST(
      new NextRequest("https://curiogarden.org/api/tts", {
        method: "POST",
        headers,
        body: JSON.stringify({
          text: "This trusted podcast narration must not change voices.",
          provider: "openai",
          fallbackPolicy: "forbid",
        }),
      }),
    );

    await vi.waitFor(() => expect(fetchMock).toHaveBeenCalledOnce());
    await vi.advanceTimersByTimeAsync(25);
    const response = await responsePromise;

    expect(response.status).toBe(500);
    await expect(response.json()).resolves.toEqual({
      error: "OpenAI TTS request timed out after 25ms",
    });
    expect(openAiAborted).toBe(true);
    expect(fetchMock.mock.calls.map(([input]) => String(input))).toEqual([
      "https://api.openai.com/v1/audio/speech",
    ]);
    consoleError.mockRestore();
  });

  it("ignores a strict fallback policy from an interactive caller", async () => {
    vi.stubEnv("OPENAI_API_KEY", "test-openai-key");
    const fetchMock = vi.fn<typeof fetch>(async (input: RequestInfo | URL) => {
      const url = String(input);
      if (url === "https://api.openai.com/v1/audio/speech") {
        return Response.json(
          { error: { message: "OpenAI unavailable" } },
          { status: 503 },
        );
      }
      if (url === "https://curiogarden.org/api/tts/edge") {
        return new Response(new Uint8Array([0xff, 0xfb, 0x91]), {
          status: 200,
          headers: { "Content-Type": "audio/mpeg" },
        });
      }
      throw new Error(`Unexpected fetch: ${url}`);
    });
    vi.stubGlobal("fetch", fetchMock);

    const { POST } = await import("./route");
    const response = await POST(
      new NextRequest("https://curiogarden.org/api/tts", {
        method: "POST",
        body: JSON.stringify({
          text: "This interactive narration retains its normal fallback.",
          provider: "openai",
          fallbackPolicy: "forbid",
        }),
      }),
    );

    expect(response.status).toBe(200);
    expect(response.headers.get("X-Curio-TTS-Provider")).toBe("edge");
    expect(response.headers.get("X-Curio-TTS-Fallback")).toBe("true");
    expect(fetchMock.mock.calls.map(([input]) => String(input))).toEqual([
      "https://api.openai.com/v1/audio/speech",
      "https://curiogarden.org/api/tts/edge",
    ]);
  });

  it("defaults a trusted OpenAI request to allowing Edge fallback", async () => {
    vi.stubEnv("OPENAI_API_KEY", "test-openai-key");
    vi.stubEnv("TTS_QUOTA_BYPASS_SECRET", "internal-secret");
    const fetchMock = vi.fn<typeof fetch>(async (input: RequestInfo | URL) => {
      const url = String(input);
      if (url === "https://api.openai.com/v1/audio/speech") {
        return Response.json(
          { error: { message: "OpenAI unavailable" } },
          { status: 503 },
        );
      }
      if (url === "https://curiogarden.org/api/tts/edge") {
        return new Response(new Uint8Array([0xff, 0xfb, 0x91]), {
          status: 200,
          headers: { "Content-Type": "audio/mpeg" },
        });
      }
      throw new Error(`Unexpected fetch: ${url}`);
    });
    vi.stubGlobal("fetch", fetchMock);

    const headers = await getTrustedTtsGenerationHeaders(
      "https://curiogarden.org",
      "trending_podcast",
      { bypassOpenAiQuota: true },
    );
    const { POST } = await import("./route");
    const response = await POST(
      new NextRequest("https://curiogarden.org/api/tts", {
        method: "POST",
        headers,
        body: JSON.stringify({
          text: "This trusted narration keeps the default fallback behavior.",
          provider: "openai",
        }),
      }),
    );

    expect(response.status).toBe(200);
    expect(response.headers.get("X-Curio-TTS-Provider")).toBe("edge");
    expect(response.headers.get("X-Curio-TTS-Fallback")).toBe("true");
  });

  it("never sends the bypass secret to an untrusted request origin", async () => {
    vi.stubEnv("VERCEL_AUTOMATION_BYPASS_SECRET", "preview-bypass-secret");
    vi.stubEnv("VERCEL_URL", "attacker.example");
    const consoleError = vi
      .spyOn(console, "error")
      .mockImplementation(() => undefined);
    const fetchMock = vi.fn<typeof fetch>();
    vi.stubGlobal("fetch", fetchMock);

    const { POST } = await import("./route");
    const response = await POST(
      new NextRequest("https://attacker.example/api/tts", {
        method: "POST",
        body: JSON.stringify({
          text: "This article section text is comfortably long enough.",
          provider: "edge",
        }),
      }),
    );

    expect(response.status).toBe(500);
    await expect(response.json()).resolves.toEqual({
      error: "Protected Edge TTS origin is unavailable",
    });
    expect(fetchMock).not.toHaveBeenCalled();
    expect(JSON.stringify(consoleError.mock.calls)).not.toContain(
      "preview-bypass-secret",
    );
    consoleError.mockRestore();
  });

  it("preserves OpenAI-to-Edge fallback when attempt recording rejects", async () => {
    vi.stubEnv("OPENAI_API_KEY", "test-openai-key");
    recordProviderAttempt.mockRejectedValue(
      new Error("private ledger database details"),
    );
    const consoleWarn = vi
      .spyOn(console, "warn")
      .mockImplementation(() => undefined);
    const fetchMock = vi.fn<typeof fetch>(async (input: RequestInfo | URL) => {
      if (String(input) === "https://api.openai.com/v1/audio/speech") {
        return Response.json({ error: "unavailable" }, { status: 503 });
      }
      return new Response(new Uint8Array([0xff, 0xfb, 0xa0]), {
        status: 200,
        headers: { "Content-Type": "audio/mpeg" },
      });
    });
    vi.stubGlobal("fetch", fetchMock);

    const { POST } = await import("./route");
    const response = await POST(
      new NextRequest("https://curiogarden.org/api/tts", {
        method: "POST",
        body: JSON.stringify({
          text: "This article section text is comfortably long enough.",
        }),
      }),
    );

    expect(response.status).toBe(200);
    expect(response.headers.get("X-Curio-TTS-Provider")).toBe("edge");
    expect(response.headers.get("X-Curio-TTS-Fallback")).toBe("true");
    expect(fetchMock).toHaveBeenCalledTimes(2);
    await vi.waitFor(() =>
      expect(recordProviderAttempt).toHaveBeenCalledTimes(4),
    );
    await vi.waitFor(() => expect(consoleWarn).toHaveBeenCalled());
    expect(JSON.stringify(consoleWarn.mock.calls)).not.toContain(
      "private ledger database details",
    );
    consoleWarn.mockRestore();
  });

  it("falls back to Edge when OpenAI speech generation times out", async () => {
    vi.useFakeTimers();
    vi.stubEnv("OPENAI_API_KEY", "test-openai-key");
    vi.stubEnv("TTS_UPSTREAM_TIMEOUT_MS", "25");
    vi.stubGlobal(
      "fetch",
      vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
        const url = String(input);
        if (url === "https://api.openai.com/v1/audio/speech") {
          const signal = init?.signal as AbortSignal | undefined;
          return new Promise<Response>((resolve, reject) => {
            signal?.addEventListener("abort", () => {
              reject(
                new DOMException("The operation was aborted.", "AbortError"),
              );
            });
            setTimeout(() => {
              resolve(
                new Response(new Uint8Array([0xff, 0xfb, 0x90]), {
                  status: 200,
                  headers: { "Content-Type": "audio/mpeg" },
                }),
              );
            }, 100);
          });
        }

        if (url === "https://curiogarden.org/api/tts/edge") {
          return new Response(new Uint8Array([0xff, 0xfb, 0x91, 0x64]), {
            status: 200,
            headers: { "Content-Type": "audio/mpeg" },
          });
        }

        throw new Error(`Unexpected fetch: ${url}`);
      }),
    );

    const { POST } = await import("./route");
    const responsePromise = POST(
      new NextRequest("https://curiogarden.org/api/tts", {
        method: "POST",
        body: JSON.stringify({
          text: "This article section text is comfortably long enough.",
        }),
      }),
    );

    await vi.waitFor(() => expect(fetch).toHaveBeenCalled());
    await vi.advanceTimersByTimeAsync(100);
    const response = await responsePromise;
    const bytes = new Uint8Array(await response.arrayBuffer());

    expect(response.status).toBe(200);
    expect(Array.from(bytes)).toEqual([0xff, 0xfb, 0x91, 0x64]);
    expect(response.headers.get("X-Curio-TTS-Provider")).toBe("edge");
    expect(response.headers.get("X-Curio-TTS-Fallback")).toBe("true");
    expect(response.headers.get("X-Curio-TTS-Fallback-Reason")).toBe(
      "openai_error",
    );
    await vi.waitFor(() =>
      expect(recordProviderAttempt).toHaveBeenCalledTimes(4),
    );
    const terminals = recordProviderAttempt.mock.calls
      .map(([attempt]) => attempt)
      .filter(({ lifecycleVersion }) => lifecycleVersion === 1);
    expect(terminals).toEqual([
      expect.objectContaining({
        effectiveProvider: "openai",
        state: "unknown_after_dispatch",
        failureCategory: "timeout",
        isFallbackAttempt: false,
      }),
      expect.objectContaining({
        effectiveProvider: "edge",
        state: "succeeded",
        failureCategory: null,
        isFallbackAttempt: true,
      }),
    ]);
  });

  it("falls back to Edge at the OpenAI interactive soft timeout", async () => {
    vi.useFakeTimers();
    vi.stubEnv("OPENAI_API_KEY", "test-openai-key");
    vi.stubEnv("TTS_UPSTREAM_TIMEOUT_MS", "1000");
    vi.stubEnv("TTS_OPENAI_INTERACTIVE_FALLBACK_MS", "25");
    let openAiAborted = false;

    vi.stubGlobal(
      "fetch",
      vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
        const url = String(input);
        if (url === "https://api.openai.com/v1/audio/speech") {
          const signal = init?.signal as AbortSignal | undefined;
          return new Promise<Response>((resolve, reject) => {
            signal?.addEventListener("abort", () => {
              openAiAborted = true;
              reject(
                new DOMException("The operation was aborted.", "AbortError"),
              );
            });
            setTimeout(() => {
              resolve(
                new Response(new Uint8Array([0xff, 0xfb, 0x90]), {
                  status: 200,
                  headers: { "Content-Type": "audio/mpeg" },
                }),
              );
            }, 500);
          });
        }

        if (url === "https://curiogarden.org/api/tts/edge") {
          return new Response(new Uint8Array([0xff, 0xfb, 0x91, 0x64]), {
            status: 200,
            headers: { "Content-Type": "audio/mpeg" },
          });
        }

        throw new Error(`Unexpected fetch: ${url}`);
      }),
    );

    const { POST } = await import("./route");
    const responsePromise = POST(
      new NextRequest("https://curiogarden.org/api/tts", {
        method: "POST",
        body: JSON.stringify({
          text: "This article section text is comfortably long enough.",
        }),
      }),
    );

    await vi.waitFor(() => expect(fetch).toHaveBeenCalled());
    await vi.advanceTimersByTimeAsync(25);
    const sentinel = Symbol("pending");
    const resultPromise = Promise.race([
      responsePromise,
      new Promise<typeof sentinel>((resolve) =>
        setTimeout(() => resolve(sentinel), 1),
      ),
    ]);
    await vi.advanceTimersByTimeAsync(1);
    const result = await resultPromise;

    expect(result).not.toBe(sentinel);
    const response = result as Response;
    expect(response.status).toBe(200);
    expect(openAiAborted).toBe(true);
    expect(response.headers.get("X-Curio-TTS-Provider")).toBe("edge");
    expect(response.headers.get("X-Curio-TTS-Fallback")).toBe("true");
    expect(response.headers.get("X-Curio-TTS-Fallback-Reason")).toBe(
      "openai_error",
    );
    expect(track).toHaveBeenCalledWith(
      "TTS Route",
      expect.objectContaining({
        provider: "edge",
        requestedProvider: "openai",
        fallback: true,
        fallbackReason: "openai_error",
        status: "success",
        statusCode: 200,
      }),
    );
  });

  it("returns a clean OpenAI timeout error when fallback is disabled", async () => {
    vi.useFakeTimers();
    vi.stubEnv("OPENAI_API_KEY", "test-openai-key");
    vi.stubEnv("TTS_EDGE_FALLBACK", "false");
    vi.stubEnv("TTS_UPSTREAM_TIMEOUT_MS", "1000");
    vi.stubEnv("TTS_OPENAI_INTERACTIVE_FALLBACK_MS", "25");
    const consoleError = vi
      .spyOn(console, "error")
      .mockImplementation(() => undefined);

    vi.stubGlobal(
      "fetch",
      vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
        const url = String(input);
        if (url === "https://api.openai.com/v1/audio/speech") {
          const signal = init?.signal as AbortSignal | undefined;
          return new Promise<Response>((resolve, reject) => {
            signal?.addEventListener("abort", () => {
              reject(
                new DOMException("The operation was aborted.", "AbortError"),
              );
            });
            setTimeout(() => {
              resolve(
                new Response(new Uint8Array([0xff, 0xfb, 0x90]), {
                  status: 200,
                  headers: { "Content-Type": "audio/mpeg" },
                }),
              );
            }, 500);
          });
        }

        throw new Error(`Unexpected fetch: ${url}`);
      }),
    );

    const { POST } = await import("./route");
    const responsePromise = POST(
      new NextRequest("https://curiogarden.org/api/tts", {
        method: "POST",
        body: JSON.stringify({
          text: "This article section text is comfortably long enough.",
        }),
      }),
    );

    await vi.waitFor(() => expect(fetch).toHaveBeenCalled());
    await vi.advanceTimersByTimeAsync(25);
    const response = await responsePromise;

    expect(response.status).toBe(500);
    await expect(response.json()).resolves.toEqual({
      error: "OpenAI TTS request timed out after 25ms",
    });
    expect(track).toHaveBeenCalledWith(
      "TTS Route",
      expect.objectContaining({
        provider: "openai",
        requestedProvider: "openai",
        fallback: false,
        fallbackReason: "none",
        status: "error",
        statusCode: 500,
      }),
    );

    consoleError.mockRestore();
  });

  it("classifies an empty OpenAI body as a known after-dispatch failure", async () => {
    vi.stubEnv("OPENAI_API_KEY", "test-openai-key");
    vi.stubEnv("TTS_EDGE_FALLBACK", "false");
    const consoleError = vi
      .spyOn(console, "error")
      .mockImplementation(() => undefined);
    vi.stubGlobal(
      "fetch",
      vi.fn(
        async () =>
          new Response(new Uint8Array(), {
            status: 200,
            headers: { "Content-Type": "audio/mpeg" },
          }),
      ),
    );

    const { POST } = await import("./route");
    const response = await POST(
      new NextRequest("https://curiogarden.org/api/tts", {
        method: "POST",
        body: JSON.stringify({
          text: "This article section text is comfortably long enough.",
          provider: "openai",
        }),
      }),
    );

    expect(response.status).toBe(500);
    await vi.waitFor(() =>
      expect(recordProviderAttempt).toHaveBeenCalledTimes(2),
    );
    expect(recordProviderAttempt.mock.calls[1]?.[0]).toMatchObject({
      lifecycleVersion: 1,
      effectiveProvider: "openai",
      state: "failed_after_dispatch",
      failureCategory: "empty_response",
      responseAudioBytes: null,
      audioDurationMs: null,
      durationMeasurement: "unknown",
    });
    consoleError.mockRestore();
  });

  it("returns an error when both OpenAI and Edge fallback time out", async () => {
    vi.useFakeTimers();
    vi.stubEnv("OPENAI_API_KEY", "test-openai-key");
    vi.stubEnv("TTS_UPSTREAM_TIMEOUT_MS", "25");
    const consoleError = vi
      .spyOn(console, "error")
      .mockImplementation(() => undefined);
    vi.stubGlobal(
      "fetch",
      vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
        const url = String(input);
        if (
          url === "https://api.openai.com/v1/audio/speech" ||
          url === "https://curiogarden.org/api/tts/edge"
        ) {
          const signal = init?.signal as AbortSignal | undefined;
          return new Promise<Response>((resolve, reject) => {
            signal?.addEventListener("abort", () => {
              reject(
                new DOMException("The operation was aborted.", "AbortError"),
              );
            });
            setTimeout(() => {
              if (url === "https://api.openai.com/v1/audio/speech") {
                reject(new Error("OpenAI eventually failed"));
              } else {
                resolve(
                  new Response(new Uint8Array([0xff, 0xfb, 0x91]), {
                    status: 200,
                    headers: { "Content-Type": "audio/mpeg" },
                  }),
                );
              }
            }, 100);
          });
        }

        throw new Error(`Unexpected fetch: ${url}`);
      }),
    );

    const { POST } = await import("./route");
    const responsePromise = POST(
      new NextRequest("https://curiogarden.org/api/tts", {
        method: "POST",
        body: JSON.stringify({
          text: "This article section text is comfortably long enough.",
        }),
      }),
    );

    await vi.waitFor(() => expect(fetch).toHaveBeenCalled());
    await vi.advanceTimersByTimeAsync(200);
    const response = await responsePromise;

    expect(response.status).toBe(500);
    await expect(response.json()).resolves.toEqual({
      error: "TTS upstream request timed out after 25ms",
    });
    expect(consoleError.mock.calls[0]?.[0]).toBe("Edge TTS generation failed:");
    expect(track).toHaveBeenCalledWith(
      "TTS Route",
      expect.objectContaining({
        provider: "edge",
        requestedProvider: "openai",
        fallback: true,
        fallbackReason: "openai_error",
        status: "error",
        statusCode: 500,
      }),
    );

    consoleError.mockRestore();
  });

  it("attributes Edge fallback failures to the effective provider", async () => {
    vi.stubEnv("OPENAI_API_KEY", "test-openai-key");
    const consoleError = vi
      .spyOn(console, "error")
      .mockImplementation(() => undefined);
    vi.stubGlobal(
      "fetch",
      vi.fn(async (input: RequestInfo | URL) => {
        const url = String(input);
        if (url === "https://api.openai.com/v1/audio/speech") {
          return Response.json(
            { error: { message: "OpenAI unavailable" } },
            { status: 503 },
          );
        }

        if (url === "https://curiogarden.org/api/tts/edge") {
          return Response.json({ error: "Edge unavailable" }, { status: 502 });
        }

        throw new Error(`Unexpected fetch: ${url}`);
      }),
    );

    const { POST } = await import("./route");
    const response = await POST(
      new NextRequest("https://curiogarden.org/api/tts", {
        method: "POST",
        body: JSON.stringify({
          text: "This article section text is comfortably long enough.",
        }),
      }),
    );

    expect(response.status).toBe(500);
    expect(consoleError.mock.calls[0]?.[0]).toBe("Edge TTS generation failed:");
    expect(track).toHaveBeenCalledWith(
      "TTS Route",
      expect.objectContaining({
        provider: "edge",
        requestedProvider: "openai",
        fallback: true,
        status: "error",
        statusCode: 500,
      }),
    );

    consoleError.mockRestore();
  });

  it("uses Edge when an authenticated request exceeds the OpenAI burst quota", async () => {
    vi.stubEnv("OPENAI_API_KEY", "test-openai-key");
    fetchMutation.mockResolvedValueOnce({
      allowed: false,
      remaining: 0,
      resetAt: Date.now() + 60_000,
    });
    vi.stubGlobal(
      "fetch",
      vi.fn(async (input: RequestInfo | URL) => {
        const url = String(input);
        if (url === "https://api.openai.com/v1/audio/speech") {
          throw new Error("OpenAI should not be called after quota fallback");
        }
        if (url === "https://curiogarden.org/api/tts/edge") {
          return new Response(new Uint8Array([0xff, 0xfb, 0x92]), {
            status: 200,
            headers: { "Content-Type": "audio/mpeg" },
          });
        }
        throw new Error(`Unexpected fetch: ${url}`);
      }),
    );

    const { POST } = await import("./route");
    const response = await POST(
      new NextRequest("https://curiogarden.org/api/tts", {
        method: "POST",
        headers: { "x-forwarded-for": "203.0.113.10" },
        body: JSON.stringify({
          text: "This article section text is comfortably long enough.",
        }),
      }),
    );

    expect(response.status).toBe(200);
    expect(response.headers.get("X-Curio-TTS-Provider")).toBe("edge");
    expect(response.headers.get("X-Curio-TTS-Fallback")).toBe("true");
    expect(response.headers.get("X-Curio-TTS-Fallback-Reason")).toBe(
      "openai_quota",
    );
    expect(response.headers.get("X-Curio-TTS-Quota-Mode")).toBe("public");
    expect(response.headers.get("X-Curio-TTS-Quota-Exceeded")).toBe("true");
    expect(fetchMutation).toHaveBeenCalledTimes(1);
  });

  it("uses Edge when an authenticated request exceeds the OpenAI daily quota", async () => {
    vi.stubEnv("OPENAI_API_KEY", "test-openai-key");
    fetchMutation
      .mockResolvedValueOnce({
        allowed: true,
        remaining: 119,
        resetAt: Date.now() + 60_000,
      })
      .mockResolvedValueOnce({
        allowed: false,
        remaining: 0,
        resetAt: Date.now() + 86_400_000,
      });
    vi.stubGlobal(
      "fetch",
      vi.fn(async (input: RequestInfo | URL) => {
        const url = String(input);
        if (url === "https://api.openai.com/v1/audio/speech") {
          throw new Error("OpenAI should not be called after quota fallback");
        }
        if (url === "https://curiogarden.org/api/tts/edge") {
          return new Response(new Uint8Array([0xff, 0xfb, 0x93]), {
            status: 200,
            headers: { "Content-Type": "audio/mpeg" },
          });
        }
        throw new Error(`Unexpected fetch: ${url}`);
      }),
    );

    const { POST } = await import("./route");
    const response = await POST(
      new NextRequest("https://curiogarden.org/api/tts", {
        method: "POST",
        headers: { "x-forwarded-for": "203.0.113.10" },
        body: JSON.stringify({
          text: "This article section text is comfortably long enough.",
        }),
      }),
    );

    expect(response.status).toBe(200);
    expect(response.headers.get("X-Curio-TTS-Provider")).toBe("edge");
    expect(response.headers.get("X-Curio-TTS-Fallback-Reason")).toBe(
      "openai_quota",
    );
    expect(fetchMutation).toHaveBeenCalledTimes(2);
  });

  it("uses Edge when an authenticated OpenAI quota check fails", async () => {
    vi.stubEnv("OPENAI_API_KEY", "test-openai-key");
    fetchMutation.mockRejectedValueOnce(new Error("Convex unavailable"));
    const fetchCalls: string[] = [];
    vi.stubGlobal(
      "fetch",
      vi.fn(async (input: RequestInfo | URL) => {
        const url = String(input);
        fetchCalls.push(url);
        if (url === "https://api.openai.com/v1/audio/speech") {
          throw new Error(
            "OpenAI should not be called after quota check failure",
          );
        }
        if (url === "https://curiogarden.org/api/tts/edge") {
          return new Response(new Uint8Array([0xff, 0xfb, 0x97]), {
            status: 200,
            headers: { "Content-Type": "audio/mpeg" },
          });
        }
        throw new Error(`Unexpected fetch: ${url}`);
      }),
    );

    const { POST } = await import("./route");
    const response = await POST(
      new NextRequest("https://curiogarden.org/api/tts", {
        method: "POST",
        headers: { "x-forwarded-for": "203.0.113.10" },
        body: JSON.stringify({
          text: "This article section text is comfortably long enough.",
        }),
      }),
    );

    expect(response.status).toBe(200);
    expect(fetchCalls).toEqual(["https://curiogarden.org/api/tts/edge"]);
    expect(response.headers.get("X-Curio-TTS-Provider")).toBe("edge");
    expect(response.headers.get("X-Curio-TTS-Fallback-Reason")).toBe(
      "openai_quota",
    );
    expect(response.headers.get("X-Curio-TTS-Quota-Exceeded")).toBe("true");
  });

  it("keeps an omitted trusted request on Edge without consuming quota", async () => {
    vi.stubEnv("OPENAI_API_KEY", "test-openai-key");
    vi.stubEnv("TTS_QUOTA_BYPASS_SECRET", "internal-secret");
    vi.stubGlobal(
      "fetch",
      vi.fn(
        async () =>
          new Response(new Uint8Array([0xff, 0xfb, 0x94]), {
            status: 200,
            headers: { "Content-Type": "audio/mpeg" },
          }),
      ),
    );

    const { POST } = await import("./route");
    const response = await POST(
      new NextRequest("https://curiogarden.org/api/tts", {
        method: "POST",
        headers: {
          ...(await getTtsQuotaBypassHeaders("https://curiogarden.org")),
          "x-forwarded-for": "203.0.113.10",
        },
        body: JSON.stringify({
          text: "This article section text is comfortably long enough.",
        }),
      }),
    );

    expect(response.status).toBe(200);
    expect(response.headers.get("X-Curio-TTS-Provider")).toBe("edge");
    expect(response.headers.get("X-Curio-TTS-Quota-Mode")).toBe(
      "edge_requested",
    );
    expect(auth).not.toHaveBeenCalled();
    expect(fetchMutation).not.toHaveBeenCalled();
  });

  it("does not bypass authenticated OpenAI quota with an incorrect header", async () => {
    vi.stubEnv("OPENAI_API_KEY", "test-openai-key");
    vi.stubEnv("TTS_QUOTA_BYPASS_SECRET", "internal-secret");
    fetchMutation.mockResolvedValueOnce({
      allowed: false,
      remaining: 0,
      resetAt: Date.now() + 60_000,
    });
    vi.stubGlobal(
      "fetch",
      vi.fn(async (input: RequestInfo | URL) => {
        const url = String(input);
        if (url === "https://curiogarden.org/api/tts/edge") {
          return new Response(new Uint8Array([0xff, 0xfb, 0x95]), {
            status: 200,
            headers: { "Content-Type": "audio/mpeg" },
          });
        }
        throw new Error(`Unexpected fetch: ${url}`);
      }),
    );

    const { POST } = await import("./route");
    const response = await POST(
      new NextRequest("https://curiogarden.org/api/tts", {
        method: "POST",
        headers: {
          "x-curio-tts-quota-bypass": "wrong-secret",
          "x-forwarded-for": "203.0.113.10",
        },
        body: JSON.stringify({
          text: "This article section text is comfortably long enough.",
        }),
      }),
    );

    expect(response.status).toBe(200);
    expect(response.headers.get("X-Curio-TTS-Provider")).toBe("edge");
    expect(response.headers.get("X-Curio-TTS-Fallback-Reason")).toBe(
      "openai_quota",
    );
    expect(fetchMutation).toHaveBeenCalledTimes(1);
  });

  it("skips OpenAI quota for explicit Edge requests", async () => {
    const fetchMock = vi.fn<typeof fetch>(async (input: RequestInfo | URL) => {
      const url = String(input);
      if (url === "https://curiogarden.org/api/tts/edge") {
        return new Response(new Uint8Array([0xff, 0xfb, 0x96]), {
          status: 200,
          headers: { "Content-Type": "audio/mpeg" },
        });
      }
      throw new Error(`Unexpected fetch: ${url}`);
    });
    vi.stubGlobal("fetch", fetchMock);

    const { POST } = await import("./route");
    const response = await POST(
      new NextRequest("https://curiogarden.org/api/tts", {
        method: "POST",
        body: JSON.stringify({
          text: "This article section text is comfortably long enough.",
          provider: "edge",
        }),
      }),
    );

    expect(response.status).toBe(200);
    expect(response.headers.get("X-Curio-TTS-Provider")).toBe("edge");
    expect(response.headers.get("X-Curio-TTS-Quota-Mode")).toBe(
      "edge_requested",
    );
    expect(fetchMutation).not.toHaveBeenCalled();
    expect(
      new Headers(fetchMock.mock.calls[0]?.[1]?.headers).has(
        "x-vercel-protection-bypass",
      ),
    ).toBe(false);
  });

  it("returns a configuration error when OpenAI is forced without a key or fallback", async () => {
    vi.stubEnv("TTS_EDGE_FALLBACK", "false");

    const { POST } = await import("./route");
    const response = await POST(
      new NextRequest("https://curiogarden.org/api/tts", {
        method: "POST",
        body: JSON.stringify({
          text: "This article section text is comfortably long enough.",
          provider: "openai",
        }),
      }),
    );

    expect(response.status).toBe(500);
    await expect(response.json()).resolves.toEqual({
      error: "OPENAI_API_KEY is required for OpenAI TTS",
    });
    await vi.waitFor(() =>
      expect(recordProviderAttempt).toHaveBeenCalledTimes(1),
    );
    expect(recordProviderAttempt).toHaveBeenCalledWith(
      expect.objectContaining({
        lifecycleVersion: 1,
        operation: "tts",
        effectiveProvider: "openai",
        state: "failed_before_dispatch",
        failureCategory: "configuration",
        dispatchedAt: null,
        completedAt: expect.any(Number),
      }),
    );
  });

  it("keeps successful speech delivery fail-open when the recorder rejects", async () => {
    const consoleWarn = vi
      .spyOn(console, "warn")
      .mockImplementation(() => undefined);
    recordProviderAttempt.mockRejectedValue(
      new Error("ledger database details"),
    );
    vi.stubGlobal(
      "fetch",
      vi.fn(
        async () =>
          new Response(new Uint8Array([0xff, 0xfb, 0x99]), {
            status: 200,
            headers: { "Content-Type": "audio/mpeg" },
          }),
      ),
    );

    const { POST } = await import("./route");
    const response = await POST(
      new NextRequest("https://curiogarden.org/api/tts", {
        method: "POST",
        body: JSON.stringify({
          text: "This Edge narration remains available during ledger failure.",
          provider: "edge",
        }),
      }),
    );

    expect(response.status).toBe(200);
    expect(response.headers.get("X-Curio-TTS-Provider")).toBe("edge");
    await vi.waitFor(() => expect(consoleWarn).toHaveBeenCalled());
    expect(JSON.stringify(consoleWarn.mock.calls)).not.toContain(
      "ledger database details",
    );
    consoleWarn.mockRestore();
  });

  it("rejects an invalid explicit OpenAI voice", async () => {
    vi.stubEnv("OPENAI_API_KEY", "test-openai-key");

    const { POST } = await import("./route");
    const response = await POST(
      new NextRequest("https://curiogarden.org/api/tts", {
        method: "POST",
        body: JSON.stringify({
          text: "This article section text is comfortably long enough.",
          voiceId: "en-US-AriaNeural",
        }),
      }),
    );

    expect(response.status).toBe(400);
    await expect(response.json()).resolves.toEqual({
      error: "Unsupported OpenAI TTS voice: en-US-AriaNeural",
    });
  });
});
