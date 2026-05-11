import { afterEach, describe, expect, it, vi } from "vitest";
import {
  awaitAudioRequest,
  bucketAudioStartupMs,
  clearAudioRequest,
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

afterEach(() => {
  vi.useRealTimers();
});

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
  it("times out and clears a stale in-flight request so playback can retry", async () => {
    vi.useFakeTimers();
    const cache = createAudioRequestCache();
    const generate = vi.fn(
      () =>
        new Promise<TtsAudioUrlResult>((resolve) => {
          setTimeout(() => resolve(audio("stale")), 50);
        }),
    );

    startAudioRequest(cache, "section-0", generate);
    const wait = awaitAudioRequest(cache, "section-0", {
      timeoutMs: 10,
      clearOnTimeout: true,
    });

    await vi.advanceTimersByTimeAsync(50);

    await expect(wait).resolves.toBeNull();
    expect(awaitAudioRequest(cache, "section-0")).toBeNull();
    await expect(startAudioRequest(cache, "section-0", async () => audio("retry"))).resolves.toEqual(
      audio("retry"),
    );
    expect(generate).toHaveBeenCalledTimes(1);

    vi.useRealTimers();
  });

  it("times stale waits from the original warm request start", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(0);

    const cache = createAudioRequestCache();
    const generate = vi.fn(
      () =>
        new Promise<TtsAudioUrlResult>((resolve) => {
          setTimeout(() => resolve(audio("warm")), 10_000);
        }),
    );

    startAudioRequest(cache, "section-0", generate, { owner: "warm" });

    await vi.advanceTimersByTimeAsync(4_000);
    const wait = awaitAudioRequest(cache, "section-0", {
      staleAfterMs: 5_000,
      clearOnTimeout: true,
    });

    expect(wait).not.toBeNull();

    const resolved = vi.fn();
    wait?.then(resolved);

    await vi.advanceTimersByTimeAsync(999);
    expect(resolved).not.toHaveBeenCalled();

    await vi.advanceTimersByTimeAsync(1);
    await expect(wait).resolves.toBeNull();
    expect(cache.has("section-0")).toBe(false);

    vi.useRealTimers();
  });

  it("reuses a fresh warm request when it resolves before becoming stale", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(0);

    const cache = createAudioRequestCache();
    const generate = vi.fn(
      () =>
        new Promise<TtsAudioUrlResult>((resolve) => {
          setTimeout(() => resolve(audio("fresh")), 4_000);
        }),
    );

    startAudioRequest(cache, "section-0", generate, { owner: "warm" });

    await vi.advanceTimersByTimeAsync(1_000);
    const wait = awaitAudioRequest(cache, "section-0", {
      staleAfterMs: 5_000,
      clearOnTimeout: true,
    });

    await vi.advanceTimersByTimeAsync(3_000);

    await expect(wait).resolves.toEqual(audio("fresh"));
    expect(generate).toHaveBeenCalledTimes(1);
    expect(getAudioRequestResult(cache, "section-0")).toEqual(audio("fresh"));

    vi.useRealTimers();
  });

  it("can force a playback-owned request to replace stale warm work", async () => {
    vi.useFakeTimers();
    const cache = createAudioRequestCache();
    const warmGenerate = vi.fn(
      () =>
        new Promise<TtsAudioUrlResult>((resolve) => {
          setTimeout(() => resolve(audio("warm")), 50);
        }),
    );
    const playbackGenerate = vi.fn(async () => audio("playback"));

    startAudioRequest(cache, "section-0", warmGenerate, { owner: "warm" });
    const playback = startAudioRequest(cache, "section-0", playbackGenerate, {
      force: true,
    });

    await vi.advanceTimersByTimeAsync(50);

    await expect(playback).resolves.toEqual(audio("playback"));
    expect(getAudioRequestResult(cache, "section-0")).toEqual(audio("playback"));
    expect(warmGenerate).toHaveBeenCalledTimes(1);
    expect(playbackGenerate).toHaveBeenCalledTimes(1);

    vi.useRealTimers();
  });

  it("clears a request cache entry explicitly", () => {
    const cache = createAudioRequestCache();
    primeAudioRequest(cache, "section-0", audio("primed"));

    clearAudioRequest(cache, "section-0");

    expect(getAudioRequestResult(cache, "section-0")).toBeNull();
  });

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
