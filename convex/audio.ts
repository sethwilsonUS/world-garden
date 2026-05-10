import { query, mutation } from "./_generated/server";
import { v } from "convex/values";

type SectionAudioVariantRecord = {
  sectionKey: string;
  storageId: unknown;
  ttsNormVersion?: string;
  ttsCacheKey?: string;
};

export const selectSectionAudioVariant = <
  TRecord extends SectionAudioVariantRecord,
>(
  records: TRecord[],
  args: {
    sectionKey: string;
    ttsNormVersion: string;
    ttsCacheKey?: string;
  },
): TRecord | null => {
  const matchingSectionRecords = records.filter(
    (record) => record.sectionKey === args.sectionKey,
  );

  if (args.ttsCacheKey) {
    const exactVariant = matchingSectionRecords.find(
      (record) => record.ttsCacheKey === args.ttsCacheKey,
    );
    return exactVariant ?? null;
  }

  return (
    matchingSectionRecords.find(
      (record) =>
        record.ttsNormVersion === args.ttsNormVersion && !record.ttsCacheKey,
    ) ?? null
  );
};

export const getAllSectionAudio = query({
  args: {
    articleId: v.id("articles"),
    ttsNormVersion: v.string(),
    ttsCacheKey: v.optional(v.string()),
  },
  async handler(ctx, args) {
    const records = await ctx.db
      .query("sectionAudio")
      .withIndex("by_article_section", (q) => q.eq("articleId", args.articleId))
      .collect();

    const urls: Record<string, string> = {};
    const durations: Record<string, number> = {};
    const sectionKeys = new Set(records.map((record) => record.sectionKey));

    for (const sectionKey of sectionKeys) {
      const r = selectSectionAudioVariant(records, {
        sectionKey,
        ttsNormVersion: args.ttsNormVersion,
        ttsCacheKey: args.ttsCacheKey,
      });
      if (!r) continue;
      const url = await ctx.storage.getUrl(r.storageId);
      if (url) {
        urls[r.sectionKey] = url;
        if (r.durationSeconds != null) {
          durations[r.sectionKey] = r.durationSeconds;
        }
      }
    }
    return { urls, durations };
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
    storageId: v.id("_storage"),
    ttsNormVersion: v.string(),
    ttsCacheKey: v.optional(v.string()),
    provider: v.optional(v.string()),
    model: v.optional(v.string()),
    voiceId: v.optional(v.string()),
    promptVersion: v.optional(v.string()),
    durationSeconds: v.optional(v.number()),
  },
  async handler(ctx, args) {
    const existing = args.ttsCacheKey
      ? await ctx.db
          .query("sectionAudio")
          .withIndex("by_article_section_cache", (q) =>
            q
              .eq("articleId", args.articleId)
              .eq("sectionKey", args.sectionKey)
              .eq("ttsCacheKey", args.ttsCacheKey),
          )
          .first()
      : await ctx.db
          .query("sectionAudio")
          .withIndex("by_article_section_tts", (q) =>
            q
              .eq("articleId", args.articleId)
              .eq("sectionKey", args.sectionKey)
              .eq("ttsNormVersion", args.ttsNormVersion),
          )
          .first();

    if (existing) {
      await ctx.db.patch(existing._id, {
        storageId: args.storageId,
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
