import { query, mutation } from "./_generated/server";
import { v } from "convex/values";

export const getAllSectionAudio = query({
  args: {
    articleId: v.id("articles"),
    ttsNormVersion: v.string(),
  },
  async handler(ctx, args) {
    const records = await ctx.db
      .query("sectionAudio")
      .withIndex("by_article_section", (q) => q.eq("articleId", args.articleId))
      .collect();

    const urls: Record<string, string> = {};
    const durations: Record<string, number> = {};
    for (const r of records) {
      if (r.ttsNormVersion !== args.ttsNormVersion) continue;
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
    durationSeconds: v.optional(v.number()),
  },
  async handler(ctx, args) {
    await ctx.db.insert("sectionAudio", {
      articleId: args.articleId,
      sectionKey: args.sectionKey,
      storageId: args.storageId,
      ttsNormVersion: args.ttsNormVersion,
      durationSeconds: args.durationSeconds,
      createdAt: Date.now(),
    });
  },
});
