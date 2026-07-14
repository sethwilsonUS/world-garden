import type { Doc, Id } from "../_generated/dataModel";
import type { MutationCtx, QueryCtx } from "../_generated/server";
import { upsertTtsAudioVariant } from "./ttsAudioVariants";

export type PersonalPlaylistReadCtx = Pick<QueryCtx, "db" | "storage">;
export type PersonalPlaylistMutationCtx = Pick<
  MutationCtx,
  "db" | "storage"
>;

const PERSONAL_PLAYLIST_LEASE_MS = 8 * 60 * 1000;
export type PersonalPlaylistEpisodeDoc = Omit<
  Doc<"personalPlaylistEpisodes">,
  "_creationTime"
>;
export type PersonalPodcastFeedDoc = Omit<
  Doc<"personalPodcastFeeds">,
  "_creationTime"
>;
export type UpsertViewerPlaylistEpisodeResult = {
  feedToken: string;
  episodeId: Id<"personalPlaylistEpisodes">;
  status: PersonalPlaylistEpisodeDoc["status"];
  added: boolean;
  shouldSchedule: boolean;
};

const createFeedToken = (): string =>
  `${crypto.randomUUID().replace(/-/g, "")}${crypto.randomUUID().replace(/-/g, "")}`;

const buildPublishedAt = (baseTimestamp: number, position: number): number =>
  baseTimestamp - position * 60_000;

export const withStorageUrl = async <
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

export const getViewerFeedRecord = async (
  ctx: PersonalPlaylistReadCtx,
  viewerTokenIdentifier: string,
): Promise<PersonalPodcastFeedDoc | null> => {
  return await ctx.db
    .query("personalPodcastFeeds")
    .withIndex("by_viewerTokenIdentifier", (q) =>
      q.eq("viewerTokenIdentifier", viewerTokenIdentifier),
    )
    .first();
};

export const getViewerFeedRecordByToken = async (
  ctx: PersonalPlaylistReadCtx,
  feedToken: string,
): Promise<PersonalPodcastFeedDoc | null> => {
  return await ctx.db
    .query("personalPodcastFeeds")
    .withIndex("by_feedToken", (q) => q.eq("feedToken", feedToken))
    .first();
};

const getViewerEpisodes = async (
  ctx: PersonalPlaylistReadCtx,
  viewerTokenIdentifier: string,
): Promise<PersonalPlaylistEpisodeDoc[]> => {
  const records = await ctx.db
    .query("personalPlaylistEpisodes")
    .withIndex("by_viewerTokenIdentifier", (q) =>
      q.eq("viewerTokenIdentifier", viewerTokenIdentifier),
    )
    .collect();

  return sortEpisodesByQueue(records);
};

const getActiveViewerEpisodes = async (
  ctx: PersonalPlaylistReadCtx,
  viewerTokenIdentifier: string,
): Promise<PersonalPlaylistEpisodeDoc[]> =>
  (await getViewerEpisodes(ctx, viewerTokenIdentifier)).filter(
    (episode) => episode.removedAt == null,
  );

const rewriteActiveViewerQueue = async (
  ctx: PersonalPlaylistMutationCtx,
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
  ctx: PersonalPlaylistReadCtx,
  viewerTokenIdentifier: string,
  articleId: Id<"articles">,
  slug: string,
): Promise<PersonalPlaylistEpisodeDoc | null> => {
  const byArticleId = await ctx.db
    .query("personalPlaylistEpisodes")
    .withIndex("by_viewerTokenIdentifier_articleId", (q) =>
      q.eq("viewerTokenIdentifier", viewerTokenIdentifier).eq("articleId", articleId),
    )
    .collect();

  const existingByArticleId = sortEpisodesByQueue(byArticleId)[0];
  if (existingByArticleId) {
    return existingByArticleId;
  }

  const bySlug = await ctx.db
    .query("personalPlaylistEpisodes")
    .withIndex("by_viewerTokenIdentifier_slug", (q) =>
      q.eq("viewerTokenIdentifier", viewerTokenIdentifier).eq("slug", slug),
    )
    .collect();

  return sortEpisodesByQueue(bySlug)[0] ?? null;
};

export const ensureViewerPersonalPodcastFeedForCtx = async (
  ctx: PersonalPlaylistMutationCtx,
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
  ctx: PersonalPlaylistMutationCtx,
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
  ctx: PersonalPlaylistReadCtx,
  viewerTokenIdentifier: string,
) => {
  const episodes = await getActiveViewerEpisodes(ctx, viewerTokenIdentifier);
  return await Promise.all(
    episodes.map(async (episode) => {
      const [episodeWithUrl, article] = await Promise.all([
        withStorageUrl(ctx, episode),
        ctx.db.get(episode.articleId),
      ]);
      return {
        ...episodeWithUrl,
        sourceRevisionId: article?.revisionId,
      };
    }),
  );
};

export const moveViewerPlaylistEpisodeForCtx = async (
  ctx: PersonalPlaylistMutationCtx,
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

export const removeViewerPlaylistEpisodeForCtx = async (
  ctx: PersonalPlaylistMutationCtx,
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


export const retryViewerPlaylistEpisodeForCtx = async (
  ctx: PersonalPlaylistMutationCtx,
  args: {
    viewerTokenIdentifier: string;
    episodeId: Id<"personalPlaylistEpisodes">;
  },
) => {
  const episode = await ctx.db.get(args.episodeId);

  if (
    !episode ||
    episode.viewerTokenIdentifier !== args.viewerTokenIdentifier ||
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

  return { queued: true };
};

export const getNextQueuedEpisodeForViewerForCtx = async (
  ctx: PersonalPlaylistReadCtx,
  args: {
    viewerTokenIdentifier: string;
    excludeEpisodeId?: Id<"personalPlaylistEpisodes">;
  },
): Promise<PersonalPlaylistEpisodeDoc | null> => {
  const episodes = await getActiveViewerEpisodes(
    ctx,
    args.viewerTokenIdentifier,
  );
  return (
    episodes.find(
      (episode) =>
        episode._id !== args.excludeEpisodeId && episode.status === "queued",
    ) ?? null
  );
};

export const markViewerPlaylistEpisodeRunningForCtx = async (
  ctx: PersonalPlaylistMutationCtx,
  args: {
    episodeId: Id<"personalPlaylistEpisodes">;
    owner: string;
  },
) => {
  const episode = await ctx.db.get(args.episodeId);
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
    return {
      claimed: false,
      viewerTokenIdentifier: episode.viewerTokenIdentifier,
    };
  }

  await ctx.db.patch(args.episodeId, {
    status: "running",
    stage: "rendering_audio",
    lastError: undefined,
    leaseOwner: args.owner,
    leaseExpiresAt: now + PERSONAL_PLAYLIST_LEASE_MS,
    updatedAt: now,
  });

  return {
    claimed: true,
    viewerTokenIdentifier: episode.viewerTokenIdentifier,
  };
};

export const completeViewerPlaylistEpisodeForCtx = async (
  ctx: PersonalPlaylistMutationCtx,
  args: {
    episodeId: Id<"personalPlaylistEpisodes">;
    owner: string;
    storageId: Id<"_storage">;
    durationSeconds: number;
    byteLength: number;
    ttsCacheKey: string;
    provider: string;
    model: string;
    voiceId: string;
    promptVersion: string;
    ttsNormVersion: string;
  },
) => {
  const episode = await ctx.db.get(args.episodeId);
  if (!episode || episode.leaseOwner !== args.owner) {
    return { completed: false };
  }

  const now = Date.now();
  const audioVariants = upsertTtsAudioVariant(
    episode.audioVariants,
    {
      storageId: args.storageId,
      durationSeconds: args.durationSeconds,
      byteLength: args.byteLength,
      ttsCacheKey: args.ttsCacheKey,
      provider: args.provider,
      model: args.model,
      voiceId: args.voiceId,
      promptVersion: args.promptVersion,
      ttsNormVersion: args.ttsNormVersion,
    },
    now,
  );

  await ctx.db.patch(args.episodeId, {
    status: "ready",
    stage: undefined,
    storageId: args.storageId,
    durationSeconds: args.durationSeconds,
    byteLength: args.byteLength,
    ttsCacheKey: args.ttsCacheKey,
    provider: args.provider,
    model: args.model,
    voiceId: args.voiceId,
    promptVersion: args.promptVersion,
    ttsNormVersion: args.ttsNormVersion,
    audioVariants,
    lastError: undefined,
    completedSectionCount:
      episode.sectionCount ?? episode.completedSectionCount ?? 0,
    leaseOwner: undefined,
    leaseExpiresAt: undefined,
    updatedAt: now,
  });

  return { completed: true };
};

export const failViewerPlaylistEpisodeForCtx = async (
  ctx: PersonalPlaylistMutationCtx,
  args: {
    episodeId: Id<"personalPlaylistEpisodes">;
    owner: string;
    lastError: string;
  },
) => {
  const episode = await ctx.db.get(args.episodeId);
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
};

export const updateViewerPlaylistEpisodeProgressForCtx = async (
  ctx: PersonalPlaylistMutationCtx,
  args: {
    episodeId: Id<"personalPlaylistEpisodes">;
    owner: string;
    completedSectionCount: number;
    sectionCount: number;
    stage: PersonalPlaylistEpisodeDoc["stage"];
  },
) => {
  const episode = await ctx.db.get(args.episodeId);
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
};
