import { describe, expect, it } from "vitest";
import {
  assertExactCurrentEdgeAudioMetadata,
  hasPublicAudioMetadata,
  isExactCurrentEdgeAudioMetadata,
} from "./public-edge-audio-metadata";
import { getTtsMetadata, getTtsProfile } from "./tts-profile";

describe("public Edge audio metadata", () => {
  const edge = getTtsMetadata(getTtsProfile("edge"));

  it("accepts only the complete current Edge profile", () => {
    expect(isExactCurrentEdgeAudioMetadata(edge)).toBe(true);

    for (const spoofed of [
      { ...edge, provider: "openai" },
      { ...edge, model: "different-model" },
      { ...edge, voiceId: "en-US-GuyNeural" },
      { ...edge, promptVersion: "different-prompt" },
      { ...edge, ttsNormVersion: "ttsNorm:2" },
      { ...edge, ttsCacheKey: `${edge.ttsCacheKey}:spoofed` },
      { ttsCacheKey: edge.ttsCacheKey },
    ]) {
      expect(isExactCurrentEdgeAudioMetadata(spoofed)).toBe(false);
    }
  });

  it("supports a pipeline-specific cache identity without weakening the profile", () => {
    const pipelineCacheKey = `${edge.ttsCacheKey}:trending-script:1`;
    const metadata = { ...edge, ttsCacheKey: pipelineCacheKey };

    expect(
      isExactCurrentEdgeAudioMetadata(metadata, pipelineCacheKey),
    ).toBe(true);
    expect(
      isExactCurrentEdgeAudioMetadata(
        { ...metadata, provider: "openai" },
        pipelineCacheKey,
      ),
    ).toBe(false);
  });

  it("detects partial metadata and rejects invalid publication metadata", () => {
    expect(hasPublicAudioMetadata({})).toBe(false);
    expect(hasPublicAudioMetadata({ provider: "edge" })).toBe(true);
    expect(() => assertExactCurrentEdgeAudioMetadata(edge)).not.toThrow();
    expect(() =>
      assertExactCurrentEdgeAudioMetadata({
        ...edge,
        provider: "openai",
      }),
    ).toThrow("Public audio must use the current Edge TTS profile");
  });
});
