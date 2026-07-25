import { query, mutation } from "./_generated/server";
import { v } from "convex/values";

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
};

const QUARANTINED_CONTEXT_AUDIO_PREFIXES = [
  "context-summary-",
  "context-description-",
] as const;

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
      (record) => record.ttsCacheKey === args.ttsCacheKey,
    ) ?? null
  );
};

export const getAllSectionAudio = query({
  args: {
    articleId: v.id("articles"),
    ttsNormVersion: v.string(),
    ttsCacheKey: v.string(),
    sourceHashes: v.array(
      v.object({ sectionKey: v.string(), sourceHash: v.string() }),
    ),
  },
  async handler(ctx, args) {
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
        if (r.promptVersion) metadata[r.sectionKey].promptVersion = r.promptVersion;
        if (r.durationSeconds != null) {
          durations[r.sectionKey] = r.durationSeconds;
        }
      }
    }
    return { urls, durations, metadata };
  },
});

export const generateUploadUrl = mutation({
  async handler(ctx) {
    return await ctx.storage.generateUploadUrl();
  },
});

export const saveSectionAudioRecord = mutation({
  args: {
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
  },
  async handler(ctx, args) {
    assertSectionAudioKeyCanBeSaved(args.sectionKey);

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
      });
      return existing._id;
    }

    await ctx.db.insert("sectionAudio", {
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
      createdAt: Date.now(),
    });
  },
});
