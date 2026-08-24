import { afterEach, describe, expect, it, vi } from "vitest";
import {
  assertExactCurrentTrendingAudioMetadata,
  getTrendingAudioCacheKey,
  getTrendingTtsMetadata,
  getTrendingTtsProfile,
  isExactCurrentTrendingAudioMetadata,
} from "./trending-audio-profile";

afterEach(() => {
  vi.unstubAllEnvs();
});

describe("Trending podcast audio profile", () => {
  it("pins new episodes to OpenAI Mini with Marin and a pipeline-qualified cache key", () => {
    vi.stubEnv("OPENAI_TTS_MODEL", "different-model");
    vi.stubEnv("OPENAI_TTS_VOICE", "alloy");

    expect(getTrendingTtsProfile()).toMatchObject({
      provider: "openai",
      model: "gpt-4o-mini-tts",
      voiceId: "marin",
      promptVersion: "curio-warm-narrator-v1",
      ttsNormVersion: "ttsNorm:3",
      ttsCacheKey:
        "tts:openai:gpt-4o-mini-tts:marin:curio-warm-narrator-v1:ttsNorm:3",
    });
    expect(getTrendingAudioCacheKey()).toBe(
      "tts:openai:gpt-4o-mini-tts:marin:curio-warm-narrator-v1:ttsNorm:3:trending-script:ai-disclosure-v1",
    );
    expect(getTrendingTtsMetadata()).toMatchObject({
      provider: "openai",
      model: "gpt-4o-mini-tts",
      voiceId: "marin",
      ttsCacheKey: getTrendingTtsProfile().ttsCacheKey,
    });
  });

  it("accepts only the complete current Trending Mini metadata", () => {
    const current = getTrendingTtsMetadata();
    const persisted = {
      ...current,
      ttsCacheKey: getTrendingAudioCacheKey(),
    };

    expect(isExactCurrentTrendingAudioMetadata(current)).toBe(true);
    expect(() =>
      assertExactCurrentTrendingAudioMetadata(current),
    ).not.toThrow();
    expect(
      isExactCurrentTrendingAudioMetadata(
        persisted,
        getTrendingAudioCacheKey(),
      ),
    ).toBe(true);
    expect(() =>
      assertExactCurrentTrendingAudioMetadata(
        persisted,
        getTrendingAudioCacheKey(),
      ),
    ).not.toThrow();

    for (const incompatible of [
      { ...current, provider: "edge" },
      { ...current, model: "edge-tts" },
      { ...current, voiceId: "alloy" },
      { ...current, promptVersion: "different-prompt" },
      { ...current, ttsNormVersion: "ttsNorm:2" },
      { ...current, ttsCacheKey: "different-key" },
      persisted,
      { ttsCacheKey: current.ttsCacheKey },
    ]) {
      expect(isExactCurrentTrendingAudioMetadata(incompatible)).toBe(false);
      expect(() =>
        assertExactCurrentTrendingAudioMetadata(incompatible),
      ).toThrow("current Trending OpenAI TTS profile");
    }
  });
});
