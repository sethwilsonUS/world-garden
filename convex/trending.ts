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
    artworkStorageId?: Id<"_storage">;
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
  const artworkUrl = record.artworkStorageId
    ? await ctx.storage.getUrl(record.artworkStorageId)
    : null;
  return { ...record, audioUrl, artworkUrl };
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
      .sort((a, b) => b.updatedAt - a.updatedAt)
      .slice(0, limit);

    return await Promise.all(filtered.map((record) => withStorageUrl(ctx, record)));
  },
});

export const generateUploadUrl = mutation({
  async handler(ctx) {
    return await ctx.storage.generateUploadUrl();
  },
});

export const getTrendingBriefJobByDate = query({
  args: {
    trendingDate: v.string(),
  },
  async handler(ctx, args) {
    return await ctx.db
      .query("trendingBriefJobs")
      .withIndex("by_trendingDate", (q) => q.eq("trendingDate", args.trendingDate))
      .first();
  },
});

export const claimTrendingBriefJob = mutation({
  args: {
    trendingDate: v.string(),
    owner: v.string(),
    leaseMs: v.number(),
  },
  async handler(ctx, args) {
    const existing = await ctx.db
      .query("trendingBriefJobs")
      .withIndex("by_trendingDate", (q) => q.eq("trendingDate", args.trendingDate))
      .first();

    const now = Date.now();
    const leaseExpiresAt = now + Math.max(args.leaseMs, 1);

    if (
      existing &&
      existing.status === "running" &&
      existing.leaseOwner &&
      existing.leaseOwner !== args.owner &&
      (existing.leaseExpiresAt ?? 0) > now
    ) {
      return { claimed: false, attempts: existing.attempts };
    }

    const attempts = (existing?.attempts ?? 0) + 1;

    if (existing) {
      await ctx.db.patch(existing._id, {
        status: "running",
        attempts,
        lastError: undefined,
        leaseOwner: args.owner,
        leaseExpiresAt,
        updatedAt: now,
      });
      return { claimed: true, attempts };
    }

    await ctx.db.insert("trendingBriefJobs", {
      trendingDate: args.trendingDate,
      status: "running",
      attempts,
      lastError: undefined,
      leaseOwner: args.owner,
      leaseExpiresAt,
      createdAt: now,
      updatedAt: now,
    });

    return { claimed: true, attempts };
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
    artworkItems: v.optional(
      v.array(
        v.object({
          title: v.string(),
          imageUrl: v.string(),
        }),
      ),
    ),
    sources: v.optional(
      v.array(
        v.object({
          title: v.string(),
          url: v.string(),
        }),
      ),
    ),
    storageId: v.optional(v.id("_storage")),
    artworkStorageId: v.optional(v.id("_storage")),
    artworkVersion: v.optional(v.number()),
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
        artworkItems: args.artworkItems,
        sources: args.sources,
        storageId: args.storageId,
        artworkStorageId: args.artworkStorageId,
        artworkVersion: args.artworkVersion,
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
      artworkItems: args.artworkItems,
      sources: args.sources,
      storageId: args.storageId,
      artworkStorageId: args.artworkStorageId,
      artworkVersion: args.artworkVersion,
      durationSeconds: args.durationSeconds,
      byteLength: args.byteLength,
      model: args.model,
      lastError: args.lastError,
      createdAt: now,
      updatedAt: now,
    });
  },
});

export const finalizeTrendingBriefJob = mutation({
  args: {
    trendingDate: v.string(),
    owner: v.string(),
    status: v.union(v.literal("ready"), v.literal("failed")),
    lastError: v.optional(v.string()),
  },
  async handler(ctx, args) {
    const existing = await ctx.db
      .query("trendingBriefJobs")
      .withIndex("by_trendingDate", (q) => q.eq("trendingDate", args.trendingDate))
      .first();

    if (!existing || existing.leaseOwner !== args.owner) {
      return { updated: false };
    }

    await ctx.db.patch(existing._id, {
      status: args.status,
      lastError: args.lastError,
      leaseOwner: undefined,
      leaseExpiresAt: undefined,
      updatedAt: Date.now(),
    });

    return { updated: true };
  },
});
