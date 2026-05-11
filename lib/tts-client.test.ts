import { beforeEach, describe, expect, it, vi } from "vitest";

import { addMp3Metadata } from "./audio-metadata";
import {
  generateTtsAudio,
  generateTtsAudioWithMetadata,
  generateTtsAudioUrl,
  generateTtsAudioUrlWithMetadata,
  splitTtsTextIntoChunks,
} from "./tts-client";
import {
  DEFAULT_TTS_MAX_WORDS_PER_REQUEST,
  TTS_API_ROUTE,
} from "./tts-contract";

const makeWords = (prefix: string, count: number): string =>
  Array.from({ length: count }, (_, index) => `${prefix}${index}`).join(" ");

const countWords = (text: string): number =>
  text.split(/\s+/).filter(Boolean).length;
const toBlobBuffer = (bytes: Uint8Array): ArrayBuffer => {
  const buffer = new ArrayBuffer(bytes.byteLength);
  new Uint8Array(buffer).set(bytes);
  return buffer;
};

describe("tts-client", () => {
  beforeEach(() => {
    vi.restoreAllMocks();
    delete process.env.NEXT_PUBLIC_TTS_MAX_WORDS_PER_REQUEST;

    vi.stubGlobal(
      "fetch",
      vi.fn(async (_input: RequestInfo | URL, init?: RequestInit) => {
        const request = JSON.parse(String(init?.body)) as { text: string };
        return {
          ok: true,
          blob: async () =>
            new Blob([request.text], { type: "audio/mpeg" }),
        };
      }),
    );

    vi.spyOn(URL, "createObjectURL").mockReturnValue("blob:tts-audio");
  });

  it("uses a single request when text is under the limit", async () => {
    const text = "This article summary is comfortably under the configured request limit.";

    const blob = await generateTtsAudio({ text });

    expect(fetch).toHaveBeenCalledTimes(1);
    expect(fetch).toHaveBeenCalledWith(
      TTS_API_ROUTE,
      expect.objectContaining({ method: "POST" }),
    );
    expect(await blob.text()).toBe(text);
  });

  it("returns a single chunk directly without invoking blob concatenation", async () => {
    const sliceSpy = vi
      .spyOn(Blob.prototype, "slice")
      .mockImplementation(() => {
        throw new Error("offset is out of bounds");
      });

    const blob = await generateTtsAudio({
      text: "This article summary is comfortably under the configured request limit.",
    });

    expect(await blob.text()).toBe(
      "This article summary is comfortably under the configured request limit.",
    );

    sliceSpy.mockRestore();
  });

  it("chunks oversized text into bounded requests and combines the audio", async () => {
    const text = [
      makeWords("alpha", 700),
      makeWords("beta", 650),
      makeWords("gamma", 300),
    ].join("\n\n");

    const blob = await generateTtsAudio({ text });
    const calls = vi.mocked(fetch).mock.calls;

    expect(calls).toHaveLength(3);

    const requestBodies = calls.map(([, init]) =>
      JSON.parse(String(init?.body)) as { text: string },
    );

    for (const body of requestBodies) {
      expect(countWords(body.text)).toBeLessThanOrEqual(
        DEFAULT_TTS_MAX_WORDS_PER_REQUEST,
      );
    }

    expect(await blob.text()).toBe(requestBodies.map((body) => body.text).join(""));
  });

  it("strips embedded ID3 tags when combining multiple TTS chunks", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async (_input: RequestInfo | URL, init?: RequestInit) => {
        const request = JSON.parse(String(init?.body)) as { text: string };
        const taggedBytes = addMp3Metadata(
          new TextEncoder().encode(request.text),
          {
            title: "Chunk",
            artist: "Curio Garden",
          },
        );

        return {
          ok: true,
          blob: async () =>
            new Blob([toBlobBuffer(taggedBytes)], { type: "audio/mpeg" }),
        };
      }),
    );

    const text = [makeWords("alpha", 700), makeWords("beta", 650)].join("\n\n");
    const blob = await generateTtsAudio({ text });
    const combinedText = await blob.text();

    expect(combinedText).toContain("alpha0");
    expect(combinedText).toContain("beta0");
    expect(combinedText).not.toContain("ID3");
  });

  it("splits sentence-free text by words when no softer boundary exists", () => {
    const chunks = splitTtsTextIntoChunks(makeWords("word", 2505));

    expect(chunks).toHaveLength(4);
    expect(chunks.map(countWords)).toEqual([
      DEFAULT_TTS_MAX_WORDS_PER_REQUEST,
      DEFAULT_TTS_MAX_WORDS_PER_REQUEST,
      DEFAULT_TTS_MAX_WORDS_PER_REQUEST,
      105,
    ]);
  });

  it("honors a lower env-configured chunk limit", () => {
    process.env.NEXT_PUBLIC_TTS_MAX_WORDS_PER_REQUEST = "400";

    const chunks = splitTtsTextIntoChunks(makeWords("word", 1001));

    expect(chunks.map(countWords)).toEqual([400, 400, 201]);
  });

  it("creates an object URL from the generated audio blob", async () => {
    const url = await generateTtsAudioUrl({
      text: "This article summary is comfortably under the configured request limit.",
    });

    expect(url).toBe("blob:tts-audio");
    expect(URL.createObjectURL).toHaveBeenCalledOnce();
  });

  it("returns TTS metadata from response headers", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async (_input: RequestInfo | URL, init?: RequestInit) => {
        const request = JSON.parse(String(init?.body)) as { text: string };
        return new Response(request.text, {
          status: 200,
          headers: {
            "Content-Type": "audio/mpeg",
            "X-Curio-TTS-Provider": "openai",
            "X-Curio-TTS-Model": "gpt-4o-mini-tts",
            "X-Curio-TTS-Voice": "marin",
            "X-Curio-TTS-Prompt-Version": "curio-warm-narrator-v1",
            "X-Curio-TTS-Norm-Version": "ttsNorm:2",
            "X-Curio-TTS-Cache-Key":
              "tts:openai:gpt-4o-mini-tts:marin:curio-warm-narrator-v1:ttsNorm:2",
          },
        });
      }),
    );

    const result = await generateTtsAudioWithMetadata({
      text: "This article summary is comfortably under the configured request limit.",
    });

    expect(await result.blob.text()).toBe(
      "This article summary is comfortably under the configured request limit.",
    );
    expect(result.metadata).toEqual({
      provider: "openai",
      model: "gpt-4o-mini-tts",
      voiceId: "marin",
      promptVersion: "curio-warm-narrator-v1",
      ttsNormVersion: "ttsNorm:2",
      ttsCacheKey:
        "tts:openai:gpt-4o-mini-tts:marin:curio-warm-narrator-v1:ttsNorm:2",
    });
  });

  it("parses fallback reason response headers", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () =>
        new Response("audio", {
          status: 200,
          headers: {
            "Content-Type": "audio/mpeg",
            "X-Curio-TTS-Provider": "edge",
            "X-Curio-TTS-Model": "edge-tts",
            "X-Curio-TTS-Voice": "en-US-AriaNeural",
            "X-Curio-TTS-Prompt-Version": "edge-default",
            "X-Curio-TTS-Norm-Version": "ttsNorm:2",
            "X-Curio-TTS-Cache-Key":
              "tts:edge:edge-tts:en-US-AriaNeural:edge-default:ttsNorm:2",
            "X-Curio-TTS-Fallback": "true",
            "X-Curio-TTS-Fallback-Reason": "openai_quota",
          },
        }),
      ),
    );

    const result = await generateTtsAudioWithMetadata({
      text: "This article summary is comfortably under the configured request limit.",
    });

    expect(result.metadata.provider).toBe("edge");
    expect(result.fallbackReason).toBe("openai_quota");
  });

  it("forwards extra request headers when provided", async () => {
    const headersSeen: Headers[] = [];
    vi.stubGlobal(
      "fetch",
      vi.fn(async (_input: RequestInfo | URL, init?: RequestInit) => {
        headersSeen.push(new Headers(init?.headers));
        return new Response("audio", {
          status: 200,
          headers: { "Content-Type": "audio/mpeg" },
        });
      }),
    );

    await generateTtsAudioWithMetadata(
      {
        text: "This article summary is comfortably under the configured request limit.",
      },
      {
        headers: {
          "X-Curio-TTS-Quota-Bypass": "internal-secret",
        },
      },
    );

    expect(headersSeen[0]?.get("Content-Type")).toBe("application/json");
    expect(headersSeen[0]?.get("X-Curio-TTS-Quota-Bypass")).toBe(
      "internal-secret",
    );
  });

  it("keeps the JSON content type authoritative when forwarding headers", async () => {
    const headersSeen: Headers[] = [];
    vi.stubGlobal(
      "fetch",
      vi.fn(async (_input: RequestInfo | URL, init?: RequestInit) => {
        headersSeen.push(new Headers(init?.headers));
        return new Response("audio", {
          status: 200,
          headers: { "Content-Type": "audio/mpeg" },
        });
      }),
    );

    await generateTtsAudioWithMetadata(
      {
        text: "This article summary is comfortably under the configured request limit.",
      },
      {
        headers: {
          "Content-Type": "text/plain",
          "X-Curio-TTS-Quota-Bypass": "internal-secret",
        },
      },
    );

    expect(headersSeen[0]?.get("Content-Type")).toBe("application/json");
    expect(headersSeen[0]?.get("X-Curio-TTS-Quota-Bypass")).toBe(
      "internal-secret",
    );
  });

  it("retries all chunks with Edge when any OpenAI chunk falls back", async () => {
    process.env.NEXT_PUBLIC_TTS_MAX_WORDS_PER_REQUEST = "3";
    const calls: Array<{ text: string; provider?: string }> = [];

    vi.stubGlobal(
      "fetch",
      vi.fn(async (_input: RequestInfo | URL, init?: RequestInit) => {
        const request = JSON.parse(String(init?.body)) as {
          text: string;
          provider?: string;
        };
        calls.push(request);

        if (request.provider === "edge") {
          return new Response(`edge:${request.text}`, {
            status: 200,
            headers: {
              "Content-Type": "audio/mpeg",
              "X-Curio-TTS-Provider": "edge",
              "X-Curio-TTS-Model": "edge-tts",
              "X-Curio-TTS-Voice": "en-US-AriaNeural",
              "X-Curio-TTS-Prompt-Version": "edge-default",
              "X-Curio-TTS-Norm-Version": "ttsNorm:2",
              "X-Curio-TTS-Cache-Key":
                "tts:edge:edge-tts:en-US-AriaNeural:edge-default:ttsNorm:2",
            },
          });
        }

        const fallback = calls.length === 2;
        return new Response(`${fallback ? "edge" : "openai"}:${request.text}`, {
          status: 200,
          headers: {
            "Content-Type": "audio/mpeg",
            "X-Curio-TTS-Provider": fallback ? "edge" : "openai",
            "X-Curio-TTS-Model": fallback ? "edge-tts" : "gpt-4o-mini-tts",
            "X-Curio-TTS-Voice": fallback ? "en-US-AriaNeural" : "marin",
            "X-Curio-TTS-Prompt-Version": fallback
              ? "edge-default"
              : "curio-warm-narrator-v1",
            "X-Curio-TTS-Norm-Version": "ttsNorm:2",
            "X-Curio-TTS-Cache-Key": fallback
              ? "tts:edge:edge-tts:en-US-AriaNeural:edge-default:ttsNorm:2"
              : "tts:openai:gpt-4o-mini-tts:marin:curio-warm-narrator-v1:ttsNorm:2",
            "X-Curio-TTS-Fallback": fallback ? "true" : "false",
            ...(fallback
              ? { "X-Curio-TTS-Fallback-Reason": "openai_quota" }
              : {}),
          },
        });
      }),
    );

    const result = await generateTtsAudioWithMetadata({
      text: "one two three four five six",
    });

    expect(calls).toEqual([
      { text: "one two three" },
      { text: "four five six" },
      { text: "one two three", provider: "edge" },
      { text: "four five six", provider: "edge" },
    ]);
    expect(result.metadata.provider).toBe("edge");
    expect(result.fallbackReason).toBe("openai_quota");
    expect(await result.blob.text()).toBe(
      "edge:one two threeedge:four five six",
    );
  });

  it("retries all chunks with Edge even when OpenAI was explicitly requested", async () => {
    process.env.NEXT_PUBLIC_TTS_MAX_WORDS_PER_REQUEST = "3";
    const calls: Array<{ text: string; provider?: string }> = [];

    vi.stubGlobal(
      "fetch",
      vi.fn(async (_input: RequestInfo | URL, init?: RequestInit) => {
        const request = JSON.parse(String(init?.body)) as {
          text: string;
          provider?: string;
        };
        calls.push(request);

        if (request.provider === "edge") {
          return new Response(`edge:${request.text}`, {
            status: 200,
            headers: {
              "Content-Type": "audio/mpeg",
              "X-Curio-TTS-Provider": "edge",
              "X-Curio-TTS-Model": "edge-tts",
              "X-Curio-TTS-Voice": "en-US-AriaNeural",
              "X-Curio-TTS-Prompt-Version": "edge-default",
              "X-Curio-TTS-Norm-Version": "ttsNorm:2",
              "X-Curio-TTS-Cache-Key":
                "tts:edge:edge-tts:en-US-AriaNeural:edge-default:ttsNorm:2",
            },
          });
        }

        const fallback = calls.length === 2;
        return new Response(`${fallback ? "edge" : "openai"}:${request.text}`, {
          status: 200,
          headers: {
            "Content-Type": "audio/mpeg",
            "X-Curio-TTS-Provider": fallback ? "edge" : "openai",
            "X-Curio-TTS-Model": fallback ? "edge-tts" : "gpt-4o-mini-tts",
            "X-Curio-TTS-Voice": fallback ? "en-US-AriaNeural" : "marin",
            "X-Curio-TTS-Prompt-Version": fallback
              ? "edge-default"
              : "curio-warm-narrator-v1",
            "X-Curio-TTS-Norm-Version": "ttsNorm:2",
            "X-Curio-TTS-Cache-Key": fallback
              ? "tts:edge:edge-tts:en-US-AriaNeural:edge-default:ttsNorm:2"
              : "tts:openai:gpt-4o-mini-tts:marin:curio-warm-narrator-v1:ttsNorm:2",
            "X-Curio-TTS-Fallback": fallback ? "true" : "false",
          },
        });
      }),
    );

    const result = await generateTtsAudioWithMetadata({
      text: "one two three four five six",
      provider: "openai",
    });

    expect(calls).toEqual([
      { text: "one two three", provider: "openai" },
      { text: "four five six", provider: "openai" },
      { text: "one two three", provider: "edge" },
      { text: "four five six", provider: "edge" },
    ]);
    expect(result.metadata.provider).toBe("edge");
  });

  it("creates an object URL with metadata", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () =>
        new Response("audio", {
          status: 200,
          headers: {
            "Content-Type": "audio/mpeg",
            "X-Curio-TTS-Provider": "openai",
            "X-Curio-TTS-Model": "gpt-4o-mini-tts",
            "X-Curio-TTS-Voice": "marin",
            "X-Curio-TTS-Prompt-Version": "curio-warm-narrator-v1",
            "X-Curio-TTS-Norm-Version": "ttsNorm:2",
            "X-Curio-TTS-Cache-Key":
              "tts:openai:gpt-4o-mini-tts:marin:curio-warm-narrator-v1:ttsNorm:2",
          },
        }),
      ),
    );

    const result = await generateTtsAudioUrlWithMetadata({
      text: "This article summary is comfortably under the configured request limit.",
    });

    expect(result.url).toBe("blob:tts-audio");
    expect(result.metadata.provider).toBe("openai");
  });

  it("includes HTTP details when the TTS endpoint returns a non-JSON error", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => ({
        ok: false,
        status: 502,
        headers: {
          get: () => "text/plain",
        },
        text: async () => "upstream timeout while rendering audio",
      })),
    );

    await expect(
      generateTtsAudio({ text: "This text is definitely long enough." }),
    ).rejects.toThrow(
      "TTS chunk 1/1 failed (6 words): TTS request failed with 502 (text/plain): upstream timeout while rendering audio",
    );
  });
});
