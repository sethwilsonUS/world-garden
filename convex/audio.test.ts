import { afterEach, describe, expect, it, vi } from "vitest";
import { getFunctionName } from "convex/server";
import type { Id } from "./_generated/dataModel";
import {
  assertCurrentSectionAudioCacheContract,
  assertSectionAudioCacheAccess,
  assertSectionAudioCacheReadAccess,
  assertSectionAudioCacheWriteAccess,
  assertSectionAudioKeyCanBeSaved,
  assertSectionAudioLedgerMetadata,
  assertSectionAudioMetadataMatchesCacheKey,
  getSectionAudioWriteDisposition,
  getSectionAudioWriteCounters,
  hasExternalConsumptionUnknown,
  getAllSectionAudioForServer,
  isQuarantinedContextAudioKey,
  recordSectionAudioCacheReadResult,
  recordSectionAudioCacheWriteFailure,
  saveSectionAudioRecordInternal,
  selectSectionAudioVariant,
  selectSupersededSectionAudioRecords,
  summarizeSectionAudioCacheRead,
} from "./audio";
import {
  AUDIO_CACHE_READ_ATTESTATION_SCOPE,
  AUDIO_CACHE_READ_RESULT_ATTESTATION_SCOPE,
  AUDIO_CACHE_SAVE_ATTESTATION_SCOPE,
  AUDIO_CACHE_UPLOAD_ATTESTATION_SCOPE,
  AUDIO_CACHE_WRITE_FAILURE_ATTESTATION_SCOPE,
  buildAudioCacheReadAttestationPayload,
  buildAudioCacheReadResultAttestationPayload,
  buildAudioCacheWriteFailureAttestationPayload,
  buildAudioCacheUploadAttestationPayload,
} from "../lib/audio-cache-attestation";
import { createServerAttestation } from "../lib/server-attestation";
import { registeredInvoker } from "./testing/registeredFunctions";

const openAiKey =
  "tts:openai:gpt-4o-mini-tts:marin:curio-warm-narrator-v1:ttsNorm:3";
const edgeKey = "tts:edge:edge-tts:en-US-AriaNeural:edge-default:ttsNorm:3";
const sourceHash = "section-narration:1:test";
const trustedCacheContract = {
  cacheContractVersion: 1,
  ttsNormVersion: "ttsNorm:3",
};

afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllEnvs();
});

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
      articleId: "article-1" as Id<"articles">,
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

describe("getSectionAudioWriteDisposition", () => {
  it("distinguishes a first insert from an idempotent retry and a competing generation", () => {
    expect(getSectionAudioWriteDisposition(null, "asset-a")).toBe("inserted");
    expect(getSectionAudioWriteDisposition({}, "asset-a")).toBe("inserted");
    expect(
      getSectionAudioWriteDisposition({ ledgerAssetKey: "asset-a" }, "asset-a"),
    ).toBe("idempotent_retry");
    expect(
      getSectionAudioWriteDisposition({ ledgerAssetKey: "asset-a" }, "asset-b"),
    ).toBe("competing_generation");
  });
});

describe("getSectionAudioWriteCounters", () => {
  it("counts one unique insert without overcounting retries or races", () => {
    expect(getSectionAudioWriteCounters("inserted")).toEqual({
      uniqueGeneratedAssets: 1,
      concurrentGenerationRaces: 0,
      idempotentRetryWrites: 0,
    });
    expect(getSectionAudioWriteCounters("idempotent_retry")).toEqual({
      uniqueGeneratedAssets: 0,
      concurrentGenerationRaces: 0,
      idempotentRetryWrites: 1,
    });
    expect(getSectionAudioWriteCounters("competing_generation")).toEqual({
      uniqueGeneratedAssets: 0,
      concurrentGenerationRaces: 1,
      idempotentRetryWrites: 0,
    });
  });
});

describe("summarizeSectionAudioCacheRead", () => {
  it("counts served cache units and known bytes without exposing asset keys", () => {
    expect(
      summarizeSectionAudioCacheRead({
        requestedSectionKeys: ["summary", "section-0", "summary"],
        servedRecords: [
          {
            sectionKey: "summary",
            byteLength: 2_048,
            durationSeconds: 12,
          },
        ],
      }),
    ).toEqual({
      requests: 2,
      hits: 1,
      misses: 1,
      reusedAssetServes: 1,
      avoidedGeneration: 1,
      bytes: 2_048,
      seconds: 12,
    });
  });
});

describe("assertSectionAudioLedgerMetadata", () => {
  it("accepts bounded opaque asset keys and safe byte counts", () => {
    expect(() =>
      assertSectionAudioLedgerMetadata({
        byteLength: 3,
        ledgerAssetKey: "00000000-0000-4000-8000-000000000001",
      }),
    ).not.toThrow();
  });

  it("rejects unsafe byte counts and descriptive asset keys", () => {
    expect(() =>
      assertSectionAudioLedgerMetadata({
        byteLength: -1,
        ledgerAssetKey: "00000000-0000-4000-8000-000000000001",
      }),
    ).toThrow("byte length");
    expect(() =>
      assertSectionAudioLedgerMetadata({
        byteLength: 3,
        ledgerAssetKey: "The Silmarillion summary audio",
      }),
    ).toThrow("asset key");
  });
});

describe("hasExternalConsumptionUnknown", () => {
  it("keeps direct podcast/download generation unknown without hiding warm-cache observability", () => {
    expect(hasExternalConsumptionUnknown("interactive_article")).toBe(false);
    expect(hasExternalConsumptionUnknown("featured_audio_warm")).toBe(false);
    expect(hasExternalConsumptionUnknown("article_audio_export")).toBe(true);
    expect(hasExternalConsumptionUnknown("personal_playlist")).toBe(true);
    expect(hasExternalConsumptionUnknown("featured_podcast")).toBe(true);
    expect(hasExternalConsumptionUnknown("trending_podcast")).toBe(true);
    expect(hasExternalConsumptionUnknown("picture_of_day")).toBe(true);
    expect(hasExternalConsumptionUnknown("unknown")).toBe(true);
  });
});

describe("section audio ledger scheduling", () => {
  it("returns cached audio while scheduling its idempotent cache-read event", async () => {
    vi.stubEnv("AI_COST_LEDGER_MODE", "observe");
    vi.stubEnv("TTS_QUOTA_BYPASS_SECRET", "server-secret");
    const now = Date.now();
    const args = {
      articleId: "article-1" as Id<"articles">,
      ttsNormVersion: "ttsNorm:3",
      ttsCacheKey: openAiKey,
      sourceHashes: [{ sectionKey: "summary", sourceHash }],
      ledgerSource: "interactive_article" as const,
    };
    const attestation = await createServerAttestation({
      scope: AUDIO_CACHE_READ_ATTESTATION_SCOPE,
      payload: buildAudioCacheReadAttestationPayload(args),
      secret: "server-secret",
      now,
      nonce: "cache-read-nonce",
    });
    const runAfter = vi.fn().mockResolvedValue("scheduled-1");
    const handler = registeredInvoker(getAllSectionAudioForServer);

    await expect(
      handler(
        {
          db: {
            query: vi.fn(() => ({
              withIndex: vi.fn(() => ({
                collect: async () => [
                  {
                    _id: "audio-1",
                    ...trustedCacheContract,
                    articleId: "article-1",
                    sectionKey: "summary",
                    sourceHash,
                    storageId: "storage-1",
                    ttsCacheKey: openAiKey,
                    provider: "openai",
                    byteLength: 2_048,
                    durationSeconds: 12,
                  },
                ],
              })),
            })),
          },
          storage: {
            getUrl: vi.fn().mockResolvedValue("https://cdn.test/summary.mp3"),
          },
          scheduler: { runAfter },
        },
        { ...args, attestation },
      ),
    ).resolves.toMatchObject({
      urls: { summary: "https://cdn.test/summary.mp3" },
      durations: { summary: 12 },
    });

    expect(runAfter).toHaveBeenCalledOnce();
    expect(getFunctionName(runAfter.mock.calls[0][1])).toBe(
      "aiCostLedger:recordCacheDecisionInternal",
    );
    expect(runAfter.mock.calls[0][2]).toMatchObject({
      eventKey: "cache-read:cache-read-nonce",
      source: "interactive_article",
      provider: "openai",
      requests: 1,
      hits: 1,
      misses: 0,
      reusedAssetServes: 1,
      avoidedGeneration: 1,
    });
  });

  it("records a legacy cache hit whose byte length is unknown", async () => {
    vi.stubEnv("AI_COST_LEDGER_MODE", "observe");
    vi.stubEnv("TTS_QUOTA_BYPASS_SECRET", "server-secret");
    const input = {
      source: "featured_audio_warm" as const,
      provider: "edge" as const,
      hit: true,
      byteLength: 0,
      durationSeconds: 12,
    };
    const attestation = await createServerAttestation({
      scope: AUDIO_CACHE_READ_RESULT_ATTESTATION_SCOPE,
      payload: buildAudioCacheReadResultAttestationPayload(input),
      secret: "server-secret",
      now: Date.now(),
      nonce: "legacy-cache-read-result-nonce",
    });
    const runAfter = vi.fn().mockResolvedValue("scheduled-legacy-hit");
    const handler = registeredInvoker(recordSectionAudioCacheReadResult);

    await expect(
      handler({ scheduler: { runAfter } }, { ...input, attestation }),
    ).resolves.toEqual({ created: true, disposition: "inserted" });

    expect(runAfter).toHaveBeenCalledOnce();
    expect(runAfter.mock.calls[0][2]).toMatchObject({
      source: "featured_audio_warm",
      provider: "edge",
      hits: 1,
      misses: 0,
      reusedAssetServes: 1,
      avoidedGeneration: 1,
      bytes: 0,
      seconds: 12,
    });
  });

  it("commits a section save result even when ledger enqueueing fails", async () => {
    vi.stubEnv("AI_COST_LEDGER_MODE", "observe");
    const rows: Array<Record<string, unknown>> = [];
    const runAfter = vi
      .fn()
      .mockRejectedValue(new Error("scheduler unavailable"));
    const handler = registeredInvoker(saveSectionAudioRecordInternal);

    await expect(
      handler(
        {
          db: {
            query: vi.fn(() => ({
              withIndex: vi.fn(() => ({
                first: async () => null,
                collect: async () => rows,
              })),
            })),
            insert: vi.fn(
              async (_table: string, value: Record<string, unknown>) => {
                rows.push({ _id: "audio-saved", ...value });
                return "audio-saved";
              },
            ),
            patch: vi.fn(),
            delete: vi.fn(),
          },
          storage: { delete: vi.fn() },
          scheduler: { runAfter },
        },
        {
          articleId: "article-1" as Id<"articles">,
          sectionKey: "summary",
          sourceHash,
          storageId: "storage-1" as Id<"_storage">,
          ttsNormVersion: "ttsNorm:3",
          ttsCacheKey: openAiKey,
          provider: "openai",
          model: "gpt-4o-mini-tts",
          voiceId: "marin",
          promptVersion: "curio-warm-narrator-v1",
          durationSeconds: 12,
          byteLength: 2_048,
          ledgerAssetKey: "00000000-0000-4000-8000-000000000001",
          ledgerSource: "interactive_article",
        },
      ),
    ).resolves.toBe("audio-saved");

    expect(rows).toHaveLength(1);
    expect(runAfter).toHaveBeenCalledTimes(2);
    expect(runAfter.mock.calls.map((call) => getFunctionName(call[1]))).toEqual(
      [
        "aiCostLedger:recordGenerationAssetInternal",
        "aiCostLedger:recordCacheDecisionInternal",
      ],
    );
    expect(runAfter.mock.calls[0][2]).toMatchObject({
      eventKey: "00000000-0000-4000-8000-000000000001",
      source: "interactive_article",
      provider: "openai",
      byteLength: 2_048,
    });
    expect(runAfter.mock.calls[1][2]).toMatchObject({
      eventKey: "cache-write:00000000-0000-4000-8000-000000000001:inserted",
      source: "interactive_article",
      provider: "openai",
      uniqueGeneratedAssets: 1,
    });
  });

  it("preserves last-write cache semantics while retaining one aggregate generation cohort", async () => {
    vi.stubEnv("AI_COST_LEDGER_MODE", "observe");
    const existing = {
      _id: "audio-winner",
      ...trustedCacheContract,
      articleId: "article-1",
      sectionKey: "summary",
      sourceHash,
      storageId: "storage-winner",
      ttsCacheKey: openAiKey,
      provider: "openai",
      model: "winner-model",
      voiceId: "winner-voice",
      promptVersion: "winner-prompt",
      durationSeconds: 12,
      byteLength: 2_048,
      ledgerAssetKey: "00000000-0000-4000-8000-000000000001",
    };
    const patch = vi.fn();
    const deleteStorage = vi.fn();
    const runAfter = vi.fn().mockResolvedValue("scheduled-race");
    const handler = registeredInvoker(saveSectionAudioRecordInternal);

    await expect(
      handler(
        {
          db: {
            query: vi.fn(() => ({
              withIndex: vi.fn(() => ({
                first: async () => existing,
                collect: async () => [existing],
              })),
            })),
            insert: vi.fn(),
            patch,
            delete: vi.fn(),
          },
          storage: { delete: deleteStorage },
          scheduler: { runAfter },
        },
        {
          articleId: "article-1" as Id<"articles">,
          sectionKey: "summary",
          sourceHash,
          storageId: "storage-loser" as Id<"_storage">,
          ttsNormVersion: "ttsNorm:3",
          ttsCacheKey: openAiKey,
          provider: "openai",
          model: "loser-model",
          voiceId: "loser-voice",
          promptVersion: "loser-prompt",
          durationSeconds: 15,
          byteLength: 3_072,
          ledgerAssetKey: "00000000-0000-4000-8000-000000000002",
          ledgerSource: "interactive_article",
        },
      ),
    ).resolves.toBe("audio-winner");

    expect(patch).toHaveBeenCalledWith(
      "audio-winner",
      expect.objectContaining({
        storageId: "storage-loser",
        model: "loser-model",
        byteLength: 3_072,
        ledgerAssetKey: "00000000-0000-4000-8000-000000000001",
      }),
    );
    expect(deleteStorage).not.toHaveBeenCalled();
    expect(runAfter).toHaveBeenCalledOnce();
    expect(getFunctionName(runAfter.mock.calls[0][1])).toBe(
      "aiCostLedger:recordCacheDecisionInternal",
    );
    expect(runAfter.mock.calls[0][2]).toMatchObject({
      eventKey:
        "cache-write:00000000-0000-4000-8000-000000000002:competing_generation",
      uniqueGeneratedAssets: 0,
      concurrentGenerationRaces: 1,
    });
  });

  it("replaces an unusable cached asset when the save names the version it observed", async () => {
    vi.stubEnv("AI_COST_LEDGER_MODE", "observe");
    const existing = {
      _id: "audio-broken",
      ...trustedCacheContract,
      articleId: "article-1",
      sectionKey: "summary",
      sourceHash,
      storageId: "storage-broken",
      ttsCacheKey: openAiKey,
      provider: "openai",
      model: "broken-model",
      durationSeconds: 12,
      byteLength: 2_048,
      ledgerAssetKey: "00000000-0000-4000-8000-000000000001",
    };
    const patch = vi.fn();
    const deleteStorage = vi.fn();
    const runAfter = vi.fn().mockResolvedValue("scheduled-repair");
    const handler = registeredInvoker(saveSectionAudioRecordInternal);

    await handler(
      {
        db: {
          query: vi.fn(() => ({
            withIndex: vi.fn(() => ({
              first: async () => existing,
              collect: async () => [existing],
            })),
          })),
          insert: vi.fn(),
          patch,
          delete: vi.fn(),
        },
        storage: { delete: deleteStorage },
        scheduler: { runAfter },
      },
      {
        articleId: "article-1" as Id<"articles">,
        sectionKey: "summary",
        sourceHash,
        storageId: "storage-repaired" as Id<"_storage">,
        ttsNormVersion: "ttsNorm:3",
        ttsCacheKey: openAiKey,
        provider: "openai",
        model: "repaired-model",
        durationSeconds: 13,
        byteLength: 3_072,
        ledgerAssetKey: "00000000-0000-4000-8000-000000000002",
        expectedExistingLedgerAssetKey: "00000000-0000-4000-8000-000000000001",
        ledgerSource: "interactive_article",
      },
    );

    expect(patch).toHaveBeenCalledWith(
      "audio-broken",
      expect.objectContaining({
        storageId: "storage-repaired",
        model: "repaired-model",
        byteLength: 3_072,
        ledgerAssetKey: "00000000-0000-4000-8000-000000000002",
      }),
    );
    expect(deleteStorage).not.toHaveBeenCalled();
    expect(runAfter).toHaveBeenCalledTimes(2);
    expect(runAfter.mock.calls[0]?.[2]).toMatchObject({
      eventKey: "00000000-0000-4000-8000-000000000002",
      byteLength: 3_072,
    });
    expect(runAfter.mock.calls[1]?.[2]).toMatchObject({
      uniqueGeneratedAssets: 1,
      concurrentGenerationRaces: 0,
    });
  });

  it("preserves replacement behavior while ledger observation is off", async () => {
    vi.stubEnv("AI_COST_LEDGER_MODE", "off");
    const existing = {
      _id: "audio-existing-off",
      ...trustedCacheContract,
      articleId: "article-1",
      sectionKey: "summary",
      sourceHash,
      storageId: "storage-existing-off",
      ttsCacheKey: openAiKey,
      provider: "openai",
      model: "old-model",
      ledgerAssetKey: "00000000-0000-4000-8000-000000000001",
    };
    const patch = vi.fn();
    const deleteStorage = vi.fn();
    const runAfter = vi.fn();
    const handler = registeredInvoker(saveSectionAudioRecordInternal);

    await handler(
      {
        db: {
          query: vi.fn(() => ({
            withIndex: vi.fn(() => ({
              first: async () => existing,
              collect: async () => [existing],
            })),
          })),
          insert: vi.fn(),
          patch,
          delete: vi.fn(),
        },
        storage: { delete: deleteStorage },
        scheduler: { runAfter },
      },
      {
        articleId: "article-1" as Id<"articles">,
        sectionKey: "summary",
        sourceHash,
        storageId: "storage-new-off" as Id<"_storage">,
        ttsNormVersion: "ttsNorm:3",
        ttsCacheKey: openAiKey,
        provider: "openai",
        model: "new-model",
        durationSeconds: 13,
        byteLength: 3_072,
        ledgerAssetKey: "00000000-0000-4000-8000-000000000002",
        ledgerSource: "interactive_article",
      },
    );

    expect(patch).toHaveBeenCalledWith(
      "audio-existing-off",
      expect.objectContaining({
        storageId: "storage-new-off",
        model: "new-model",
        ledgerAssetKey: "00000000-0000-4000-8000-000000000001",
      }),
    );
    expect(deleteStorage).not.toHaveBeenCalled();
    expect(runAfter).not.toHaveBeenCalled();
  });

  it("schedules an idempotent cache-write-failure event after attestation", async () => {
    vi.stubEnv("AI_COST_LEDGER_MODE", "observe");
    vi.stubEnv("TTS_QUOTA_BYPASS_SECRET", "server-secret");
    const input = {
      ledgerAssetKey: "00000000-0000-4000-8000-000000000001",
      source: "featured_podcast" as const,
      provider: "openai" as const,
    };
    const attestation = await createServerAttestation({
      scope: AUDIO_CACHE_WRITE_FAILURE_ATTESTATION_SCOPE,
      payload: buildAudioCacheWriteFailureAttestationPayload(input),
      secret: "server-secret",
      now: Date.now(),
      nonce: "cache-write-failure-nonce",
    });
    const runAfter = vi.fn().mockResolvedValue("scheduled-failure");
    const handler = registeredInvoker(recordSectionAudioCacheWriteFailure);

    await expect(
      handler({ scheduler: { runAfter } }, { ...input, attestation }),
    ).resolves.toEqual({ created: true, disposition: "inserted" });

    expect(runAfter).toHaveBeenCalledOnce();
    expect(getFunctionName(runAfter.mock.calls[0][1])).toBe(
      "aiCostLedger:recordCacheDecisionInternal",
    );
    expect(runAfter.mock.calls[0][2]).toMatchObject({
      eventKey: "cache-write-failure:00000000-0000-4000-8000-000000000001",
      source: "featured_podcast",
      provider: "openai",
      cacheWriteFailures: 1,
    });
  });
});
