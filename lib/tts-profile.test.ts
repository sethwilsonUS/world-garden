import { afterEach, describe, expect, it, vi } from "vitest";
import {
  buildTtsCacheKey,
  doesTtsMetadataMatch,
  getActiveTtsProfile,
  getTtsProfile,
  getTtsProviderForAudience,
  isTtsMetadataValid,
  parseTtsFallbackReason,
  serializeTtsMetadataForInlineScript,
  type TtsMetadata,
} from "./tts-profile";

describe("TTS provider policy", () => {
  it("defaults no-argument and active profiles to Edge", () => {
    vi.stubEnv("TTS_PRIMARY_PROVIDER", "openai");
    vi.stubEnv("NEXT_PUBLIC_TTS_PRIMARY_PROVIDER", "openai");

    expect(getTtsProfile().provider).toBe("edge");
    expect(getActiveTtsProfile().provider).toBe("edge");
  });

  it("maps public listeners to Edge and authenticated listeners to OpenAI", () => {
    expect(getTtsProviderForAudience("public")).toBe("edge");
    expect(getTtsProviderForAudience("authenticated")).toBe("openai");
  });

  it("parses only supported fallback reasons", () => {
    expect(parseTtsFallbackReason("openai_auth")).toBe("openai_auth");
    expect(parseTtsFallbackReason("openai_quota")).toBe("openai_quota");
    expect(parseTtsFallbackReason("openai_error")).toBe("openai_error");
    expect(parseTtsFallbackReason("unexpected")).toBeUndefined();
    expect(parseTtsFallbackReason(null)).toBeUndefined();
  });

  it("uses statically exposed profile mirrors for provider-qualified browser caches", () => {
    vi.stubEnv("NEXT_PUBLIC_OPENAI_TTS_MODEL", "public-openai-model");
    vi.stubEnv("NEXT_PUBLIC_OPENAI_TTS_VOICE", "cedar");
    vi.stubEnv("NEXT_PUBLIC_OPENAI_TTS_PROMPT_VERSION", "public-prompt-v2");
    vi.stubEnv("NEXT_PUBLIC_EDGE_TTS_VOICE_ID", "en-US-GuyNeural");

    expect(getTtsProfile("openai")).toMatchObject({
      model: "public-openai-model",
      voiceId: "cedar",
      promptVersion: "public-prompt-v2",
    });
    expect(getTtsProfile("edge").voiceId).toBe("en-US-GuyNeural");
  });

  it("prefers server-only profile configuration when both forms exist", () => {
    vi.stubEnv("OPENAI_TTS_MODEL", "server-model");
    vi.stubEnv("NEXT_PUBLIC_OPENAI_TTS_MODEL", "public-model");

    expect(getTtsProfile("openai").model).toBe("server-model");
  });
});

const edgeMetadata = (): TtsMetadata => {
  const metadata = {
    provider: "edge" as const,
    model: "edge-tts",
    voiceId: "en-US-AriaNeural",
    promptVersion: "edge-default",
    ttsNormVersion: "ttsNorm:3",
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

    expect(getActiveTtsProfile().provider).toBe("edge");
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
    expect(getActiveTtsProfile().provider).toBe("edge");

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
    expect(getActiveTtsProfile().provider).toBe("edge");

    vi.stubGlobal("window", {
      __CURIO_ACTIVE_TTS_METADATA__: {
        ...metadata,
        model: undefined,
      } as never,
    });
    expect(() => getActiveTtsProfile()).not.toThrow();
    expect(getActiveTtsProfile().provider).toBe("edge");
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
