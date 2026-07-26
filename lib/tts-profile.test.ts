import { afterEach, describe, expect, it, vi } from "vitest";
import {
  buildTtsCacheKey,
  doesTtsMetadataMatch,
  getActiveTtsProfile,
  isTtsMetadataValid,
  serializeTtsMetadataForInlineScript,
  type TtsMetadata,
} from "./tts-profile";

const edgeMetadata = (): TtsMetadata => {
  const metadata = {
    provider: "edge" as const,
    model: "edge-tts",
    voiceId: "en-US-AriaNeural",
    promptVersion: "edge-default",
    ttsNormVersion: "ttsNorm:2",
  };
  return { ...metadata, ttsCacheKey: buildTtsCacheKey(metadata) };
};

afterEach(() => {
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
});

describe("active TTS profile identity", () => {
  it("uses the server-injected public profile instead of a browser env guess", () => {
    vi.stubEnv("TTS_PRIMARY_PROVIDER", "openai");
    const metadata = edgeMetadata();
    vi.stubGlobal("window", { __CURIO_ACTIVE_TTS_METADATA__: metadata });

    expect(getActiveTtsProfile()).toEqual(metadata);
  });

  it("rejects a tampered injected cache key", () => {
    vi.stubEnv("TTS_PRIMARY_PROVIDER", "openai");
    vi.stubGlobal("window", {
      __CURIO_ACTIVE_TTS_METADATA__: {
        ...edgeMetadata(),
        ttsCacheKey: "not-the-profile-key",
      },
    });

    expect(getActiveTtsProfile().provider).toBe("openai");
  });

  it("rejects injected metadata that fails the complete profile validator", () => {
    vi.stubEnv("TTS_PRIMARY_PROVIDER", "openai");
    const metadata = edgeMetadata();

    vi.stubGlobal("window", {
      __CURIO_ACTIVE_TTS_METADATA__: {
        ...metadata,
        voiceId: "not-an-edge-voice",
        ttsCacheKey: buildTtsCacheKey({
          ...metadata,
          voiceId: "not-an-edge-voice",
        }),
      },
    });
    expect(getActiveTtsProfile().provider).toBe("openai");

    vi.stubGlobal("window", {
      __CURIO_ACTIVE_TTS_METADATA__: {
        ...metadata,
        ttsNormVersion: "ttsNorm:1",
        ttsCacheKey: buildTtsCacheKey({
          ...metadata,
          ttsNormVersion: "ttsNorm:1",
        }),
      },
    });
    expect(getActiveTtsProfile().provider).toBe("openai");

    vi.stubGlobal("window", {
      __CURIO_ACTIVE_TTS_METADATA__: {
        ...metadata,
        model: undefined,
      } as never,
    });
    expect(() => getActiveTtsProfile()).not.toThrow();
    expect(getActiveTtsProfile().provider).toBe("openai");
  });

  it("compares the complete profile and safely serializes bootstrap data", () => {
    const metadata = edgeMetadata();

    expect(doesTtsMetadataMatch({ ...metadata }, metadata)).toBe(true);
    expect(
      doesTtsMetadataMatch({ ...metadata, voiceId: "another-voice" }, metadata),
    ).toBe(false);
    expect(
      serializeTtsMetadataForInlineScript({
        ...metadata,
        voiceId: "voice</script><script>alert(1)</script>",
      }),
    ).not.toContain("<");
  });

  it("validates a complete cache identity before a client can queue work", () => {
    const metadata = edgeMetadata();

    expect(isTtsMetadataValid(metadata)).toBe(true);
    expect(
      isTtsMetadataValid({
        ...metadata,
        voiceId: "en-US-GuyNeural",
      }),
    ).toBe(false);
  });
});
