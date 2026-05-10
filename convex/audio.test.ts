import { describe, expect, it } from "vitest";
import { selectSectionAudioVariant } from "./audio";

const openAiKey =
  "tts:openai:gpt-4o-mini-tts:marin:curio-warm-narrator-v1:ttsNorm:2";
const edgeKey = "tts:edge:edge-tts:en-US-AriaNeural:edge-default:ttsNorm:2";

describe("selectSectionAudioVariant", () => {
  it("prefers the requested provider variant over legacy normalization matches", () => {
    const selected = selectSectionAudioVariant(
      [
        {
          sectionKey: "summary",
          storageId: "edge-storage",
          ttsNormVersion: "ttsNorm:2",
          ttsCacheKey: edgeKey,
        },
        {
          sectionKey: "summary",
          storageId: "openai-storage",
          ttsNormVersion: "ttsNorm:2",
          ttsCacheKey: openAiKey,
        },
        {
          sectionKey: "summary",
          storageId: "legacy-storage",
          ttsNormVersion: "ttsNorm:2",
        },
      ],
      {
        sectionKey: "summary",
        ttsNormVersion: "ttsNorm:2",
        ttsCacheKey: openAiKey,
      },
    );

    expect(selected?.storageId).toBe("openai-storage");
  });

  it("keeps legacy normalization fallback when no provider cache key is requested", () => {
    const selected = selectSectionAudioVariant(
      [
        {
          sectionKey: "summary",
          storageId: "legacy-storage",
          ttsNormVersion: "ttsNorm:2",
        },
      ],
      {
        sectionKey: "summary",
        ttsNormVersion: "ttsNorm:2",
      },
    );

    expect(selected?.storageId).toBe("legacy-storage");
  });

  it("does not use legacy audio when a provider cache key is requested", () => {
    const selected = selectSectionAudioVariant(
      [
        {
          sectionKey: "summary",
          storageId: "legacy-storage",
          ttsNormVersion: "ttsNorm:2",
        },
      ],
      {
        sectionKey: "summary",
        ttsNormVersion: "ttsNorm:2",
        ttsCacheKey: openAiKey,
      },
    );

    expect(selected).toBeNull();
  });
});
