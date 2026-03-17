/* eslint-disable @typescript-eslint/no-explicit-any */
import { action, internalAction, internalMutation, internalQuery, mutation, query } from "./_generated/server";
import { api, internal } from "./_generated/api";
import { type Id } from "./_generated/dataModel";
import { v } from "convex/values";
import { getAuthenticatedViewerTokenIdentifier } from "./bookmarks";
import { assembleArticleAudio, getArticleAudioSections, type ArticleAudioSource } from "./lib/articleAudioPipeline";
import { uploadBlobToConvexStorage, uploadStreamToConvexStorage } from "./lib/storageUpload";
import { TTS_NORM_VERSION } from "../lib/tts-normalize";

const PERSONAL_PLAYLIST_LEASE_MS = 8 * 60 * 1000;
const PERSONAL_PODCAST_ALBUM_TITLE = "Curio Garden Personal Playlist";

type PersonalPlaylistEpisodeStatus = "queued" | "running" | "ready" | "failed";
type PersonalPlaylistEpisodeStage = "queued" | "rendering_audio" | "packaging";

type PersonalPlaylistEpisodeDoc = {
  _id: Id<"personalPlaylistEpisodes">;
  viewerTokenIdentifier: string;
  articleId: Id<"articles">;
  wikiPageId: string;
  slug: string;
  title: string;
  description?: string;
  imageUrl?: string;
  position: number;
  publishedAt: number;
  removedAt?: number;
  status: PersonalPlaylistEpisodeStatus;
  stage?: PersonalPlaylistEpisodeStage;
  sectionCount?: number;
  completedSectionCount?: number;
  storageId?: Id<"_storage">;
  durationSeconds?: number;
  byteLength?: number;
  lastError?: string;
  leaseOwner?: string;
  leaseExpiresAt?: number;
  createdAt: number;
  updatedAt: number;
};

type PersonalPodcastFeedDoc = {
  _id: Id<"personalPodcastFeeds">;
  viewerTokenIdentifier: string;
  feedToken: string;
  createdAt: number;
  updatedAt: number;
};

type UpsertViewerPlaylistEpisodeResult = {
  feedToken: string;
  episodeId: Id<"personalPlaylistEpisodes">;
  status: PersonalPlaylistEpisodeStatus;
  added: boolean;
  shouldSchedule: boolean;
};

const moveDirectionValidator = v.union(v.literal("up"), v.literal("down"));

const createFeedToken = (): string =>
  `${crypto.randomUUID().replace(/-/g, "")}${crypto.randomUUID().replace(/-/g, "")}`;

const buildPublishedAt = (baseTimestamp: number, position: number): number =>
  baseTimestamp - position * 60_000;

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

const sortEpisodesByQueue = (
  episodes: PersonalPlaylistEpisodeDoc[],
): PersonalPlaylistEpisodeDoc[] =>
  [...episodes].sort(
    (left, right) =>
      left.position - right.position ||
      right.publishedAt - left.publishedAt ||
      left.createdAt - right.createdAt,
  );

const getViewerFeedRecord = async (
  ctx: any,
  viewerTokenIdentifier: string,
): Promise<PersonalPodcastFeedDoc | null> => {
  return await ctx.db
    .query("personalPodcastFeeds")
    .withIndex("by_viewerTokenIdentifier", (q: any) =>
      q.eq("viewerTokenIdentifier", viewerTokenIdentifier),
    )
    .first();
};

const getViewerFeedRecordByToken = async (
  ctx: any,
  feedToken: string,
): Promise<PersonalPodcastFeedDoc | null> => {
  return await ctx.db
    .query("personalPodcastFeeds")
    .withIndex("by_feedToken", (q: any) => q.eq("feedToken", feedToken))
    .first();
};

const getViewerEpisodes = async (
  ctx: any,
  viewerTokenIdentifier: string,
): Promise<PersonalPlaylistEpisodeDoc[]> => {
  const records = await ctx.db
    .query("personalPlaylistEpisodes")
    .withIndex("by_viewerTokenIdentifier", (q: any) =>
      q.eq("viewerTokenIdentifier", viewerTokenIdentifier),
    )
    .collect();

  return sortEpisodesByQueue(records);
};

const getActiveViewerEpisodes = async (
  ctx: any,
  viewerTokenIdentifier: string,
): Promise<PersonalPlaylistEpisodeDoc[]> =>
  (await getViewerEpisodes(ctx, viewerTokenIdentifier)).filter(
    (episode) => episode.removedAt == null,
  );

const rewriteActiveViewerQueue = async (
  ctx: any,
  episodes: PersonalPlaylistEpisodeDoc[],
  baseTimestamp = Date.now(),
) => {
  const orderedEpisodes = episodes.filter((episode) => episode.removedAt == null);

  for (let index = 0; index < orderedEpisodes.length; index += 1) {
    const episode = orderedEpisodes[index];
    await ctx.db.patch(episode._id, {
      position: index,
      publishedAt: buildPublishedAt(baseTimestamp, index),
      updatedAt: baseTimestamp,
    });
  }
};

const findViewerEpisodeByArticle = async (
  ctx: any,
  viewerTokenIdentifier: string,
  articleId: Id<"articles">,
  slug: string,
): Promise<PersonalPlaylistEpisodeDoc | null> => {
  const byArticleId = await ctx.db
    .query("personalPlaylistEpisodes")
    .withIndex("by_viewerTokenIdentifier_articleId", (q: any) =>
      q.eq("viewerTokenIdentifier", viewerTokenIdentifier).eq("articleId", articleId),
    )
    .collect();

  const existingByArticleId = sortEpisodesByQueue(byArticleId)[0];
  if (existingByArticleId) {
    return existingByArticleId;
  }

  const bySlug = await ctx.db
    .query("personalPlaylistEpisodes")
    .withIndex("by_viewerTokenIdentifier_slug", (q: any) =>
      q.eq("viewerTokenIdentifier", viewerTokenIdentifier).eq("slug", slug),
    )
    .collect();

  return sortEpisodesByQueue(bySlug)[0] ?? null;
};

export const ensureViewerPersonalPodcastFeedForCtx = async (
  ctx: any,
  viewerTokenIdentifier: string,
): Promise<PersonalPodcastFeedDoc> => {
  const existing = await getViewerFeedRecord(ctx, viewerTokenIdentifier);
  if (existing) {
    return existing;
  }

  const now = Date.now();
  const feedToken = createFeedToken();
  const feedId = await ctx.db.insert("personalPodcastFeeds", {
    viewerTokenIdentifier,
    feedToken,
    createdAt: now,
    updatedAt: now,
  });

  return {
    _id: feedId,
    viewerTokenIdentifier,
    feedToken,
    createdAt: now,
    updatedAt: now,
  };
};

export const upsertViewerPlaylistEpisodeForCtx = async (
  ctx: any,
  args: {
    viewerTokenIdentifier: string;
    articleId: Id<"articles">;
    wikiPageId: string;
    slug: string;
    title: string;
    description?: string;
    imageUrl?: string;
    sectionCount: number;
  },
): Promise<UpsertViewerPlaylistEpisodeResult> => {
  const now = Date.now();
  const feed = await ensureViewerPersonalPodcastFeedForCtx(
    ctx,
    args.viewerTokenIdentifier,
  );
  const existing = await findViewerEpisodeByArticle(
    ctx,
    args.viewerTokenIdentifier,
    args.articleId,
    args.slug,
  );
  const activeEpisodes = await getActiveViewerEpisodes(ctx, args.viewerTokenIdentifier);

  if (existing && existing.removedAt == null) {
    await ctx.db.patch(existing._id, {
      articleId: args.articleId,
      wikiPageId: args.wikiPageId,
      slug: args.slug,
      title: args.title,
      description: args.description,
      imageUrl: args.imageUrl,
      sectionCount: args.sectionCount,
      updatedAt: now,
    });

    return {
      feedToken: feed.feedToken,
      episodeId: existing._id,
      status: existing.status,
      added: false,
      shouldSchedule: false,
    };
  }

  if (existing) {
    await ctx.db.patch(existing._id, {
      articleId: args.articleId,
      wikiPageId: args.wikiPageId,
      slug: args.slug,
      title: args.title,
      description: args.description,
      imageUrl: args.imageUrl,
      removedAt: undefined,
      position: activeEpisodes.length,
      status: "queued",
      stage: "queued",
      sectionCount: args.sectionCount,
      completedSectionCount: 0,
      storageId: undefined,
      durationSeconds: undefined,
      byteLength: undefined,
      lastError: undefined,
      leaseOwner: undefined,
      leaseExpiresAt: undefined,
      updatedAt: now,
    });

    const refreshedEpisodes = [
      ...activeEpisodes,
      {
        ...existing,
        ...args,
        removedAt: undefined,
        position: activeEpisodes.length,
        status: "queued" as const,
        stage: "queued" as const,
        sectionCount: args.sectionCount,
        completedSectionCount: 0,
        storageId: undefined,
        durationSeconds: undefined,
        byteLength: undefined,
        lastError: undefined,
        leaseOwner: undefined,
        leaseExpiresAt: undefined,
        updatedAt: now,
      },
    ];
    await rewriteActiveViewerQueue(ctx, refreshedEpisodes, now);

    return {
      feedToken: feed.feedToken,
      episodeId: existing._id,
      status: "queued",
      added: true,
      shouldSchedule: true,
    };
  }

  const episodeId = await ctx.db.insert("personalPlaylistEpisodes", {
    viewerTokenIdentifier: args.viewerTokenIdentifier,
    articleId: args.articleId,
    wikiPageId: args.wikiPageId,
    slug: args.slug,
    title: args.title,
    description: args.description,
    imageUrl: args.imageUrl,
    position: activeEpisodes.length,
    publishedAt: buildPublishedAt(now, activeEpisodes.length),
    status: "queued",
    stage: "queued",
    sectionCount: args.sectionCount,
    completedSectionCount: 0,
    createdAt: now,
    updatedAt: now,
  });

  await rewriteActiveViewerQueue(
    ctx,
    [
      ...activeEpisodes,
      {
        _id: episodeId,
        viewerTokenIdentifier: args.viewerTokenIdentifier,
        articleId: args.articleId,
        wikiPageId: args.wikiPageId,
        slug: args.slug,
        title: args.title,
        description: args.description,
        imageUrl: args.imageUrl,
        position: activeEpisodes.length,
        publishedAt: buildPublishedAt(now, activeEpisodes.length),
        status: "queued",
        stage: "queued" as const,
        sectionCount: args.sectionCount,
        completedSectionCount: 0,
        createdAt: now,
        updatedAt: now,
      },
    ],
    now,
  );

  return {
    feedToken: feed.feedToken,
    episodeId,
    status: "queued" as const,
    added: true,
    shouldSchedule: true,
  };
};

export const listViewerPlaylistEpisodesForCtx = async (
  ctx: any,
  viewerTokenIdentifier: string,
) => {
  const episodes = await getActiveViewerEpisodes(ctx, viewerTokenIdentifier);
  return await Promise.all(episodes.map((episode) => withStorageUrl(ctx, episode)));
};

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

export const moveViewerPlaylistEpisodeForCtx = async (
  ctx: any,
  args: {
    viewerTokenIdentifier: string;
    episodeId: Id<"personalPlaylistEpisodes">;
    direction: "up" | "down";
  },
) => {
  const targetEpisode = await ctx.db.get(args.episodeId);
  if (
    !targetEpisode ||
    targetEpisode.viewerTokenIdentifier !== args.viewerTokenIdentifier ||
    targetEpisode.removedAt != null
  ) {
    return { moved: false, position: null };
  }

  const episodes = await getActiveViewerEpisodes(ctx, args.viewerTokenIdentifier);
  const currentIndex = episodes.findIndex((episode) => episode._id === args.episodeId);
  if (currentIndex === -1) {
    return { moved: false, position: null };
  }

  const nextIndex =
    args.direction === "up" ? currentIndex - 1 : currentIndex + 1;
  if (nextIndex < 0 || nextIndex >= episodes.length) {
    return { moved: false, position: currentIndex };
  }

  const reorderedEpisodes = [...episodes];
  const [movedEpisode] = reorderedEpisodes.splice(currentIndex, 1);
  reorderedEpisodes.splice(nextIndex, 0, movedEpisode);

  await rewriteActiveViewerQueue(ctx, reorderedEpisodes, Date.now());
  return { moved: true, position: nextIndex };
};

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

export const removeViewerPlaylistEpisodeForCtx = async (
  ctx: any,
  args: {
    viewerTokenIdentifier: string;
    episodeId: Id<"personalPlaylistEpisodes">;
  },
) => {
  const episode = await ctx.db.get(args.episodeId);
  if (
    !episode ||
    episode.viewerTokenIdentifier !== args.viewerTokenIdentifier ||
    episode.removedAt != null
  ) {
    return { removed: false };
  }

  const now = Date.now();
  await ctx.db.patch(args.episodeId, {
    removedAt: now,
    updatedAt: now,
  });

  const activeEpisodes = (await getActiveViewerEpisodes(ctx, args.viewerTokenIdentifier)).filter(
    (candidate) => candidate._id !== args.episodeId,
  );
  await rewriteActiveViewerQueue(ctx, activeEpisodes, now);

  return { removed: true };
};

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
    const episode = await ctx.db.get(args.episodeId);

    if (
      !episode ||
      episode.viewerTokenIdentifier !== viewerTokenIdentifier ||
      episode.removedAt != null ||
      episode.status !== "failed"
    ) {
      return { queued: false };
    }

    await ctx.db.patch(args.episodeId, {
      status: "queued",
      stage: "queued",
      completedSectionCount: 0,
      lastError: undefined,
      leaseOwner: undefined,
      leaseExpiresAt: undefined,
      updatedAt: Date.now(),
    });

    await ctx.scheduler.runAfter(
      0,
      internal.personalPlaylist.processViewerPlaylistEpisode,
      {
        episodeId: args.episodeId,
        baseUrl: args.baseUrl,
      },
    );

    return { queued: true };
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
    const episodes = await getActiveViewerEpisodes(ctx, args.viewerTokenIdentifier);
    return (
      episodes.find(
        (episode) =>
          episode._id !== args.excludeEpisodeId && episode.status === "queued",
      ) ?? null
    );
  },
});

export const markViewerPlaylistEpisodeRunningInternal = internalMutation({
  args: {
    episodeId: v.id("personalPlaylistEpisodes"),
    owner: v.string(),
  },
  async handler(ctx, args) {
    const episode = (await ctx.db.get(args.episodeId)) as PersonalPlaylistEpisodeDoc | null;
    if (!episode || episode.removedAt != null || episode.status !== "queued") {
      return { claimed: false, viewerTokenIdentifier: null };
    }

    const now = Date.now();
    const viewerEpisodes = await getActiveViewerEpisodes(
      ctx,
      episode.viewerTokenIdentifier,
    );
    const otherRunningEpisode = viewerEpisodes.find(
      (candidate) =>
        candidate._id !== args.episodeId &&
        candidate.status === "running" &&
        (candidate.leaseExpiresAt ?? 0) > now,
    );

    if (otherRunningEpisode) {
      return { claimed: false, viewerTokenIdentifier: episode.viewerTokenIdentifier };
    }

    await ctx.db.patch(args.episodeId, {
      status: "running",
      stage: "rendering_audio",
      lastError: undefined,
      leaseOwner: args.owner,
      leaseExpiresAt: now + PERSONAL_PLAYLIST_LEASE_MS,
      updatedAt: now,
    });

    return { claimed: true, viewerTokenIdentifier: episode.viewerTokenIdentifier };
  },
});

export const completeViewerPlaylistEpisodeInternal = internalMutation({
  args: {
    episodeId: v.id("personalPlaylistEpisodes"),
    owner: v.string(),
    storageId: v.id("_storage"),
    durationSeconds: v.number(),
    byteLength: v.number(),
  },
  async handler(ctx, args) {
    const episode = (await ctx.db.get(args.episodeId)) as PersonalPlaylistEpisodeDoc | null;
    if (!episode || episode.leaseOwner !== args.owner) {
      return { completed: false };
    }

    await ctx.db.patch(args.episodeId, {
      status: "ready",
      stage: undefined,
      storageId: args.storageId,
      durationSeconds: args.durationSeconds,
      byteLength: args.byteLength,
      lastError: undefined,
      completedSectionCount:
        episode.sectionCount ?? episode.completedSectionCount ?? 0,
      leaseOwner: undefined,
      leaseExpiresAt: undefined,
      updatedAt: Date.now(),
    });

    return { completed: true };
  },
});

export const failViewerPlaylistEpisodeInternal = internalMutation({
  args: {
    episodeId: v.id("personalPlaylistEpisodes"),
    owner: v.string(),
    lastError: v.string(),
  },
  async handler(ctx, args) {
    const episode = (await ctx.db.get(args.episodeId)) as PersonalPlaylistEpisodeDoc | null;
    if (!episode || episode.leaseOwner !== args.owner) {
      return { failed: false };
    }

    await ctx.db.patch(args.episodeId, {
      status: "failed",
      stage: undefined,
      lastError: args.lastError,
      leaseOwner: undefined,
      leaseExpiresAt: undefined,
      updatedAt: Date.now(),
    });

    return { failed: true };
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
    const episode = (await ctx.db.get(args.episodeId)) as PersonalPlaylistEpisodeDoc | null;
    if (!episode || episode.leaseOwner !== args.owner) {
      return { updated: false };
    }

    await ctx.db.patch(args.episodeId, {
      stage: args.stage,
      sectionCount: args.sectionCount,
      completedSectionCount: args.completedSectionCount,
      updatedAt: Date.now(),
    });

    return { updated: true };
  },
});

export const processViewerPlaylistEpisode = internalAction({
  args: {
    episodeId: v.id("personalPlaylistEpisodes"),
    baseUrl: v.string(),
  },
  async handler(ctx, args) {
    const episode = await ctx.runQuery(
      internal.personalPlaylist.getPersonalPlaylistEpisodeInternal,
      {
        episodeId: args.episodeId,
      },
    );

    if (!episode || episode.removedAt != null || episode.status === "ready") {
      return;
    }

    const owner = crypto.randomUUID();
    const claim = await ctx.runMutation(
      internal.personalPlaylist.markViewerPlaylistEpisodeRunningInternal,
      {
        episodeId: args.episodeId,
        owner,
      },
    );

    if (!claim.claimed || !claim.viewerTokenIdentifier) {
      return;
    }

    const scheduleNextQueuedEpisode = async () => {
      const nextQueuedEpisode = await ctx.runQuery(
        internal.personalPlaylist.getNextQueuedEpisodeForViewerInternal,
        {
          viewerTokenIdentifier: claim.viewerTokenIdentifier!,
          excludeEpisodeId: args.episodeId,
        },
      );

      if (!nextQueuedEpisode) {
        return;
      }

      await ctx.scheduler.runAfter(
        0,
        internal.personalPlaylist.processViewerPlaylistEpisode,
        {
          episodeId: nextQueuedEpisode._id,
          baseUrl: args.baseUrl,
        },
      );
    };

    const article = await ctx.runQuery(
      internal.personalPlaylist.getPersonalPlaylistArticleInternal,
      {
        articleId: episode.articleId,
      },
    );

    if (!article) {
      await ctx.runMutation(internal.personalPlaylist.failViewerPlaylistEpisodeInternal, {
        episodeId: args.episodeId,
        owner,
        lastError: "Article not found.",
      });
      await scheduleNextQueuedEpisode();
      return;
    }

    const sections = getArticleAudioSections(article);
    if (sections.length === 0) {
      await ctx.runMutation(internal.personalPlaylist.failViewerPlaylistEpisodeInternal, {
        episodeId: args.episodeId,
        owner,
        lastError: "Article does not contain any audio-suitable sections.",
      });
      await scheduleNextQueuedEpisode();
      return;
    }

    await ctx.runMutation(
      internal.personalPlaylist.updateViewerPlaylistEpisodeProgressInternal,
      {
        episodeId: args.episodeId,
        owner,
        completedSectionCount: 0,
        sectionCount: sections.length,
        stage: "rendering_audio",
      },
    );

    try {
      const result = await assembleArticleAudio({
        article: {
          ...article,
          slug: article.slug ?? episode.slug,
        },
        albumTitle: PERSONAL_PODCAST_ALBUM_TITLE,
        baseUrl: args.baseUrl,
        getCachedSectionAudioUrls: async () => {
          const cachedAudio = await ctx.runQuery(api.audio.getAllSectionAudio, {
            articleId: article._id,
            ttsNormVersion: TTS_NORM_VERSION,
          });
          return cachedAudio.urls;
        },
        saveSectionAudio: async ({ sectionKey, blob, durationSeconds }) => {
          const uploadUrl = await ctx.runMutation(api.audio.generateUploadUrl, {});
          const storageId = await uploadBlobToConvexStorage(uploadUrl, blob);
          await ctx.runMutation(api.audio.saveSectionAudioRecord, {
            articleId: article._id,
            sectionKey,
            storageId,
            ttsNormVersion: TTS_NORM_VERSION,
            durationSeconds,
          });
          const storageUrl = await ctx.storage.getUrl(storageId);
          if (!storageUrl) {
            throw new Error("Stored section audio URL could not be resolved.");
          }
          return storageUrl;
        },
        saveCombinedAudio: async ({ stream, contentType }) => {
          const uploadUrl = await ctx.runMutation(api.audio.generateUploadUrl, {});
          return await uploadStreamToConvexStorage(uploadUrl, stream, contentType);
        },
        onProgress: async ({ completedSectionCount, sectionCount, stage }) => {
          await ctx.runMutation(
            internal.personalPlaylist.updateViewerPlaylistEpisodeProgressInternal,
            {
              episodeId: args.episodeId,
              owner,
              completedSectionCount,
              sectionCount,
              stage,
            },
          );
        },
      });
      await ctx.runMutation(
        internal.personalPlaylist.completeViewerPlaylistEpisodeInternal,
        {
          episodeId: args.episodeId,
          owner,
          storageId: result.storageId,
          durationSeconds: result.durationSeconds,
          byteLength: result.byteLength,
        },
      );
    } catch (error) {
      await ctx.runMutation(internal.personalPlaylist.failViewerPlaylistEpisodeInternal, {
        episodeId: args.episodeId,
        owner,
        lastError:
          error instanceof Error
            ? error.message
            : "Personal playlist episode generation failed.",
      });
    }

    await scheduleNextQueuedEpisode();
  },
});
