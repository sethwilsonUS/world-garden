import { beforeEach, describe, expect, it, vi } from "vitest";

import { addMp3Metadata } from "./audio-metadata";
import {
  generateTtsAudio,
  generateTtsAudioUrl,
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
          blob: async () => new Blob([taggedBytes], { type: "audio/mpeg" }),
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
