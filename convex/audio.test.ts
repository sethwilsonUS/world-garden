import { describe, expect, it } from "vitest";
import {
  assertCurrentSectionAudioCacheContract,
  assertSectionAudioCacheAccess,
  assertSectionAudioCacheReadAccess,
  assertSectionAudioCacheWriteAccess,
  assertSectionAudioKeyCanBeSaved,
  assertSectionAudioMetadataMatchesCacheKey,
  isQuarantinedContextAudioKey,
  selectSectionAudioVariant,
  selectSupersededSectionAudioRecords,
} from "./audio";
import {
  AUDIO_CACHE_READ_ATTESTATION_SCOPE,
  AUDIO_CACHE_SAVE_ATTESTATION_SCOPE,
  AUDIO_CACHE_UPLOAD_ATTESTATION_SCOPE,
  buildAudioCacheReadAttestationPayload,
  buildAudioCacheUploadAttestationPayload,
} from "../lib/audio-cache-attestation";
import { createServerAttestation } from "../lib/server-attestation";

const openAiKey =
  "tts:openai:gpt-4o-mini-tts:marin:curio-warm-narrator-v1:ttsNorm:3";
const edgeKey = "tts:edge:edge-tts:en-US-AriaNeural:edge-default:ttsNorm:3";
const sourceHash = "section-narration:1:test";
const trustedCacheContract = {
  cacheContractVersion: 1,
  ttsNormVersion: "ttsNorm:3",
};

describe("section audio provider access", () => {
  it("keeps Edge cache variants publicly readable and writable", () => {
    expect(() => assertSectionAudioCacheAccess(edgeKey)).not.toThrow();
    expect(() =>
      assertSectionAudioMetadataMatchesCacheKey("edge", edgeKey),
    ).not.toThrow();
  });

  it("keeps raw OpenAI cache URLs server-only", () => {
    expect(() => assertSectionAudioCacheAccess(openAiKey)).toThrow(
      "OpenAI cache URLs are server-only.",
    );
  });

  it("quarantines every cache contract from before trusted writes", () => {
    const oldEdgeKey =
      "tts:edge:edge-tts:en-US-AriaNeural:edge-default:ttsNorm:2";

    expect(() =>
      assertCurrentSectionAudioCacheContract("ttsNorm:2", oldEdgeKey),
    ).toThrow("Unsupported TTS cache version.");
    expect(() =>
      assertCurrentSectionAudioCacheContract("ttsNorm:3", edgeKey),
    ).not.toThrow();
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

  it("requires a payload-bound server attestation for protected reads", async () => {
    const readArgs = {
      articleId: "article-1",
      ttsNormVersion: "ttsNorm:3",
      ttsCacheKey: openAiKey,
      sourceHashes: [{ sectionKey: "summary", sourceHash }],
    };
    const payload = buildAudioCacheReadAttestationPayload(readArgs);
    const attestation = await createServerAttestation({
      scope: AUDIO_CACHE_READ_ATTESTATION_SCOPE,
      payload,
      secret: "server-secret",
      now: 1_000,
      nonce: "read-test-nonce",
    });

    await expect(
      assertSectionAudioCacheReadAccess({
        attestation,
        payload,
        secret: "server-secret",
        now: 1_001,
      }),
    ).resolves.toBeUndefined();
    await expect(
      assertSectionAudioCacheReadAccess({
        attestation,
        payload: buildAudioCacheReadAttestationPayload({
          ...readArgs,
          sourceHashes: [
            { sectionKey: "summary", sourceHash: "attacker-source" },
          ],
        }),
        secret: "server-secret",
        now: 1_001,
      }),
    ).rejects.toThrow(
      "A valid server attestation is required to read protected audio.",
    );
  });

  it("fails closed for malformed public cache keys", () => {
    expect(() => assertSectionAudioCacheAccess("legacy-or-unknown")).toThrow(
      "Unsupported TTS cache version.",
    );
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
          ...trustedCacheContract,
          sectionKey: "summary",
          sourceHash,
          storageId: "edge-storage",
          ttsCacheKey: edgeKey,
        },
        {
          ...trustedCacheContract,
          sectionKey: "summary",
          sourceHash,
          storageId: "openai-storage",
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
        ttsNormVersion: "ttsNorm:3",
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
        ttsNormVersion: "ttsNorm:3",
        ttsCacheKey: openAiKey,
        sourceHash,
      },
    );

    expect(selected).toBeNull();
  });

  it("does not trust a matching cache row from before attestations", () => {
    const selected = selectSectionAudioVariant(
      [
        {
          sectionKey: "summary",
          sourceHash,
          storageId: "untrusted-storage",
          ttsNormVersion: "ttsNorm:3",
          ttsCacheKey: openAiKey,
        },
      ],
      {
        sectionKey: "summary",
        ttsNormVersion: "ttsNorm:3",
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
            ...trustedCacheContract,
            sourceHash,
            storageId: "legacy-context-storage",
            ttsCacheKey: openAiKey,
          },
        ],
        {
          sectionKey,
          ttsNormVersion: "ttsNorm:3",
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
          ...trustedCacheContract,
          sourceHash: "old-source",
          storageId: "old-storage",
          ttsCacheKey: openAiKey,
        },
      ],
      {
        sectionKey: "summary",
        sourceHash: "current-source",
        ttsNormVersion: "ttsNorm:3",
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
