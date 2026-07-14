import { action, internalAction, internalMutation, internalQuery, mutation, query } from "./_generated/server";
import { api, internal } from "./_generated/api";
import { v } from "convex/values";
import { getAuthenticatedViewerTokenIdentifier } from "./bookmarks";
import { getArticleAudioSections, type ArticleAudioSource } from "./lib/articleAudioPipeline";
import { processViewerPlaylistEpisodeForCtx } from "./lib/personalPlaylistWorker";
import {
  completeViewerPlaylistEpisodeForCtx,
  ensureViewerPersonalPodcastFeedForCtx,
  failViewerPlaylistEpisodeForCtx,
  getNextQueuedEpisodeForViewerForCtx,
  getViewerFeedRecord,
  getViewerFeedRecordByToken,
  listViewerPlaylistEpisodesForCtx,
  markViewerPlaylistEpisodeRunningForCtx,
  moveViewerPlaylistEpisodeForCtx,
  removeViewerPlaylistEpisodeForCtx,
  retryViewerPlaylistEpisodeForCtx,
  updateViewerPlaylistEpisodeProgressForCtx,
  upsertViewerPlaylistEpisodeForCtx,
  withStorageUrl,
  type PersonalPlaylistEpisodeDoc,
  type UpsertViewerPlaylistEpisodeResult,
} from "./lib/personalPlaylistPersistence";

export {
  ensureViewerPersonalPodcastFeedForCtx,
  listViewerPlaylistEpisodesForCtx,
  moveViewerPlaylistEpisodeForCtx,
  removeViewerPlaylistEpisodeForCtx,
  upsertViewerPlaylistEpisodeForCtx,
};

const moveDirectionValidator = v.union(v.literal("up"), v.literal("down"));

export const getViewerFeedToken = query({
  args: {},
  async handler(ctx) {
    const viewerTokenIdentifier = await getAuthenticatedViewerTokenIdentifier(ctx);
    const feed = await getViewerFeedRecord(ctx, viewerTokenIdentifier);
    return feed?.feedToken ?? null;
  },
});

export const listViewerPlaylistEpisodes = query({
  args: {},
  async handler(ctx) {
    const viewerTokenIdentifier = await getAuthenticatedViewerTokenIdentifier(ctx);
    return await listViewerPlaylistEpisodesForCtx(ctx, viewerTokenIdentifier);
  },
});

export const addViewerPlaylistEpisodeBySlug = action({
  args: {
    slug: v.string(),
    baseUrl: v.string(),
  },
  async handler(
    ctx,
    args,
  ): Promise<UpsertViewerPlaylistEpisodeResult> {
    const identity = await ctx.auth.getUserIdentity();
    if (!identity) {
      throw new Error("Unauthorized");
    }

    const viewerTokenIdentifier = identity.tokenIdentifier;
    const article = (await ctx.runAction(api.articles.fetchAndCacheBySlug, {
      slug: args.slug,
    })) as ArticleAudioSource & {
      wikiPageId: string;
      summary?: string;
      thumbnailUrl?: string;
    };

    const result: UpsertViewerPlaylistEpisodeResult = await ctx.runMutation(
      internal.personalPlaylist.upsertViewerPlaylistEpisodeInternal,
      {
        viewerTokenIdentifier,
        articleId: article._id,
        wikiPageId: article.wikiPageId,
        slug: article.slug ?? args.slug,
        title: article.title,
        description: article.summary,
        imageUrl: article.thumbnailUrl,
        sectionCount: getArticleAudioSections(article).length,
      },
    );

    if (result.shouldSchedule) {
      await ctx.scheduler.runAfter(
        0,
        internal.personalPlaylist.processViewerPlaylistEpisode,
        {
          episodeId: result.episodeId,
          baseUrl: args.baseUrl,
        },
      );
    }

    return result;
  },
});

export const moveViewerPlaylistEpisode = mutation({
  args: {
    episodeId: v.id("personalPlaylistEpisodes"),
    direction: moveDirectionValidator,
  },
  async handler(ctx, args) {
    const viewerTokenIdentifier = await getAuthenticatedViewerTokenIdentifier(ctx);
    return await moveViewerPlaylistEpisodeForCtx(ctx, {
      viewerTokenIdentifier,
      episodeId: args.episodeId,
      direction: args.direction,
    });
  },
});

export const removeViewerPlaylistEpisode = mutation({
  args: {
    episodeId: v.id("personalPlaylistEpisodes"),
  },
  async handler(ctx, args) {
    const viewerTokenIdentifier = await getAuthenticatedViewerTokenIdentifier(ctx);
    return await removeViewerPlaylistEpisodeForCtx(ctx, {
      viewerTokenIdentifier,
      episodeId: args.episodeId,
    });
  },
});

export const retryViewerPlaylistEpisode = mutation({
  args: {
    episodeId: v.id("personalPlaylistEpisodes"),
    baseUrl: v.string(),
  },
  async handler(ctx, args) {
    const viewerTokenIdentifier = await getAuthenticatedViewerTokenIdentifier(ctx);
    const result = await retryViewerPlaylistEpisodeForCtx(ctx, {
      viewerTokenIdentifier,
      episodeId: args.episodeId,
    });

    if (!result.queued) {
      return result;
    }

    await ctx.scheduler.runAfter(
      0,
      internal.personalPlaylist.processViewerPlaylistEpisode,
      {
        episodeId: args.episodeId,
        baseUrl: args.baseUrl,
      },
    );

    return result;
  },
});

export const getFeedByToken = query({
  args: {
    feedToken: v.string(),
  },
  async handler(ctx, args) {
    return await getViewerFeedRecordByToken(ctx, args.feedToken);
  },
});

export const getFeedEpisodesByToken = query({
  args: {
    feedToken: v.string(),
  },
  async handler(ctx, args) {
    const feed = await getViewerFeedRecordByToken(ctx, args.feedToken);
    if (!feed) {
      return null;
    }

    const episodes = (await listViewerPlaylistEpisodesForCtx(
      ctx,
      feed.viewerTokenIdentifier,
    )).filter((episode) => episode.status === "ready");

    return {
      feed,
      episodes,
    };
  },
});

export const getEpisodeByTokenAndId = query({
  args: {
    feedToken: v.string(),
    episodeId: v.id("personalPlaylistEpisodes"),
  },
  async handler(ctx, args) {
    const [feed, episode] = await Promise.all([
      getViewerFeedRecordByToken(ctx, args.feedToken),
      ctx.db.get(args.episodeId),
    ]);

    if (
      !feed ||
      !episode ||
      episode.viewerTokenIdentifier !== feed.viewerTokenIdentifier ||
      episode.removedAt != null
    ) {
      return null;
    }

    return await withStorageUrl(ctx, episode);
  },
});

export const upsertViewerPlaylistEpisodeInternal = internalMutation({
  args: {
    viewerTokenIdentifier: v.string(),
    articleId: v.id("articles"),
    wikiPageId: v.string(),
    slug: v.string(),
    title: v.string(),
    description: v.optional(v.string()),
    imageUrl: v.optional(v.string()),
    sectionCount: v.number(),
  },
  async handler(ctx, args) {
    return await upsertViewerPlaylistEpisodeForCtx(ctx, args);
  },
});

export const getPersonalPlaylistEpisodeInternal = internalQuery({
  args: {
    episodeId: v.id("personalPlaylistEpisodes"),
  },
  async handler(ctx, args) {
    return (await ctx.db.get(args.episodeId)) as PersonalPlaylistEpisodeDoc | null;
  },
});

export const getPersonalPlaylistArticleInternal = internalQuery({
  args: {
    articleId: v.id("articles"),
  },
  async handler(ctx, args) {
    return (await ctx.db.get(args.articleId)) as ArticleAudioSource | null;
  },
});

export const getNextQueuedEpisodeForViewerInternal = internalQuery({
  args: {
    viewerTokenIdentifier: v.string(),
    excludeEpisodeId: v.optional(v.id("personalPlaylistEpisodes")),
  },
  async handler(ctx, args) {
    return await getNextQueuedEpisodeForViewerForCtx(ctx, args);
  },
});

export const markViewerPlaylistEpisodeRunningInternal = internalMutation({
  args: {
    episodeId: v.id("personalPlaylistEpisodes"),
    owner: v.string(),
  },
  async handler(ctx, args) {
    return await markViewerPlaylistEpisodeRunningForCtx(ctx, args);
  },
});

export const completeViewerPlaylistEpisodeInternal = internalMutation({
  args: {
    episodeId: v.id("personalPlaylistEpisodes"),
    owner: v.string(),
    storageId: v.id("_storage"),
    durationSeconds: v.number(),
    byteLength: v.number(),
    ttsCacheKey: v.string(),
    provider: v.string(),
    model: v.string(),
    voiceId: v.string(),
    promptVersion: v.string(),
    ttsNormVersion: v.string(),
  },
  async handler(ctx, args) {
    return await completeViewerPlaylistEpisodeForCtx(ctx, args);
  },
});

export const failViewerPlaylistEpisodeInternal = internalMutation({
  args: {
    episodeId: v.id("personalPlaylistEpisodes"),
    owner: v.string(),
    lastError: v.string(),
  },
  async handler(ctx, args) {
    return await failViewerPlaylistEpisodeForCtx(ctx, args);
  },
});

export const updateViewerPlaylistEpisodeProgressInternal = internalMutation({
  args: {
    episodeId: v.id("personalPlaylistEpisodes"),
    owner: v.string(),
    completedSectionCount: v.number(),
    sectionCount: v.number(),
    stage: v.union(
      v.literal("queued"),
      v.literal("rendering_audio"),
      v.literal("packaging"),
    ),
  },
  async handler(ctx, args) {
    return await updateViewerPlaylistEpisodeProgressForCtx(ctx, args);
  },
});

export const processViewerPlaylistEpisode = internalAction({
  args: {
    episodeId: v.id("personalPlaylistEpisodes"),
    baseUrl: v.string(),
  },
  async handler(ctx, args) {
    await processViewerPlaylistEpisodeForCtx(ctx, args);
  },
});
