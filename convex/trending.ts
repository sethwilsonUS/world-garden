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

export const getTrendingBriefById = query({
  args: {
    briefId: v.id("trendingBriefs"),
  },
  async handler(ctx, args) {
    const record = await ctx.db.get(args.briefId);
    return record ? await withStorageUrl(ctx, record) : null;
  },
});

export const getRecentTrendingBriefs = query({
  args: {
    limit: v.optional(v.number()),
    status: v.optional(trendingBriefStatus),
  },
  async handler(ctx, args) {
    const limit = Math.max(1, Math.min(args.limit ?? 20, 100));
    const records = await ctx.db.query("trendingBriefs").collect();

    const filtered = records
      .filter((record) => (args.status ? record.status === args.status : true))
      .sort((a, b) => {
        if (a.trendingDate === b.trendingDate) {
          return b.updatedAt - a.updatedAt;
        }
        return b.trendingDate.localeCompare(a.trendingDate);
      })
      .slice(0, limit);

    return await Promise.all(filtered.map((record) => withStorageUrl(ctx, record)));
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
    podcastDescription: v.optional(v.string()),
    spokenSummary: v.optional(v.string()),
    keyPoints: v.optional(v.array(v.string())),
    articleTitles: v.optional(v.array(v.string())),
    imageUrls: v.optional(v.array(v.string())),
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
        podcastDescription: args.podcastDescription,
        spokenSummary: args.spokenSummary,
        keyPoints: args.keyPoints,
        articleTitles: args.articleTitles,
        imageUrls: args.imageUrls,
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
      podcastDescription: args.podcastDescription,
      spokenSummary: args.spokenSummary,
      keyPoints: args.keyPoints,
      articleTitles: args.articleTitles,
      imageUrls: args.imageUrls,
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
