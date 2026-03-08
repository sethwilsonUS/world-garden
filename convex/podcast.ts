import { mutation, query } from "./_generated/server";
import { Id } from "./_generated/dataModel";
import { v } from "convex/values";

const featuredPodcastEpisodeStatus = v.union(
  v.literal("pending"),
  v.literal("ready"),
  v.literal("failed"),
);

const featuredPodcastJobStatus = v.union(
  v.literal("pending"),
  v.literal("running"),
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

export const getRecentFeaturedEpisodes = query({
  args: {
    limit: v.optional(v.number()),
    status: v.optional(featuredPodcastEpisodeStatus),
  },
  async handler(ctx, args) {
    const limit = Math.max(1, Math.min(args.limit ?? 20, 100));
    const records = await ctx.db.query("featuredPodcastEpisodes").collect();

    const filtered = records
      .filter((record) => (args.status ? record.status === args.status : true))
      .sort((a, b) => b.publishedAt - a.publishedAt)
      .slice(0, limit);

    return await Promise.all(filtered.map((record) => withStorageUrl(ctx, record)));
  },
});

export const getFeaturedEpisodeByDate = query({
  args: {
    featuredDate: v.string(),
  },
  async handler(ctx, args) {
    const record = await ctx.db
      .query("featuredPodcastEpisodes")
      .withIndex("by_featuredDate", (q) => q.eq("featuredDate", args.featuredDate))
      .first();

    return record ? await withStorageUrl(ctx, record) : null;
  },
});

export const getFeaturedEpisodeById = query({
  args: {
    episodeId: v.id("featuredPodcastEpisodes"),
  },
  async handler(ctx, args) {
    const record = await ctx.db.get(args.episodeId);
    return record ? await withStorageUrl(ctx, record) : null;
  },
});

export const getFeaturedEpisodeJobByDate = query({
  args: {
    featuredDate: v.string(),
  },
  async handler(ctx, args) {
    return await ctx.db
      .query("featuredPodcastJobs")
      .withIndex("by_featuredDate", (q) => q.eq("featuredDate", args.featuredDate))
      .first();
  },
});

export const generateUploadUrl = mutation({
  async handler(ctx) {
    return await ctx.storage.generateUploadUrl();
  },
});

export const saveFeaturedEpisode = mutation({
  args: {
    featuredDate: v.string(),
    articleId: v.id("articles"),
    wikiPageId: v.string(),
    slug: v.string(),
    title: v.string(),
    description: v.optional(v.string()),
    imageUrl: v.optional(v.string()),
    storageId: v.optional(v.id("_storage")),
    durationSeconds: v.optional(v.number()),
    byteLength: v.optional(v.number()),
    ttsNormVersion: v.string(),
    status: featuredPodcastEpisodeStatus,
    publishedAt: v.number(),
  },
  async handler(ctx, args) {
    const existing = await ctx.db
      .query("featuredPodcastEpisodes")
      .withIndex("by_featuredDate", (q) => q.eq("featuredDate", args.featuredDate))
      .first();

    const now = Date.now();
    if (existing) {
      await ctx.db.patch(existing._id, {
        articleId: args.articleId,
        wikiPageId: args.wikiPageId,
        slug: args.slug,
        title: args.title,
        description: args.description,
        imageUrl: args.imageUrl,
        storageId: args.storageId,
        durationSeconds: args.durationSeconds,
        byteLength: args.byteLength,
        ttsNormVersion: args.ttsNormVersion,
        status: args.status,
        publishedAt: args.publishedAt,
        updatedAt: now,
      });
      return existing._id;
    }

    return await ctx.db.insert("featuredPodcastEpisodes", {
      featuredDate: args.featuredDate,
      articleId: args.articleId,
      wikiPageId: args.wikiPageId,
      slug: args.slug,
      title: args.title,
      description: args.description,
      imageUrl: args.imageUrl,
      storageId: args.storageId,
      durationSeconds: args.durationSeconds,
      byteLength: args.byteLength,
      ttsNormVersion: args.ttsNormVersion,
      status: args.status,
      publishedAt: args.publishedAt,
      createdAt: now,
      updatedAt: now,
    });
  },
});

export const upsertFeaturedEpisodeJob = mutation({
  args: {
    featuredDate: v.string(),
    articleId: v.optional(v.id("articles")),
    status: featuredPodcastJobStatus,
    attempts: v.number(),
    lastError: v.optional(v.string()),
  },
  async handler(ctx, args) {
    const existing = await ctx.db
      .query("featuredPodcastJobs")
      .withIndex("by_featuredDate", (q) => q.eq("featuredDate", args.featuredDate))
      .first();

    const now = Date.now();
    if (existing) {
      await ctx.db.patch(existing._id, {
        articleId: args.articleId,
        status: args.status,
        attempts: args.attempts,
        lastError: args.lastError,
        updatedAt: now,
      });
      return existing._id;
    }

    return await ctx.db.insert("featuredPodcastJobs", {
      featuredDate: args.featuredDate,
      articleId: args.articleId,
      status: args.status,
      attempts: args.attempts,
      lastError: args.lastError,
      createdAt: now,
      updatedAt: now,
    });
  },
});
