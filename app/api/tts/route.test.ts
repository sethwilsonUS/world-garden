import { NextRequest } from "next/server";
import { beforeEach, describe, expect, it, vi } from "vitest";

const fetchMutation = vi.hoisted(() => vi.fn());
const track = vi.hoisted(() => vi.fn(async () => {}));
const after = vi.hoisted(() => vi.fn((task: () => void) => task()));

vi.mock("convex/nextjs", () => ({
  fetchMutation,
}));

vi.mock("@vercel/analytics/server", () => ({
  track,
}));

vi.mock("next/server", async () => {
  const actual = await vi.importActual<typeof import("next/server")>(
    "next/server",
  );
  return {
    ...actual,
    after,
  };
});

describe("POST /api/tts", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.resetModules();
    vi.unstubAllEnvs();
    vi.unstubAllGlobals();
    fetchMutation.mockResolvedValue({
      allowed: true,
      remaining: 119,
      resetAt: Date.now() + 60_000,
    });
  });

  it("generates OpenAI speech by default and returns provider metadata headers", async () => {
    vi.stubEnv("OPENAI_API_KEY", "test-openai-key");
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => new Response(new Uint8Array([0xff, 0xfb, 0x90]), {
        status: 200,
        headers: { "Content-Type": "audio/mpeg" },
      })),
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
      "tts:openai:gpt-4o-mini-tts:marin:curio-warm-narrator-v1:ttsNorm:2",
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

  it("does not forward raw request headers to analytics", async () => {
    vi.stubEnv("OPENAI_API_KEY", "test-openai-key");
    vi.stubEnv("TTS_QUOTA_BYPASS_SECRET", "internal-secret");
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => new Response(new Uint8Array([0xff, 0xfb, 0x90]), {
        status: 200,
        headers: { "Content-Type": "audio/mpeg" },
      })),
    );

    const { POST } = await import("./route");
    const response = await POST(
      new NextRequest("https://curiogarden.org/api/tts", {
        method: "POST",
        headers: {
          cookie: "session=secret",
          authorization: "Bearer user-token",
          "x-curio-tts-quota-bypass": "internal-secret",
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
    vi.stubGlobal(
      "fetch",
      vi.fn(async (input: RequestInfo | URL) => {
        const url = String(input);
        if (url === "https://api.openai.com/v1/audio/speech") {
          return Response.json({ error: { message: "OpenAI unavailable" } }, { status: 503 });
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
      "tts:edge:edge-tts:en-US-AriaNeural:edge-default:ttsNorm:2",
    );
    expect(response.headers.get("X-Curio-TTS-Fallback")).toBe("true");
    expect(response.headers.get("X-Curio-TTS-Fallback-Reason")).toBe(
      "openai_error",
    );
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
          return Response.json({ error: { message: "OpenAI unavailable" } }, { status: 503 });
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

  it("uses Edge instead of OpenAI when the public burst quota is exceeded", async () => {
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

  it("uses Edge instead of OpenAI when the public daily quota is exceeded", async () => {
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

  it("uses Edge instead of OpenAI when the quota check fails", async () => {
    vi.stubEnv("OPENAI_API_KEY", "test-openai-key");
    fetchMutation.mockRejectedValueOnce(new Error("Convex unavailable"));
    const fetchCalls: string[] = [];
    vi.stubGlobal(
      "fetch",
      vi.fn(async (input: RequestInfo | URL) => {
        const url = String(input);
        fetchCalls.push(url);
        if (url === "https://api.openai.com/v1/audio/speech") {
          throw new Error("OpenAI should not be called after quota check failure");
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

  it("skips public quota when the trusted bypass header matches", async () => {
    vi.stubEnv("OPENAI_API_KEY", "test-openai-key");
    vi.stubEnv("TTS_QUOTA_BYPASS_SECRET", "internal-secret");
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => new Response(new Uint8Array([0xff, 0xfb, 0x94]), {
        status: 200,
        headers: { "Content-Type": "audio/mpeg" },
      })),
    );

    const { POST } = await import("./route");
    const response = await POST(
      new NextRequest("https://curiogarden.org/api/tts", {
        method: "POST",
        headers: {
          "x-curio-tts-quota-bypass": "internal-secret",
          "x-forwarded-for": "203.0.113.10",
        },
        body: JSON.stringify({
          text: "This article section text is comfortably long enough.",
        }),
      }),
    );

    expect(response.status).toBe(200);
    expect(response.headers.get("X-Curio-TTS-Provider")).toBe("openai");
    expect(response.headers.get("X-Curio-TTS-Quota-Mode")).toBe("bypass");
    expect(fetchMutation).not.toHaveBeenCalled();
  });

  it("does not bypass public quota with an incorrect bypass header", async () => {
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
    vi.stubGlobal(
      "fetch",
      vi.fn(async (input: RequestInfo | URL) => {
        const url = String(input);
        if (url === "https://curiogarden.org/api/tts/edge") {
          return new Response(new Uint8Array([0xff, 0xfb, 0x96]), {
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
