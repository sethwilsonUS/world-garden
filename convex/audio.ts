import {
  internalMutation,
  internalQuery,
  mutation,
  query,
  type MutationCtx,
  type QueryCtx,
} from "./_generated/server";
import { v } from "convex/values";
import type { Id } from "./_generated/dataModel";
import { TTS_NORM_VERSION } from "../lib/tts-normalize";
import { normalizeTtsProvider, type TtsProvider } from "../lib/tts-profile";
import {
  AUDIO_CACHE_READ_ATTESTATION_SCOPE,
  AUDIO_CACHE_READ_RESULT_ATTESTATION_SCOPE,
  AUDIO_CACHE_SAVE_ATTESTATION_SCOPE,
  AUDIO_CACHE_UPLOAD_ATTESTATION_SCOPE,
  AUDIO_CACHE_WRITE_FAILURE_ATTESTATION_SCOPE,
  buildAudioCacheReadAttestationPayload,
  buildAudioCacheReadResultAttestationPayload,
  buildAudioCacheSaveAttestationPayload,
  buildAudioCacheUploadAttestationPayload,
  buildAudioCacheWriteFailureAttestationPayload,
} from "../lib/audio-cache-attestation";
import {
  verifyServerAttestation,
  type ServerAttestation,
  type ServerAttestationPayloadValue,
} from "../lib/server-attestation";
import {
  aiCostSourceValidator,
  aiCostProviderValidator,
  type AiCostSource,
} from "../lib/ai-cost-ledger-contract";
import {
  scheduleCacheDecisionBestEffort,
  scheduleGenerationAssetBestEffort,
} from "./lib/aiCostPipelineInstrumentation";

type SectionAudioVariantRecord = {
  sectionKey: string;
  sourceHash?: string;
  storageId: unknown;
  ttsNormVersion?: string;
  ttsCacheKey?: string;
  provider?: string;
  model?: string;
  voiceId?: string;
  promptVersion?: string;
  cacheContractVersion?: number;
  byteLength?: number;
  ledgerAssetKey?: string;
};

type PersistedSectionAudioVariantRecord = SectionAudioVariantRecord & {
  _id: unknown;
};

const QUARANTINED_CONTEXT_AUDIO_PREFIXES = [
  "context-summary-",
  "context-description-",
] as const;

export const CURRENT_SECTION_AUDIO_CACHE_CONTRACT_VERSION = 1;

export type SectionAudioWriteDisposition =
  | "inserted"
  | "idempotent_retry"
  | "competing_generation";

export const getSectionAudioWriteDisposition = (
  existing: { ledgerAssetKey?: string } | null,
  incomingLedgerAssetKey: string,
): SectionAudioWriteDisposition => {
  if (!existing?.ledgerAssetKey) return "inserted";
  return existing.ledgerAssetKey === incomingLedgerAssetKey
    ? "idempotent_retry"
    : "competing_generation";
};

export const getSectionAudioWriteCounters = (
  disposition: SectionAudioWriteDisposition,
) => ({
  uniqueGeneratedAssets: disposition === "inserted" ? 1 : 0,
  concurrentGenerationRaces: disposition === "competing_generation" ? 1 : 0,
  idempotentRetryWrites: disposition === "idempotent_retry" ? 1 : 0,
});

const getCacheKeyProvider = (ttsCacheKey: string): TtsProvider | null => {
  const [prefix, provider] = ttsCacheKey.split(":", 3);
  return prefix === "tts" ? normalizeTtsProvider(provider) : null;
};

export const assertSectionAudioCacheAccess = (ttsCacheKey: string): void => {
  if (!ttsCacheKey.endsWith(`:${TTS_NORM_VERSION}`)) {
    throw new Error("Unsupported TTS cache version.");
  }

  const provider = getCacheKeyProvider(ttsCacheKey);
  if (provider === "edge") return;
  if (provider === "openai") {
    throw new Error("OpenAI cache URLs are server-only.");
  }
  throw new Error("Unsupported TTS cache provider.");
};

export const assertCurrentSectionAudioCacheContract = (
  ttsNormVersion: string,
  ttsCacheKey: string,
): void => {
  if (
    ttsNormVersion !== TTS_NORM_VERSION ||
    !ttsCacheKey.endsWith(`:${TTS_NORM_VERSION}`)
  ) {
    throw new Error("Unsupported TTS cache version.");
  }
};

export const assertSectionAudioCacheWriteAccess = async ({
  attestation,
  scope,
  payload,
  secret,
  now,
}: {
  attestation?: ServerAttestation;
  scope: string;
  payload: readonly ServerAttestationPayloadValue[];
  secret?: string;
  now?: number;
}): Promise<void> => {
  if (
    await verifyServerAttestation({
      attestation,
      scope,
      payload,
      secret,
      now,
    })
  ) {
    return;
  }
  throw new Error("A valid server attestation is required to cache audio.");
};

export const assertSectionAudioCacheReadAccess = async ({
  attestation,
  payload,
  secret,
  now,
}: {
  attestation?: ServerAttestation;
  payload: readonly ServerAttestationPayloadValue[];
  secret?: string;
  now?: number;
}): Promise<void> => {
  if (
    await verifyServerAttestation({
      attestation,
      scope: AUDIO_CACHE_READ_ATTESTATION_SCOPE,
      payload,
      secret,
      now,
    })
  ) {
    return;
  }
  throw new Error(
    "A valid server attestation is required to read protected audio.",
  );
};

export const assertSectionAudioMetadataMatchesCacheKey = (
  provider: string | undefined,
  ttsCacheKey: string,
): void => {
  const cacheKeyProvider = getCacheKeyProvider(ttsCacheKey);
  if (!cacheKeyProvider) {
    throw new Error("Unsupported TTS cache key.");
  }
  if (provider && normalizeTtsProvider(provider) !== cacheKeyProvider) {
    throw new Error("TTS provider does not match its cache key.");
  }
};

export const isQuarantinedContextAudioKey = (sectionKey: string): boolean =>
  QUARANTINED_CONTEXT_AUDIO_PREFIXES.some((prefix) =>
    sectionKey.startsWith(prefix),
  );

export const assertSectionAudioKeyCanBeSaved = (sectionKey: string): void => {
  if (isQuarantinedContextAudioKey(sectionKey)) {
    throw new Error("Context narration audio is no longer supported.");
  }
};

const LEDGER_ASSET_KEY_PATTERN = /^[A-Za-z0-9][A-Za-z0-9_-]{15,127}$/;

export const assertSectionAudioLedgerMetadata = ({
  byteLength,
  ledgerAssetKey,
  expectedExistingLedgerAssetKey,
}: {
  byteLength?: number;
  ledgerAssetKey?: string;
  expectedExistingLedgerAssetKey?: string;
}): void => {
  if (
    byteLength != null &&
    (!Number.isSafeInteger(byteLength) || byteLength < 0)
  ) {
    throw new Error("Audio byte length must be a nonnegative safe integer.");
  }
  for (const assetKey of [ledgerAssetKey, expectedExistingLedgerAssetKey]) {
    if (assetKey != null && !LEDGER_ASSET_KEY_PATTERN.test(assetKey)) {
      throw new Error("Audio ledger asset key must be bounded and opaque.");
    }
  }
};

const EXTERNAL_CONSUMPTION_UNKNOWN_SOURCES = new Set<AiCostSource>([
  "article_audio_export",
  "personal_playlist",
  "featured_podcast",
  "trending_podcast",
  "picture_of_day",
  "unknown",
]);

export const hasExternalConsumptionUnknown = (source: AiCostSource): boolean =>
  EXTERNAL_CONSUMPTION_UNKNOWN_SOURCES.has(source);

export const summarizeSectionAudioCacheRead = ({
  requestedSectionKeys,
  servedRecords,
}: {
  requestedSectionKeys: string[];
  servedRecords: Array<{
    sectionKey: string;
    byteLength?: number;
    durationSeconds?: number;
  }>;
}) => {
  const requestedKeys = new Set(
    requestedSectionKeys.filter(
      (sectionKey) => !isQuarantinedContextAudioKey(sectionKey),
    ),
  );
  const servedByKey = new Map(
    servedRecords
      .filter((record) => requestedKeys.has(record.sectionKey))
      .map((record) => [record.sectionKey, record]),
  );
  const requests = requestedKeys.size;
  const hits = servedByKey.size;

  return {
    requests,
    hits,
    misses: Math.max(0, requests - hits),
    reusedAssetServes: hits,
    avoidedGeneration: hits,
    bytes: [...servedByKey.values()].reduce(
      (total, record) =>
        total +
        (Number.isFinite(record.byteLength) && (record.byteLength ?? 0) > 0
          ? record.byteLength!
          : 0),
      0,
    ),
    seconds: [...servedByKey.values()].reduce(
      (total, record) =>
        total +
        (Number.isFinite(record.durationSeconds) &&
        (record.durationSeconds ?? 0) > 0
          ? record.durationSeconds!
          : 0),
      0,
    ),
  };
};

export const selectSectionAudioVariant = <
  TRecord extends SectionAudioVariantRecord,
>(
  records: TRecord[],
  args: {
    sectionKey: string;
    ttsNormVersion: string;
    ttsCacheKey: string;
    sourceHash: string;
  },
): TRecord | null => {
  if (isQuarantinedContextAudioKey(args.sectionKey)) return null;

  const matchingSectionRecords = records.filter(
    (record) =>
      record.sectionKey === args.sectionKey &&
      record.sourceHash === args.sourceHash,
  );

  return (
    matchingSectionRecords.find(
      (record) =>
        record.cacheContractVersion ===
          CURRENT_SECTION_AUDIO_CACHE_CONTRACT_VERSION &&
        record.ttsNormVersion === args.ttsNormVersion &&
        record.ttsCacheKey === args.ttsCacheKey,
    ) ?? null
  );
};

export const selectSupersededSectionAudioRecords = <
  TRecord extends PersistedSectionAudioVariantRecord,
>(
  records: TRecord[],
  args: {
    savedId: unknown;
    sourceHash: string;
    ttsCacheKey: string;
  },
): TRecord[] =>
  records.filter(
    (record) =>
      record._id !== args.savedId &&
      (record.ttsCacheKey == null || record.ttsCacheKey === args.ttsCacheKey),
  );

const getAllSectionAudioArgs = {
  articleId: v.id("articles"),
  ttsNormVersion: v.string(),
  ttsCacheKey: v.string(),
  sourceHashes: v.array(
    v.object({ sectionKey: v.string(), sourceHash: v.string() }),
  ),
  ledgerSource: v.optional(aiCostSourceValidator),
};

const serverAttestationValidator = v.object({
  issuedAt: v.number(),
  expiresAt: v.number(),
  nonce: v.string(),
  signature: v.string(),
});

type GetAllSectionAudioArgs = {
  articleId: Id<"articles">;
  ttsNormVersion: string;
  ttsCacheKey: string;
  sourceHashes: Array<{ sectionKey: string; sourceHash: string }>;
  ledgerSource?: AiCostSource;
};

const getAllSectionAudioHandler = async (
  ctx: Pick<QueryCtx, "db" | "storage">,
  args: GetAllSectionAudioArgs,
  onCacheRead?: (
    summary: ReturnType<typeof summarizeSectionAudioCacheRead>,
  ) => Promise<void>,
  includeLedgerAssetKeys = false,
) => {
  assertCurrentSectionAudioCacheContract(args.ttsNormVersion, args.ttsCacheKey);
  const records = await ctx.db
    .query("sectionAudio")
    .withIndex("by_article_section", (q) => q.eq("articleId", args.articleId))
    .collect();

  const urls: Record<string, string> = {};
  const durations: Record<string, number> = {};
  const byteLengths: Record<string, number> = {};
  const metadata: Record<string, Record<string, string>> = {};
  const ledgerAssetKeys: Record<string, string> = {};
  const servedRecords: Array<{
    sectionKey: string;
    byteLength?: number;
    durationSeconds?: number;
  }> = [];
  const requestedSources = new Map(
    args.sourceHashes
      .filter(({ sectionKey }) => !isQuarantinedContextAudioKey(sectionKey))
      .map(({ sectionKey, sourceHash }) => [sectionKey, sourceHash]),
  );

  for (const [sectionKey, sourceHash] of requestedSources) {
    const r = selectSectionAudioVariant(records, {
      sectionKey,
      ttsNormVersion: args.ttsNormVersion,
      ttsCacheKey: args.ttsCacheKey,
      sourceHash,
    });
    if (!r) continue;
    if (includeLedgerAssetKeys && r.ledgerAssetKey) {
      ledgerAssetKeys[r.sectionKey] = r.ledgerAssetKey;
    }
    const url = await ctx.storage.getUrl(r.storageId);
    if (url) {
      urls[r.sectionKey] = url;
      metadata[r.sectionKey] = {};
      if (r.ttsNormVersion) {
        metadata[r.sectionKey].ttsNormVersion = r.ttsNormVersion;
      }
      if (r.ttsCacheKey) metadata[r.sectionKey].ttsCacheKey = r.ttsCacheKey;
      if (r.provider) metadata[r.sectionKey].provider = r.provider;
      if (r.model) metadata[r.sectionKey].model = r.model;
      if (r.voiceId) metadata[r.sectionKey].voiceId = r.voiceId;
      if (r.promptVersion)
        metadata[r.sectionKey].promptVersion = r.promptVersion;
      if (r.durationSeconds != null) {
        durations[r.sectionKey] = r.durationSeconds;
      }
      if (r.byteLength != null) {
        byteLengths[r.sectionKey] = r.byteLength;
      }
      servedRecords.push({
        sectionKey: r.sectionKey,
        byteLength: r.byteLength,
        durationSeconds: r.durationSeconds,
      });
    }
  }
  await onCacheRead?.(
    summarizeSectionAudioCacheRead({
      requestedSectionKeys: [...requestedSources.keys()],
      servedRecords,
    }),
  );
  return {
    urls,
    durations,
    byteLengths,
    metadata,
    ...(includeLedgerAssetKeys ? { ledgerAssetKeys } : {}),
  };
};

export const getAllSectionAudio = query({
  args: getAllSectionAudioArgs,
  async handler(ctx, args) {
    assertSectionAudioCacheAccess(args.ttsCacheKey);
    return await getAllSectionAudioHandler(ctx, args);
  },
});

export const getAllSectionAudioForServer = mutation({
  args: {
    ...getAllSectionAudioArgs,
    attestation: v.optional(serverAttestationValidator),
  },
  async handler(ctx, { attestation, ...args }) {
    await assertSectionAudioCacheReadAccess({
      attestation,
      payload: buildAudioCacheReadAttestationPayload(args),
      secret: process.env.TTS_QUOTA_BYPASS_SECRET?.trim(),
    });
    return await getAllSectionAudioHandler(
      ctx,
      args,
      async (summary) => {
        if (!attestation || !args.ledgerSource) return;
        try {
          const provider = getCacheKeyProvider(args.ttsCacheKey);
          if (!provider) throw new Error("Unsupported TTS cache provider.");
          await scheduleCacheDecisionBestEffort(ctx, {
            eventKey: `cache-read:${attestation.nonce}`,
            source: args.ledgerSource,
            provider,
            operation: "tts",
            ...summary,
            uniqueGeneratedAssets: 0,
            concurrentGenerationRaces: 0,
            cacheWriteFailures: 0,
            idempotentRetryWrites: 0,
            recordedAt: Date.now(),
          });
        } catch {
          console.warn("[ai-cost-ledger] Audio cache read was not recorded.");
        }
      },
      true,
    );
  },
});

export const getAllSectionAudioInternal = internalQuery({
  args: getAllSectionAudioArgs,
  handler: getAllSectionAudioHandler,
});

export const recordSectionAudioCacheReadResult = mutation({
  args: {
    source: aiCostSourceValidator,
    provider: aiCostProviderValidator,
    hit: v.boolean(),
    byteLength: v.number(),
    durationSeconds: v.number(),
    attestation: v.optional(serverAttestationValidator),
  },
  async handler(ctx, { attestation, ...result }) {
    await assertSectionAudioCacheWriteAccess({
      attestation,
      scope: AUDIO_CACHE_READ_RESULT_ATTESTATION_SCOPE,
      payload: buildAudioCacheReadResultAttestationPayload(result),
      secret: process.env.TTS_QUOTA_BYPASS_SECRET?.trim(),
    });
    assertSectionAudioLedgerMetadata({ byteLength: result.byteLength });
    if (
      !Number.isFinite(result.durationSeconds) ||
      result.durationSeconds < 0 ||
      (!result.hit && (result.byteLength !== 0 || result.durationSeconds !== 0))
    ) {
      throw new Error("Audio cache read result is inconsistent.");
    }
    const scheduled = await scheduleCacheDecisionBestEffort(ctx, {
      eventKey: `cache-read-result:${attestation?.nonce ?? "missing"}`,
      source: result.source,
      provider: result.provider,
      operation: "tts",
      requests: 1,
      hits: result.hit ? 1 : 0,
      misses: result.hit ? 0 : 1,
      reusedAssetServes: result.hit ? 1 : 0,
      avoidedGeneration: result.hit ? 1 : 0,
      uniqueGeneratedAssets: 0,
      concurrentGenerationRaces: 0,
      cacheWriteFailures: 0,
      idempotentRetryWrites: 0,
      bytes: result.byteLength,
      seconds: result.durationSeconds,
      recordedAt: Date.now(),
    });
    return {
      created: scheduled,
      disposition: scheduled ? ("inserted" as const) : ("disabled" as const),
    };
  },
});

const generateUploadUrlHandler = async (ctx: MutationCtx) =>
  await ctx.storage.generateUploadUrl();

export const generateUploadUrl = mutation({
  args: { attestation: v.optional(serverAttestationValidator) },
  async handler(ctx, args) {
    await assertSectionAudioCacheWriteAccess({
      attestation: args.attestation,
      scope: AUDIO_CACHE_UPLOAD_ATTESTATION_SCOPE,
      payload: buildAudioCacheUploadAttestationPayload(),
      secret: process.env.TTS_QUOTA_BYPASS_SECRET?.trim(),
    });
    return await generateUploadUrlHandler(ctx);
  },
});

export const generateUploadUrlInternal = internalMutation({
  args: {},
  handler: generateUploadUrlHandler,
});

export const recordSectionAudioCacheWriteFailure = mutation({
  args: {
    ledgerAssetKey: v.string(),
    source: aiCostSourceValidator,
    provider: aiCostProviderValidator,
    attestation: v.optional(serverAttestationValidator),
  },
  async handler(ctx, args) {
    await assertSectionAudioCacheWriteAccess({
      attestation: args.attestation,
      scope: AUDIO_CACHE_WRITE_FAILURE_ATTESTATION_SCOPE,
      payload: buildAudioCacheWriteFailureAttestationPayload(args),
      secret: process.env.TTS_QUOTA_BYPASS_SECRET?.trim(),
    });
    assertSectionAudioLedgerMetadata({
      byteLength: 0,
      ledgerAssetKey: args.ledgerAssetKey,
    });
    try {
      const scheduled = await scheduleCacheDecisionBestEffort(ctx, {
        eventKey: `cache-write-failure:${args.ledgerAssetKey}`,
        source: args.source,
        provider: args.provider,
        operation: "tts",
        requests: 0,
        hits: 0,
        misses: 0,
        reusedAssetServes: 0,
        avoidedGeneration: 0,
        uniqueGeneratedAssets: 0,
        concurrentGenerationRaces: 0,
        cacheWriteFailures: 1,
        idempotentRetryWrites: 0,
        bytes: 0,
        seconds: 0,
        recordedAt: Date.now(),
      });
      return {
        created: scheduled,
        disposition: scheduled ? ("inserted" as const) : ("disabled" as const),
      };
    } catch {
      console.warn("[ai-cost-ledger] Audio cache failure was not recorded.");
      return { created: false, disposition: "disabled" as const };
    }
  },
});

const saveSectionAudioRecordArgs = {
  articleId: v.id("articles"),
  sectionKey: v.string(),
  sourceHash: v.string(),
  storageId: v.id("_storage"),
  ttsNormVersion: v.string(),
  ttsCacheKey: v.string(),
  provider: v.optional(v.string()),
  model: v.optional(v.string()),
  voiceId: v.optional(v.string()),
  promptVersion: v.optional(v.string()),
  durationSeconds: v.optional(v.number()),
  byteLength: v.optional(v.number()),
  ledgerAssetKey: v.optional(v.string()),
  expectedExistingLedgerAssetKey: v.optional(v.string()),
  ledgerSource: v.optional(aiCostSourceValidator),
  attestation: v.optional(serverAttestationValidator),
};

type SaveSectionAudioRecordArgs = {
  articleId: Id<"articles">;
  sectionKey: string;
  sourceHash: string;
  storageId: Id<"_storage">;
  ttsNormVersion: string;
  ttsCacheKey: string;
  provider?: string;
  model?: string;
  voiceId?: string;
  promptVersion?: string;
  durationSeconds?: number;
  byteLength?: number;
  ledgerAssetKey?: string;
  expectedExistingLedgerAssetKey?: string;
  ledgerSource?: AiCostSource;
  attestation?: ServerAttestation;
};

const saveSectionAudioRecordHandler = async (
  ctx: MutationCtx,
  args: SaveSectionAudioRecordArgs,
) => {
  assertSectionAudioKeyCanBeSaved(args.sectionKey);
  assertSectionAudioLedgerMetadata(args);
  assertCurrentSectionAudioCacheContract(args.ttsNormVersion, args.ttsCacheKey);
  assertSectionAudioMetadataMatchesCacheKey(args.provider, args.ttsCacheKey);

  const existing = await ctx.db
    .query("sectionAudio")
    .withIndex("by_article_section_cache_source", (q) =>
      q
        .eq("articleId", args.articleId)
        .eq("sectionKey", args.sectionKey)
        .eq("ttsCacheKey", args.ttsCacheKey)
        .eq("sourceHash", args.sourceHash),
    )
    .first();
  const writeDisposition = args.ledgerAssetKey
    ? getSectionAudioWriteDisposition(existing, args.ledgerAssetKey)
    : null;
  const isExpectedReplacement =
    writeDisposition === "competing_generation" &&
    existing?.ledgerAssetKey !== undefined &&
    args.expectedExistingLedgerAssetKey === existing.ledgerAssetKey;
  const ledgerWriteDisposition = isExpectedReplacement
    ? "inserted"
    : writeDisposition;
  const retainExistingGenerationCohort =
    writeDisposition === "competing_generation" &&
    !isExpectedReplacement &&
    existing !== null;
  const persistedLedgerAssetKey = retainExistingGenerationCohort
    ? existing.ledgerAssetKey
    : args.ledgerAssetKey;

  let savedId;
  if (existing) {
    await ctx.db.patch(existing._id, {
      storageId: args.storageId,
      sourceHash: args.sourceHash,
      ttsNormVersion: args.ttsNormVersion,
      ttsCacheKey: args.ttsCacheKey,
      provider: args.provider,
      model: args.model,
      voiceId: args.voiceId,
      promptVersion: args.promptVersion,
      durationSeconds: args.durationSeconds,
      ...(args.byteLength != null ? { byteLength: args.byteLength } : {}),
      ...(persistedLedgerAssetKey != null
        ? { ledgerAssetKey: persistedLedgerAssetKey }
        : {}),
      cacheContractVersion: CURRENT_SECTION_AUDIO_CACHE_CONTRACT_VERSION,
    });
    savedId = existing._id;
  } else {
    savedId = await ctx.db.insert("sectionAudio", {
      articleId: args.articleId,
      sectionKey: args.sectionKey,
      sourceHash: args.sourceHash,
      storageId: args.storageId,
      ttsNormVersion: args.ttsNormVersion,
      ttsCacheKey: args.ttsCacheKey,
      provider: args.provider,
      model: args.model,
      voiceId: args.voiceId,
      promptVersion: args.promptVersion,
      durationSeconds: args.durationSeconds,
      byteLength: args.byteLength,
      ledgerAssetKey: persistedLedgerAssetKey,
      cacheContractVersion: CURRENT_SECTION_AUDIO_CACHE_CONTRACT_VERSION,
      createdAt: Date.now(),
    });
  }

  const sectionRecords = await ctx.db
    .query("sectionAudio")
    .withIndex("by_article_section", (q) =>
      q.eq("articleId", args.articleId).eq("sectionKey", args.sectionKey),
    )
    .collect();
  const supersededRecords = selectSupersededSectionAudioRecords(
    sectionRecords,
    {
      savedId,
      sourceHash: args.sourceHash,
      ttsCacheKey: args.ttsCacheKey,
    },
  );
  for (const record of supersededRecords) {
    await ctx.db.delete(record._id);
    if (record.storageId !== args.storageId) {
      await ctx.storage.delete(record.storageId);
    }
  }

  if (
    ledgerWriteDisposition &&
    args.ledgerAssetKey &&
    args.ledgerSource &&
    args.byteLength != null
  ) {
    try {
      const provider = getCacheKeyProvider(args.ttsCacheKey);
      if (!provider) throw new Error("Unsupported TTS cache provider.");
      const durationMs =
        args.durationSeconds != null &&
        Number.isFinite(args.durationSeconds) &&
        args.durationSeconds > 0
          ? Math.round(args.durationSeconds * 1_000)
          : 0;
      const recordedAt = Date.now();

      if (ledgerWriteDisposition === "inserted") {
        await scheduleGenerationAssetBestEffort(ctx, {
          eventKey: args.ledgerAssetKey,
          articleId: args.articleId,
          sectionKey: args.sectionKey,
          source: args.ledgerSource,
          provider,
          model: args.model ?? null,
          byteLength: args.byteLength,
          durationMs,
          durationMeasurement: durationMs > 0 ? "estimated" : "unknown",
          externalConsumptionUnknown: hasExternalConsumptionUnknown(
            args.ledgerSource,
          ),
          generatedAt: recordedAt,
        });
      }

      await scheduleCacheDecisionBestEffort(ctx, {
        eventKey: [
          "cache-write",
          args.ledgerAssetKey,
          ledgerWriteDisposition,
        ].join(":"),
        source: args.ledgerSource,
        provider,
        operation: "tts",
        requests: 0,
        hits: 0,
        misses: 0,
        reusedAssetServes: 0,
        avoidedGeneration: 0,
        ...getSectionAudioWriteCounters(ledgerWriteDisposition),
        cacheWriteFailures: 0,
        bytes: 0,
        seconds: 0,
        recordedAt,
      });
    } catch {
      console.warn("[ai-cost-ledger] Audio cache write was not recorded.");
    }
  }

  return savedId;
};

export const saveSectionAudioRecord = mutation({
  args: saveSectionAudioRecordArgs,
  async handler(ctx, args) {
    await assertSectionAudioCacheWriteAccess({
      attestation: args.attestation,
      scope: AUDIO_CACHE_SAVE_ATTESTATION_SCOPE,
      payload: buildAudioCacheSaveAttestationPayload(args),
      secret: process.env.TTS_QUOTA_BYPASS_SECRET?.trim(),
    });
    return await saveSectionAudioRecordHandler(ctx, args);
  },
});

export const saveSectionAudioRecordInternal = internalMutation({
  args: saveSectionAudioRecordArgs,
  handler: saveSectionAudioRecordHandler,
});
