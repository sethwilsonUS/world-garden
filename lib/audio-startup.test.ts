import { describe, expect, it, vi } from "vitest";
import {
  awaitAudioRequest,
  bucketAudioStartupMs,
  createAudioRequestCache,
  getAudioRequestResult,
  primeAudioRequest,
  resolveSummaryAudioStartup,
  selectNextWarmQueueItems,
  startAudioRequest,
  warmAudioRequest,
} from "./audio-startup";
import type { TtsAudioUrlResult } from "./tts-client";

const metadata = {
  provider: "openai" as const,
  model: "gpt-4o-mini-tts",
  voiceId: "marin",
  promptVersion: "curio-warm-narrator-v1",
  ttsNormVersion: "ttsNorm:2",
  ttsCacheKey:
    "tts:openai:gpt-4o-mini-tts:marin:curio-warm-narrator-v1:ttsNorm:2",
};

const audio = (url: string): TtsAudioUrlResult => ({ url, metadata });

describe("resolveSummaryAudioStartup", () => {
  it("uses memory audio before Convex, prefetch, or generation", async () => {
    const generate = vi.fn(async () => audio("generated"));

    const result = await resolveSummaryAudioStartup({
      memory: audio("memory"),
      convex: audio("convex"),
      prefetched: audio("prefetch"),
      inflight: Promise.resolve(audio("inflight")),
      generate,
    });

    expect(result).toEqual({ path: "memory", result: audio("memory") });
    expect(generate).not.toHaveBeenCalled();
  });

  it("uses Convex audio before prefetch or generation", async () => {
    const generate = vi.fn(async () => audio("generated"));

    const result = await resolveSummaryAudioStartup({
      memory: null,
      convex: audio("convex"),
      prefetched: audio("prefetch"),
      inflight: Promise.resolve(audio("inflight")),
      generate,
    });

    expect(result).toEqual({ path: "convex", result: audio("convex") });
    expect(generate).not.toHaveBeenCalled();
  });

  it("awaits an in-flight prefetch before generating new audio", async () => {
    const generate = vi.fn(async () => audio("generated"));

    const result = await resolveSummaryAudioStartup({
      memory: null,
      convex: null,
      prefetched: null,
      inflight: Promise.resolve(audio("inflight")),
      generate,
    });

    expect(result).toEqual({ path: "prefetch", result: audio("inflight") });
    expect(generate).not.toHaveBeenCalled();
  });

  it("generates audio when an in-flight prefetch resolves empty", async () => {
    const generate = vi.fn(async () => audio("generated"));

    const result = await resolveSummaryAudioStartup({
      memory: null,
      convex: null,
      prefetched: null,
      inflight: Promise.resolve(null),
      generate,
    });

    expect(result).toEqual({ path: "generated", result: audio("generated") });
    expect(generate).toHaveBeenCalledTimes(1);
  });

  it("generates audio when no cached or in-flight summary exists", async () => {
    const generate = vi.fn(async () => audio("generated"));

    const result = await resolveSummaryAudioStartup({
      memory: null,
      convex: null,
      prefetched: null,
      inflight: null,
      generate,
    });

    expect(result).toEqual({ path: "generated", result: audio("generated") });
    expect(generate).toHaveBeenCalledTimes(1);
  });
});

describe("audio request cache", () => {
  it("shares an in-flight section request across warm and playback callers", async () => {
    const cache = createAudioRequestCache();
    const generate = vi.fn(async () => audio("section"));

    const warmPromise = warmAudioRequest(cache, "section-0", generate);
    const playbackPromise = startAudioRequest(cache, "section-0", generate);

    await expect(warmPromise).resolves.toEqual(audio("section"));
    await expect(playbackPromise).resolves.toEqual(audio("section"));
    expect(generate).toHaveBeenCalledTimes(1);
    expect(getAudioRequestResult(cache, "section-0")).toEqual(audio("section"));
  });

  it("clears failed warm attempts so playback can retry", async () => {
    const cache = createAudioRequestCache();
    const generate = vi
      .fn<() => Promise<TtsAudioUrlResult>>()
      .mockRejectedValueOnce(new Error("TTS failed"))
      .mockResolvedValueOnce(audio("retry"));

    await expect(warmAudioRequest(cache, "section-0", generate)).resolves.toBeNull();
    expect(awaitAudioRequest(cache, "section-0")).toBeNull();

    await expect(startAudioRequest(cache, "section-0", generate)).resolves.toEqual(
      audio("retry"),
    );
    expect(generate).toHaveBeenCalledTimes(2);
  });

  it("uses a primed result without generating again", async () => {
    const cache = createAudioRequestCache();
    const generate = vi.fn(async () => audio("generated"));

    primeAudioRequest(cache, "section-0", audio("convex"));
    await expect(startAudioRequest(cache, "section-0", generate)).resolves.toEqual(
      audio("convex"),
    );

    expect(generate).not.toHaveBeenCalled();
  });
});

describe("selectNextWarmQueueItems", () => {
  it("selects only the next two playable non-summary items", () => {
    expect(
      selectNextWarmQueueItems([
        { sectionKey: "summary", sectionIdx: null },
        { sectionKey: "section-0", sectionIdx: 0 },
        { sectionKey: "section-1", sectionIdx: 1, canWarm: false },
        { sectionKey: "section-2", sectionIdx: 2 },
        { sectionKey: "section-3", sectionIdx: 3 },
      ]),
    ).toEqual([
      { sectionKey: "section-0", sectionIdx: 0 },
      { sectionKey: "section-2", sectionIdx: 2 },
    ]);
  });
});

describe("bucketAudioStartupMs", () => {
  it("groups startup times into stable analytics buckets", () => {
    expect(bucketAudioStartupMs(120)).toBe("<250ms");
    expect(bucketAudioStartupMs(800)).toBe("250-999ms");
    expect(bucketAudioStartupMs(2400)).toBe("1-2.9s");
    expect(bucketAudioStartupMs(4200)).toBe("3-5.9s");
    expect(bucketAudioStartupMs(9000)).toBe("6s+");
  });
});
