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
  AUDIO_CACHE_SAVE_ATTESTATION_SCOPE,
  AUDIO_CACHE_UPLOAD_ATTESTATION_SCOPE,
  buildAudioCacheReadAttestationPayload,
  buildAudioCacheSaveAttestationPayload,
  buildAudioCacheUploadAttestationPayload,
} from "../lib/audio-cache-attestation";
import {
  verifyServerAttestation,
  type ServerAttestation,
  type ServerAttestationPayloadValue,
} from "../lib/server-attestation";

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
};

type PersistedSectionAudioVariantRecord = SectionAudioVariantRecord & {
  _id: unknown;
};

const QUARANTINED_CONTEXT_AUDIO_PREFIXES = [
  "context-summary-",
  "context-description-",
] as const;

export const CURRENT_SECTION_AUDIO_CACHE_CONTRACT_VERSION = 1;

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
};

const getAllSectionAudioHandler = async (
  ctx: Pick<QueryCtx, "db" | "storage">,
  args: GetAllSectionAudioArgs,
) => {
  assertCurrentSectionAudioCacheContract(args.ttsNormVersion, args.ttsCacheKey);
  const records = await ctx.db
    .query("sectionAudio")
    .withIndex("by_article_section", (q) => q.eq("articleId", args.articleId))
    .collect();

  const urls: Record<string, string> = {};
  const durations: Record<string, number> = {};
  const metadata: Record<string, Record<string, string>> = {};
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
    }
  }
  return { urls, durations, metadata };
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
    return await getAllSectionAudioHandler(ctx, args);
  },
});

export const getAllSectionAudioInternal = internalQuery({
  args: getAllSectionAudioArgs,
  handler: getAllSectionAudioHandler,
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
  attestation?: ServerAttestation;
};

const saveSectionAudioRecordHandler = async (
  ctx: MutationCtx,
  args: SaveSectionAudioRecordArgs,
) => {
  assertSectionAudioKeyCanBeSaved(args.sectionKey);
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
