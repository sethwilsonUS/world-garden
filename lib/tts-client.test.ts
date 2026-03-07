import { beforeEach, describe, expect, it, vi } from "vitest";

import {
  generateTtsAudio,
  generateTtsAudioUrl,
  splitTtsTextIntoChunks,
} from "./tts-client";
import { TTS_API_ROUTE, TTS_MAX_WORDS_PER_REQUEST } from "./tts-contract";

const makeWords = (prefix: string, count: number): string =>
  Array.from({ length: count }, (_, index) => `${prefix}${index}`).join(" ");

const countWords = (text: string): number =>
  text.split(/\s+/).filter(Boolean).length;

describe("tts-client", () => {
  beforeEach(() => {
    vi.restoreAllMocks();

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

    expect(calls).toHaveLength(2);

    const requestBodies = calls.map(([, init]) =>
      JSON.parse(String(init?.body)) as { text: string },
    );

    for (const body of requestBodies) {
      expect(countWords(body.text)).toBeLessThanOrEqual(
        TTS_MAX_WORDS_PER_REQUEST,
      );
    }

    expect(await blob.text()).toBe(requestBodies.map((body) => body.text).join(""));
  });

  it("splits sentence-free text by words when no softer boundary exists", () => {
    const chunks = splitTtsTextIntoChunks(makeWords("word", 2505));

    expect(chunks).toHaveLength(3);
    expect(chunks.map(countWords)).toEqual([
      TTS_MAX_WORDS_PER_REQUEST,
      TTS_MAX_WORDS_PER_REQUEST,
      105,
    ]);
  });

  it("creates an object URL from the generated audio blob", async () => {
    const url = await generateTtsAudioUrl({
      text: "This article summary is comfortably under the configured request limit.",
    });

    expect(url).toBe("blob:tts-audio");
    expect(URL.createObjectURL).toHaveBeenCalledOnce();
  });
});
