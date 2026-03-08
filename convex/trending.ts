import { mutation, query } from "./_generated/server";
import { Id } from "./_generated/dataModel";
import { v } from "convex/values";

const trendingBriefStatus = v.union(
  v.literal("pending"),
  v.literal("ready"),
  v.literal("failed"),
);

const withStorageUrl = async <
  T extends {
    storageId?: Id<"_storage">;
  },
>(
  ctx: {
    storage: {
      getUrl(storageId: Id<"_storage">): Promise<string | null>;
    };
  },
  record: T,
) => {
  const audioUrl = record.storageId
    ? await ctx.storage.getUrl(record.storageId)
    : null;
  return { ...record, audioUrl };
};

export const getTrendingBriefByDate = query({
  args: {
    trendingDate: v.string(),
  },
  async handler(ctx, args) {
    const record = await ctx.db
      .query("trendingBriefs")
      .withIndex("by_trendingDate", (q) => q.eq("trendingDate", args.trendingDate))
      .first();

    return record ? await withStorageUrl(ctx, record) : null;
  },
});

export const generateUploadUrl = mutation({
  async handler(ctx) {
    return await ctx.storage.generateUploadUrl();
  },
});

export const saveTrendingBrief = mutation({
  args: {
    trendingDate: v.string(),
    status: trendingBriefStatus,
    headline: v.optional(v.string()),
    summary: v.optional(v.string()),
    spokenSummary: v.optional(v.string()),
    keyPoints: v.optional(v.array(v.string())),
    articleTitles: v.optional(v.array(v.string())),
    sources: v.optional(
      v.array(
        v.object({
          title: v.string(),
          url: v.string(),
        }),
      ),
    ),
    storageId: v.optional(v.id("_storage")),
    durationSeconds: v.optional(v.number()),
    byteLength: v.optional(v.number()),
    model: v.optional(v.string()),
    lastError: v.optional(v.string()),
  },
  async handler(ctx, args) {
    const existing = await ctx.db
      .query("trendingBriefs")
      .withIndex("by_trendingDate", (q) => q.eq("trendingDate", args.trendingDate))
      .first();

    const now = Date.now();

    if (existing) {
      await ctx.db.patch(existing._id, {
        status: args.status,
        headline: args.headline,
        summary: args.summary,
        spokenSummary: args.spokenSummary,
        keyPoints: args.keyPoints,
        articleTitles: args.articleTitles,
        sources: args.sources,
        storageId: args.storageId,
        durationSeconds: args.durationSeconds,
        byteLength: args.byteLength,
        model: args.model,
        lastError: args.lastError,
        updatedAt: now,
      });
      return existing._id;
    }

    return await ctx.db.insert("trendingBriefs", {
      trendingDate: args.trendingDate,
      status: args.status,
      headline: args.headline,
      summary: args.summary,
      spokenSummary: args.spokenSummary,
      keyPoints: args.keyPoints,
      articleTitles: args.articleTitles,
      sources: args.sources,
      storageId: args.storageId,
      durationSeconds: args.durationSeconds,
      byteLength: args.byteLength,
      model: args.model,
      lastError: args.lastError,
      createdAt: now,
      updatedAt: now,
    });
  },
});
