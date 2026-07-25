import { describe, expect, it } from "vitest";
import {
  assertSectionAudioKeyCanBeSaved,
  isQuarantinedContextAudioKey,
  selectSectionAudioVariant,
} from "./audio";

const openAiKey =
  "tts:openai:gpt-4o-mini-tts:marin:curio-warm-narrator-v1:ttsNorm:2";
const edgeKey = "tts:edge:edge-tts:en-US-AriaNeural:edge-default:ttsNorm:2";
const sourceHash = "section-narration:1:test";

describe("selectSectionAudioVariant", () => {
  it("prefers the requested provider variant over legacy normalization matches", () => {
    const selected = selectSectionAudioVariant(
      [
        {
          sectionKey: "summary",
          sourceHash,
          storageId: "edge-storage",
          ttsNormVersion: "ttsNorm:2",
          ttsCacheKey: edgeKey,
        },
        {
          sectionKey: "summary",
          sourceHash,
          storageId: "openai-storage",
          ttsNormVersion: "ttsNorm:2",
          ttsCacheKey: openAiKey,
        },
        {
          sectionKey: "summary",
          sourceHash,
          storageId: "legacy-storage",
          ttsNormVersion: "ttsNorm:2",
        },
      ],
      {
        sectionKey: "summary",
        ttsNormVersion: "ttsNorm:2",
        ttsCacheKey: openAiKey,
        sourceHash,
      },
    );

    expect(selected?.storageId).toBe("openai-storage");
  });

  it("does not use legacy audio when a provider cache key is requested", () => {
    const selected = selectSectionAudioVariant(
      [
        {
          sectionKey: "summary",
          sourceHash,
          storageId: "legacy-storage",
          ttsNormVersion: "ttsNorm:2",
        },
      ],
      {
        sectionKey: "summary",
        ttsNormVersion: "ttsNorm:2",
        ttsCacheKey: openAiKey,
        sourceHash,
      },
    );

    expect(selected).toBeNull();
  });

  it.each([
    "context-summary-map-hash",
    "context-description-timeline-hash",
  ])("quarantines legacy context narration reads for %s", (sectionKey) => {
    const selected = selectSectionAudioVariant(
      [
        {
          sectionKey,
          sourceHash,
          storageId: "legacy-context-storage",
          ttsNormVersion: "ttsNorm:2",
          ttsCacheKey: openAiKey,
        },
      ],
      {
        sectionKey,
        ttsNormVersion: "ttsNorm:2",
        ttsCacheKey: openAiKey,
        sourceHash,
      },
    );

    expect(selected).toBeNull();
    expect(isQuarantinedContextAudioKey(sectionKey)).toBe(true);
  });

  it.each(["summary", "section-0", "contextual-history"])(
    "continues to allow ordinary article audio for %s",
    (sectionKey) => {
      expect(isQuarantinedContextAudioKey(sectionKey)).toBe(false);
      expect(() => assertSectionAudioKeyCanBeSaved(sectionKey)).not.toThrow();
    },
  );

  it("rejects audio rendered from different narration text", () => {
    const selected = selectSectionAudioVariant(
      [
        {
          sectionKey: "summary",
          sourceHash: "old-source",
          storageId: "old-storage",
          ttsNormVersion: "ttsNorm:2",
          ttsCacheKey: openAiKey,
        },
      ],
      {
        sectionKey: "summary",
        sourceHash: "current-source",
        ttsNormVersion: "ttsNorm:2",
        ttsCacheKey: openAiKey,
      },
    );

    expect(selected).toBeNull();
  });

  it.each([
    "context-summary-map-hash",
    "context-description-timeline-hash",
  ])("rejects future context narration saves for %s", (sectionKey) => {
    expect(() => assertSectionAudioKeyCanBeSaved(sectionKey)).toThrow(
      "Context narration audio is no longer supported.",
    );
  });
});
