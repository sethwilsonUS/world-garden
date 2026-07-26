import { describe, expect, it } from "vitest";
import {
  assertSectionAudioCacheAccess,
  assertSectionAudioCacheWriteAccess,
  assertSectionAudioKeyCanBeSaved,
  assertSectionAudioMetadataMatchesCacheKey,
  isQuarantinedContextAudioKey,
  selectSectionAudioVariant,
  selectSupersededSectionAudioRecords,
} from "./audio";
import {
  AUDIO_CACHE_SAVE_ATTESTATION_SCOPE,
  AUDIO_CACHE_UPLOAD_ATTESTATION_SCOPE,
  buildAudioCacheUploadAttestationPayload,
} from "../lib/audio-cache-attestation";
import { createServerAttestation } from "../lib/server-attestation";

const openAiKey =
  "tts:openai:gpt-4o-mini-tts:marin:curio-warm-narrator-v1:ttsNorm:2";
const edgeKey = "tts:edge:edge-tts:en-US-AriaNeural:edge-default:ttsNorm:2";
const sourceHash = "section-narration:1:test";

describe("section audio provider access", () => {
  it("keeps Edge cache variants publicly readable and writable", () => {
    expect(() => assertSectionAudioCacheAccess(edgeKey, false)).not.toThrow();
    expect(() =>
      assertSectionAudioMetadataMatchesCacheKey("edge", edgeKey),
    ).not.toThrow();
  });

  it("requires authentication for OpenAI cache variants", () => {
    expect(() => assertSectionAudioCacheAccess(openAiKey, false)).toThrow(
      "Authentication is required for OpenAI audio.",
    );
    expect(() => assertSectionAudioCacheAccess(openAiKey, true)).not.toThrow();
  });

  it("requires a valid server attestation for every public cache write", async () => {
    const payload = buildAudioCacheUploadAttestationPayload();
    const attestation = await createServerAttestation({
      scope: AUDIO_CACHE_UPLOAD_ATTESTATION_SCOPE,
      payload,
      secret: "server-secret",
      now: 1_000,
      nonce: "test-nonce",
    });

    await expect(
      assertSectionAudioCacheWriteAccess({
        scope: AUDIO_CACHE_UPLOAD_ATTESTATION_SCOPE,
        payload,
        secret: "server-secret",
        now: 1_001,
      }),
    ).rejects.toThrow("A valid server attestation is required to cache audio.");
    await expect(
      assertSectionAudioCacheWriteAccess({
        attestation,
        scope: AUDIO_CACHE_UPLOAD_ATTESTATION_SCOPE,
        payload,
        secret: "wrong-secret",
        now: 1_001,
      }),
    ).rejects.toThrow("A valid server attestation is required to cache audio.");
    await expect(
      assertSectionAudioCacheWriteAccess({
        attestation,
        scope: AUDIO_CACHE_SAVE_ATTESTATION_SCOPE,
        payload,
        secret: "server-secret",
        now: 1_001,
      }),
    ).rejects.toThrow("A valid server attestation is required to cache audio.");
    await expect(
      assertSectionAudioCacheWriteAccess({
        attestation,
        scope: AUDIO_CACHE_UPLOAD_ATTESTATION_SCOPE,
        payload,
        secret: "server-secret",
        now: 1_001,
      }),
    ).resolves.toBeUndefined();
  });

  it("fails closed for malformed public cache keys", () => {
    expect(() =>
      assertSectionAudioCacheAccess("legacy-or-unknown", false),
    ).toThrow("Authentication is required for protected audio.");
  });

  it("rejects provider metadata that disagrees with the cache key", () => {
    expect(() =>
      assertSectionAudioMetadataMatchesCacheKey("edge", openAiKey),
    ).toThrow("TTS provider does not match its cache key.");
    expect(() =>
      assertSectionAudioMetadataMatchesCacheKey("openai", edgeKey),
    ).toThrow("TTS provider does not match its cache key.");
  });
});

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

  it.each(["context-summary-map-hash", "context-description-timeline-hash"])(
    "quarantines legacy context narration reads for %s",
    (sectionKey) => {
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
    },
  );

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

  it.each(["context-summary-map-hash", "context-description-timeline-hash"])(
    "rejects future context narration saves for %s",
    (sectionKey) => {
      expect(() => assertSectionAudioKeyCanBeSaved(sectionKey)).toThrow(
        "Context narration audio is no longer supported.",
      );
    },
  );
});

describe("selectSupersededSectionAudioRecords", () => {
  it("reclaims only legacy and duplicate rows from the current profile", () => {
    const records = [
      {
        _id: "saved",
        sectionKey: "section-0",
        sourceHash: "new",
        ttsCacheKey: openAiKey,
        storageId: "saved-storage",
      },
      { _id: "legacy", sectionKey: "section-0", storageId: "legacy-storage" },
      {
        _id: "stale",
        sectionKey: "section-0",
        sourceHash: "old",
        ttsCacheKey: edgeKey,
        storageId: "stale-storage",
      },
      {
        _id: "duplicate",
        sectionKey: "section-0",
        sourceHash: "new",
        ttsCacheKey: openAiKey,
        storageId: "duplicate-storage",
      },
      {
        _id: "other-profile",
        sectionKey: "section-0",
        sourceHash: "new",
        ttsCacheKey: edgeKey,
        storageId: "other-storage",
      },
    ];

    expect(
      selectSupersededSectionAudioRecords(records, {
        savedId: "saved",
        sourceHash: "new",
        ttsCacheKey: openAiKey,
      }).map((record) => record._id),
    ).toEqual(["legacy", "duplicate"]);
  });
});
