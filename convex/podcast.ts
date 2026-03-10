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

const podcastShowAssetSlug = v.union(
  v.literal("featured"),
  v.literal("trending"),
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

const withArtworkStorageUrl = async <
  T extends {
    storageId: Id<"_storage">;
  },
>(
  ctx: {
    storage: {
      getUrl(storageId: Id<"_storage">): Promise<string | null>;
    };
  },
  record: T,
) => {
  const artworkUrl = await ctx.storage.getUrl(record.storageId);
  return { ...record, artworkUrl };
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

export const claimFeaturedEpisodeJob = mutation({
  args: {
    featuredDate: v.string(),
    articleId: v.optional(v.id("articles")),
    owner: v.string(),
    leaseMs: v.number(),
  },
  async handler(ctx, args) {
    const existing = await ctx.db
      .query("featuredPodcastJobs")
      .withIndex("by_featuredDate", (q) => q.eq("featuredDate", args.featuredDate))
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
        articleId: args.articleId,
        status: "running",
        attempts,
        lastError: undefined,
        leaseOwner: args.owner,
        leaseExpiresAt,
        updatedAt: now,
      });
      return { claimed: true, attempts };
    }

    await ctx.db.insert("featuredPodcastJobs", {
      featuredDate: args.featuredDate,
      articleId: args.articleId,
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

export const generateUploadUrl = mutation({
  async handler(ctx) {
    return await ctx.storage.generateUploadUrl();
  },
});

export const getPodcastShowAsset = query({
  args: {
    slug: podcastShowAssetSlug,
  },
  async handler(ctx, args) {
    const record = await ctx.db
      .query("podcastShowAssets")
      .withIndex("by_slug", (q) => q.eq("slug", args.slug))
      .first();

    return record ? await withArtworkStorageUrl(ctx, record) : null;
  },
});

export const savePodcastShowAsset = mutation({
  args: {
    slug: podcastShowAssetSlug,
    storageId: v.id("_storage"),
    mimeType: v.string(),
    version: v.number(),
  },
  async handler(ctx, args) {
    const existing = await ctx.db
      .query("podcastShowAssets")
      .withIndex("by_slug", (q) => q.eq("slug", args.slug))
      .first();

    const now = Date.now();
    if (existing) {
      await ctx.db.patch(existing._id, {
        storageId: args.storageId,
        mimeType: args.mimeType,
        version: args.version,
        updatedAt: now,
      });
      return existing._id;
    }

    return await ctx.db.insert("podcastShowAssets", {
      slug: args.slug,
      storageId: args.storageId,
      mimeType: args.mimeType,
      version: args.version,
      createdAt: now,
      updatedAt: now,
    });
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
    artworkStorageId: v.optional(v.id("_storage")),
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
        artworkStorageId: args.artworkStorageId,
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
      artworkStorageId: args.artworkStorageId,
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

export const finalizeFeaturedEpisodeJob = mutation({
  args: {
    featuredDate: v.string(),
    articleId: v.optional(v.id("articles")),
    owner: v.string(),
    status: v.union(v.literal("ready"), v.literal("failed")),
    lastError: v.optional(v.string()),
  },
  async handler(ctx, args) {
    const existing = await ctx.db
      .query("featuredPodcastJobs")
      .withIndex("by_featuredDate", (q) => q.eq("featuredDate", args.featuredDate))
      .first();

    if (!existing || existing.leaseOwner !== args.owner) {
      return { updated: false };
    }

    await ctx.db.patch(existing._id, {
      articleId: args.articleId,
      status: args.status,
      lastError: args.lastError,
      leaseOwner: undefined,
      leaseExpiresAt: undefined,
      updatedAt: Date.now(),
    });

    return { updated: true };
  },
});
