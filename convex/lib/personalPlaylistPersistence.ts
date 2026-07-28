import type { Doc, Id } from "../_generated/dataModel";
import type { MutationCtx, QueryCtx } from "../_generated/server";
import type { TtsMetadata } from "../../lib/tts-profile";
import {
  createPersonalFeedToken,
  isValidPersonalFeedToken,
} from "../../lib/personal-feed-token";
import { getPersonalPlaylistOpenAiQuotaKey } from "./accountQuotaKeys";
import {
  getSupersededTtsAudioStorageIds,
  upsertTtsAudioVariant,
} from "./ttsAudioVariants";
import {
  deleteAccountOwnedStorageForCtx,
  registerAccountOwnedStorageForCtx,
} from "./accountOwnedStorage";
import {
  assertViewerAccountActiveForCtx,
  isViewerAccountDeletionActiveForCtx,
} from "./accountDeletionState";

export type PersonalPlaylistReadCtx = Pick<QueryCtx, "db" | "storage">;
export type PersonalPlaylistMutationCtx = Pick<MutationCtx, "db" | "storage">;

export const PERSONAL_PLAYLIST_LEASE_MS = 8 * 60 * 1000;
const DEFAULT_PERSONAL_PLAYLIST_OPENAI_DAILY_LIMIT = 10;
const DEFAULT_PERSONAL_PLAYLIST_OPENAI_DAILY_WINDOW_MS = 24 * 60 * 60 * 1000;
const DEFAULT_PERSONAL_PLAYLIST_OPENAI_ACTIVE_LIMIT = 5;
export type PersonalPlaylistEpisodeDoc = Omit<
  Doc<"personalPlaylistEpisodes">,
  "_creationTime"
>;
export type PersonalPodcastFeedDoc = Omit<
  Doc<"personalPodcastFeeds">,
  "_creationTime"
>;
export type UpsertViewerPlaylistEpisodeResult = {
  episodeId: Id<"personalPlaylistEpisodes">;
  status: PersonalPlaylistEpisodeDoc["status"];
  added: boolean;
  shouldSchedule: boolean;
};
export type ViewerPersonalFeedState =
  | {
      status: "not_created";
      feedToken: null;
      updatedAt: null;
    }
  | {
      status: "active";
      feedToken: string;
      updatedAt: number;
    }
  | {
      status: "revoked";
      feedToken: null;
      updatedAt: number;
    };
export type PersonalPodcastFeedEpisode = {
  _id: Id<"personalPlaylistEpisodes">;
  wikiPageId: string;
  slug: string;
  title: string;
  description?: string;
  imageUrl?: string;
  publishedAt: number;
  updatedAt: number;
  durationSeconds?: number;
  byteLength?: number;
  sourceRevisionId?: string;
};
export type ViewerPlaylistEpisode = {
  _id: Id<"personalPlaylistEpisodes">;
  slug: string;
  title: string;
  description?: string;
  imageUrl?: string;
  position: number;
  publishedAt: number;
  status: PersonalPlaylistEpisodeDoc["status"];
  stage?: PersonalPlaylistEpisodeDoc["stage"];
  sectionCount?: number;
  completedSectionCount?: number;
  durationSeconds?: number;
  byteLength?: number;
  lastError?: string;
};

const VIEWER_PLAYLIST_FAILURE_MESSAGE =
  "Episode generation failed. Retry when ready.";

const readPositiveInteger = (
  environment: Record<string, string | undefined>,
  name: string,
  fallback: number,
): number => {
  const parsed = Number.parseInt(environment[name] ?? "", 10);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
};

export const getPersonalPlaylistOpenAiQuotaConfig = (
  environment: Record<string, string | undefined> = process.env,
): {
  activeLimit: number;
  dailyLimit: number;
  dailyWindowMs: number;
} => ({
  activeLimit: readPositiveInteger(
    environment,
    "PERSONAL_PLAYLIST_OPENAI_ACTIVE_LIMIT",
    DEFAULT_PERSONAL_PLAYLIST_OPENAI_ACTIVE_LIMIT,
  ),
  dailyLimit: readPositiveInteger(
    environment,
    "PERSONAL_PLAYLIST_OPENAI_DAILY_LIMIT",
    DEFAULT_PERSONAL_PLAYLIST_OPENAI_DAILY_LIMIT,
  ),
  dailyWindowMs: readPositiveInteger(
    environment,
    "PERSONAL_PLAYLIST_OPENAI_DAILY_WINDOW_MS",
    DEFAULT_PERSONAL_PLAYLIST_OPENAI_DAILY_WINDOW_MS,
  ),
});

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
  if (!isValidPersonalFeedToken(feedToken)) {
    return null;
  }

  const feed = await ctx.db
    .query("personalPodcastFeeds")
    .withIndex("by_feedToken", (q) => q.eq("feedToken", feedToken))
    .first();

  return feed?.revokedAt == null ? feed : null;
};

export const getReadyPersonalPodcastEpisodeForFeed = async (
  ctx: PersonalPlaylistReadCtx,
  feed: PersonalPodcastFeedDoc,
  episodeIdValue: string,
): Promise<PersonalPlaylistEpisodeDoc | null> => {
  const episodeId = ctx.db.normalizeId(
    "personalPlaylistEpisodes",
    episodeIdValue,
  );
  if (!episodeId) {
    return null;
  }

  const episode = await ctx.db.get(episodeId);
  return episode &&
    episode.viewerTokenIdentifier === feed.viewerTokenIdentifier &&
    episode.removedAt == null &&
    episode.status === "ready" &&
    episode.storageId
    ? episode
    : null;
};

export const getViewerPersonalFeedState = (
  feed: PersonalPodcastFeedDoc | null,
): ViewerPersonalFeedState =>
  feed
    ? feed.revokedAt == null
      ? {
          status: "active",
          feedToken: feed.feedToken,
          updatedAt: feed.updatedAt,
        }
      : {
          status: "revoked",
          feedToken: null,
          updatedAt: feed.revokedAt,
        }
    : {
        status: "not_created",
        feedToken: null,
        updatedAt: null,
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

const reservePersonalPlaylistOpenAiGeneration = async (
  ctx: PersonalPlaylistMutationCtx,
  args: {
    viewerTokenIdentifier: string;
    activeEpisodes: PersonalPlaylistEpisodeDoc[];
    increasesActiveCount: boolean;
    countsTowardDailyLimit: boolean;
  },
): Promise<void> => {
  const config = getPersonalPlaylistOpenAiQuotaConfig();
  const activeGenerationCount = args.activeEpisodes.filter(
    (episode) => episode.status === "queued" || episode.status === "running",
  ).length;
  if (
    args.increasesActiveCount &&
    activeGenerationCount >= config.activeLimit
  ) {
    throw new Error(
      "Personal Playlist queue is full. Wait for an episode to finish before adding another.",
    );
  }

  if (!args.countsTowardDailyLimit) {
    return;
  }

  const now = Date.now();
  const quotaKey = getPersonalPlaylistOpenAiQuotaKey(
    args.viewerTokenIdentifier,
  );
  const existingQuota = await ctx.db
    .query("routeQuotas")
    .withIndex("by_key", (q) => q.eq("key", quotaKey))
    .first();
  const isNewWindow = !existingQuota || existingQuota.expiresAt <= now;

  if (!isNewWindow && existingQuota.count >= config.dailyLimit) {
    throw new Error(
      `Personal Playlist generation limit reached. Try again after ${new Date(
        existingQuota.expiresAt,
      ).toISOString()}.`,
    );
  }

  const quotaPayload = {
    key: quotaKey,
    count: isNewWindow ? 1 : existingQuota.count + 1,
    windowStart: isNewWindow ? now : existingQuota.windowStart,
    expiresAt: isNewWindow
      ? now + config.dailyWindowMs
      : existingQuota.expiresAt,
    updatedAt: now,
  };
  if (existingQuota) {
    await ctx.db.patch(existingQuota._id, quotaPayload);
  } else {
    await ctx.db.insert("routeQuotas", {
      ...quotaPayload,
      createdAt: now,
    });
  }
};

const rewriteActiveViewerQueue = async (
  ctx: PersonalPlaylistMutationCtx,
  episodes: PersonalPlaylistEpisodeDoc[],
  baseTimestamp = Date.now(),
) => {
  const orderedEpisodes = episodes.filter(
    (episode) => episode.removedAt == null,
  );

  for (let index = 0; index < orderedEpisodes.length; index += 1) {
    const episode = orderedEpisodes[index];
    await ctx.db.patch(episode._id, {
      position: index,
      publishedAt: buildPublishedAt(baseTimestamp, index),
      updatedAt: baseTimestamp,
    });
  }
};

const deleteSupersededEpisodeAudioForCtx = async (
  ctx: PersonalPlaylistMutationCtx,
  episode: PersonalPlaylistEpisodeDoc,
  next?: {
    primaryStorageId?: Id<"_storage">;
    audioVariants?: PersonalPlaylistEpisodeDoc["audioVariants"];
  },
): Promise<void> => {
  const supersededStorageIds = getSupersededTtsAudioStorageIds({
    previousPrimaryStorageId: episode.storageId,
    previousVariants: episode.audioVariants,
    nextPrimaryStorageId: next?.primaryStorageId,
    nextVariants: next?.audioVariants,
  });

  for (const storageId of supersededStorageIds) {
    await deleteAccountOwnedStorageForCtx(
      ctx,
      storageId,
      episode.viewerTokenIdentifier,
    );
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
      q
        .eq("viewerTokenIdentifier", viewerTokenIdentifier)
        .eq("articleId", articleId),
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
  const feedToken = createPersonalFeedToken();
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

export const rotateViewerPersonalPodcastFeedForCtx = async (
  ctx: PersonalPlaylistMutationCtx,
  viewerTokenIdentifier: string,
): Promise<ViewerPersonalFeedState> => {
  const existing = await getViewerFeedRecord(ctx, viewerTokenIdentifier);
  const now = Date.now();
  const feedToken = createPersonalFeedToken();

  if (existing) {
    await ctx.db.patch(existing._id, {
      feedToken,
      revokedAt: undefined,
      updatedAt: now,
    });
  } else {
    await ctx.db.insert("personalPodcastFeeds", {
      viewerTokenIdentifier,
      feedToken,
      createdAt: now,
      updatedAt: now,
    });
  }

  return {
    status: "active",
    feedToken,
    updatedAt: now,
  };
};

export const revokeViewerPersonalPodcastFeedForCtx = async (
  ctx: PersonalPlaylistMutationCtx,
  viewerTokenIdentifier: string,
): Promise<ViewerPersonalFeedState> => {
  const existing = await getViewerFeedRecord(ctx, viewerTokenIdentifier);
  if (!existing) {
    return getViewerPersonalFeedState(null);
  }
  if (existing.revokedAt != null) {
    return getViewerPersonalFeedState(existing);
  }

  const revokedAt = Date.now();
  const tombstoneToken = createPersonalFeedToken();
  await ctx.db.patch(existing._id, {
    feedToken: tombstoneToken,
    revokedAt,
    updatedAt: revokedAt,
  });

  return {
    status: "revoked",
    feedToken: null,
    updatedAt: revokedAt,
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
    narrationHash: string;
    requestedTtsMetadata?: TtsMetadata;
  },
): Promise<UpsertViewerPlaylistEpisodeResult> => {
  await assertViewerAccountActiveForCtx(ctx, args.viewerTokenIdentifier);
  const now = Date.now();
  await ensureViewerPersonalPodcastFeedForCtx(ctx, args.viewerTokenIdentifier);
  const existing = await findViewerEpisodeByArticle(
    ctx,
    args.viewerTokenIdentifier,
    args.articleId,
    args.slug,
  );
  const activeEpisodes = await getActiveViewerEpisodes(
    ctx,
    args.viewerTokenIdentifier,
  );

  if (existing && existing.removedAt == null) {
    const narrationChanged = existing.narrationHash !== args.narrationHash;
    const reactivatesGeneration =
      narrationChanged &&
      existing.status !== "queued" &&
      existing.status !== "running";
    if (narrationChanged) {
      await reservePersonalPlaylistOpenAiGeneration(ctx, {
        viewerTokenIdentifier: args.viewerTokenIdentifier,
        activeEpisodes,
        increasesActiveCount: reactivatesGeneration,
        countsTowardDailyLimit: reactivatesGeneration && args.sectionCount > 0,
      });
      await deleteSupersededEpisodeAudioForCtx(ctx, existing);
    }
    await ctx.db.patch(existing._id, {
      articleId: args.articleId,
      wikiPageId: args.wikiPageId,
      slug: args.slug,
      title: args.title,
      description: args.description,
      imageUrl: args.imageUrl,
      sectionCount: args.sectionCount,
      narrationHash: args.narrationHash,
      ...(narrationChanged
        ? {
            ...(args.requestedTtsMetadata
              ? { requestedTtsMetadata: args.requestedTtsMetadata }
              : {}),
            status: "queued" as const,
            stage: "queued" as const,
            ...(reactivatesGeneration ? { generationRetryCount: 0 } : {}),
            completedSectionCount: 0,
            storageId: undefined,
            durationSeconds: undefined,
            byteLength: undefined,
            audioVariants: undefined,
            lastError: undefined,
            leaseOwner: undefined,
            leaseExpiresAt: undefined,
          }
        : {}),
      updatedAt: now,
    });

    return {
      episodeId: existing._id,
      status: narrationChanged ? "queued" : existing.status,
      added: false,
      shouldSchedule: narrationChanged,
    };
  }

  if (existing) {
    await reservePersonalPlaylistOpenAiGeneration(ctx, {
      viewerTokenIdentifier: args.viewerTokenIdentifier,
      activeEpisodes,
      increasesActiveCount: true,
      countsTowardDailyLimit: args.sectionCount > 0,
    });
    await deleteSupersededEpisodeAudioForCtx(ctx, existing);
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
      generationRetryCount: 0,
      sectionCount: args.sectionCount,
      narrationHash: args.narrationHash,
      ...(args.requestedTtsMetadata
        ? { requestedTtsMetadata: args.requestedTtsMetadata }
        : {}),
      completedSectionCount: 0,
      storageId: undefined,
      durationSeconds: undefined,
      byteLength: undefined,
      audioVariants: undefined,
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
        generationRetryCount: 0,
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
      episodeId: existing._id,
      status: "queued",
      added: true,
      shouldSchedule: true,
    };
  }

  await reservePersonalPlaylistOpenAiGeneration(ctx, {
    viewerTokenIdentifier: args.viewerTokenIdentifier,
    activeEpisodes,
    increasesActiveCount: true,
    countsTowardDailyLimit: args.sectionCount > 0,
  });
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
    generationRetryCount: 0,
    sectionCount: args.sectionCount,
    narrationHash: args.narrationHash,
    requestedTtsMetadata: args.requestedTtsMetadata,
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
        narrationHash: args.narrationHash,
        requestedTtsMetadata: args.requestedTtsMetadata,
        completedSectionCount: 0,
        createdAt: now,
        updatedAt: now,
      },
    ],
    now,
  );

  return {
    episodeId,
    status: "queued" as const,
    added: true,
    shouldSchedule: true,
  };
};

export const listViewerPlaylistEpisodesForCtx = async (
  ctx: PersonalPlaylistReadCtx,
  viewerTokenIdentifier: string,
): Promise<ViewerPlaylistEpisode[]> => {
  const episodes = await getActiveViewerEpisodes(ctx, viewerTokenIdentifier);
  return episodes.map((episode) => ({
    _id: episode._id,
    slug: episode.slug,
    title: episode.title,
    ...(episode.description !== undefined
      ? { description: episode.description }
      : {}),
    ...(episode.imageUrl !== undefined ? { imageUrl: episode.imageUrl } : {}),
    position: episode.position,
    publishedAt: episode.publishedAt,
    status: episode.status,
    ...(episode.stage !== undefined ? { stage: episode.stage } : {}),
    ...(episode.sectionCount !== undefined
      ? { sectionCount: episode.sectionCount }
      : {}),
    ...(episode.completedSectionCount !== undefined
      ? { completedSectionCount: episode.completedSectionCount }
      : {}),
    ...(episode.durationSeconds !== undefined
      ? { durationSeconds: episode.durationSeconds }
      : {}),
    ...(episode.byteLength !== undefined
      ? { byteLength: episode.byteLength }
      : {}),
    ...(episode.status === "failed"
      ? { lastError: VIEWER_PLAYLIST_FAILURE_MESSAGE }
      : {}),
  }));
};

export const listViewerPodcastFeedEpisodesForCtx = async (
  ctx: PersonalPlaylistReadCtx,
  viewerTokenIdentifier: string,
): Promise<PersonalPodcastFeedEpisode[]> => {
  const readyEpisodes = (
    await getActiveViewerEpisodes(ctx, viewerTokenIdentifier)
  ).filter((episode) => episode.status === "ready");

  return await Promise.all(
    readyEpisodes.map(async (episode) => {
      const article = await ctx.db.get(episode.articleId);
      return {
        _id: episode._id,
        wikiPageId: episode.wikiPageId,
        slug: episode.slug,
        title: episode.title,
        ...(episode.description == null
          ? {}
          : { description: episode.description }),
        ...(episode.imageUrl == null ? {} : { imageUrl: episode.imageUrl }),
        publishedAt: episode.publishedAt,
        updatedAt: episode.updatedAt,
        ...(episode.durationSeconds == null
          ? {}
          : { durationSeconds: episode.durationSeconds }),
        ...(episode.byteLength == null
          ? {}
          : { byteLength: episode.byteLength }),
        ...(article?.revisionId == null
          ? {}
          : { sourceRevisionId: article.revisionId }),
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

  const episodes = await getActiveViewerEpisodes(
    ctx,
    args.viewerTokenIdentifier,
  );
  const currentIndex = episodes.findIndex(
    (episode) => episode._id === args.episodeId,
  );
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

  const activeEpisodes = (
    await getActiveViewerEpisodes(ctx, args.viewerTokenIdentifier)
  ).filter((candidate) => candidate._id !== args.episodeId);
  await rewriteActiveViewerQueue(ctx, activeEpisodes, now);

  return { removed: true };
};

export const retryViewerPlaylistEpisodeForCtx = async (
  ctx: PersonalPlaylistMutationCtx,
  args: {
    viewerTokenIdentifier: string;
    episodeId: Id<"personalPlaylistEpisodes">;
    requestedTtsMetadata?: TtsMetadata;
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

  const generationRetryCount = episode.generationRetryCount ?? 0;

  await reservePersonalPlaylistOpenAiGeneration(ctx, {
    viewerTokenIdentifier: args.viewerTokenIdentifier,
    activeEpisodes: await getActiveViewerEpisodes(
      ctx,
      args.viewerTokenIdentifier,
    ),
    increasesActiveCount: true,
    // Preserve one unmetered retry per generation. Later retries consume
    // allowance unless the episode is known to have no narratable tracks.
    countsTowardDailyLimit:
      generationRetryCount > 0 && episode.sectionCount !== 0,
  });

  await ctx.db.patch(args.episodeId, {
    status: "queued",
    stage: "queued",
    generationRetryCount: generationRetryCount + 1,
    completedSectionCount: 0,
    ...(args.requestedTtsMetadata
      ? { requestedTtsMetadata: args.requestedTtsMetadata }
      : {}),
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
  if (
    await isViewerAccountDeletionActiveForCtx(ctx, args.viewerTokenIdentifier)
  ) {
    return null;
  }
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

const hasActiveEpisodeLease = (
  episode: PersonalPlaylistEpisodeDoc | null,
  owner: string,
  now: number,
): episode is PersonalPlaylistEpisodeDoc =>
  Boolean(
    episode &&
    episode.removedAt == null &&
    episode.status === "running" &&
    episode.leaseOwner === owner &&
    (episode.leaseExpiresAt ?? 0) > now,
  );

export const markViewerPlaylistEpisodeRunningForCtx = async (
  ctx: PersonalPlaylistMutationCtx,
  args: {
    episodeId: Id<"personalPlaylistEpisodes">;
    owner: string;
  },
) => {
  const episode = await ctx.db.get(args.episodeId);
  if (!episode || episode.removedAt != null) {
    return { claimed: false, viewerTokenIdentifier: null };
  }
  if (
    await isViewerAccountDeletionActiveForCtx(
      ctx,
      episode.viewerTokenIdentifier,
    )
  ) {
    return { claimed: false, viewerTokenIdentifier: null };
  }

  const now = Date.now();
  const isExpiredRunningEpisode =
    episode.status === "running" && (episode.leaseExpiresAt ?? 0) <= now;
  if (episode.status !== "queued" && !isExpiredRunningEpisode) {
    return {
      claimed: false,
      viewerTokenIdentifier:
        episode.status === "running" ? episode.viewerTokenIdentifier : null,
    };
  }

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
    narrationHash: string;
    viewerTokenIdentifier?: string;
  },
) => {
  const episode = await ctx.db.get(args.episodeId);
  const now = Date.now();
  if (episode?.status === "ready" && episode.storageId === args.storageId) {
    const registration = await registerAccountOwnedStorageForCtx(ctx, {
      viewerTokenIdentifier: episode.viewerTokenIdentifier,
      storageId: args.storageId,
      kind: "personal_playlist_episode",
      parentId: String(episode._id),
    });
    if (!registration.registered) {
      return { completed: false };
    }
    return { completed: true };
  }
  if (
    !hasActiveEpisodeLease(episode, args.owner, now) ||
    (episode &&
      (await isViewerAccountDeletionActiveForCtx(
        ctx,
        episode.viewerTokenIdentifier,
      )))
  ) {
    await deleteAccountOwnedStorageForCtx(
      ctx,
      args.storageId,
      episode?.viewerTokenIdentifier ?? args.viewerTokenIdentifier,
    );
    return { completed: false };
  }

  const registration = await registerAccountOwnedStorageForCtx(ctx, {
    viewerTokenIdentifier: episode.viewerTokenIdentifier,
    storageId: args.storageId,
    kind: "personal_playlist_episode",
    parentId: String(episode._id),
  });
  if (!registration.registered) {
    return { completed: false };
  }

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

  await deleteSupersededEpisodeAudioForCtx(ctx, episode, {
    primaryStorageId: args.storageId,
    audioVariants,
  });
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
    narrationHash: args.narrationHash,
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
  const now = Date.now();
  if (
    !hasActiveEpisodeLease(episode, args.owner, now) ||
    (episode &&
      (await isViewerAccountDeletionActiveForCtx(
        ctx,
        episode.viewerTokenIdentifier,
      )))
  ) {
    return { failed: false };
  }

  await ctx.db.patch(args.episodeId, {
    status: "failed",
    stage: undefined,
    lastError: args.lastError,
    leaseOwner: undefined,
    leaseExpiresAt: undefined,
    updatedAt: now,
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
  const now = Date.now();
  if (
    !hasActiveEpisodeLease(episode, args.owner, now) ||
    (episode &&
      (await isViewerAccountDeletionActiveForCtx(
        ctx,
        episode.viewerTokenIdentifier,
      )))
  ) {
    return { updated: false };
  }

  await ctx.db.patch(args.episodeId, {
    stage: args.stage,
    sectionCount: args.sectionCount,
    completedSectionCount: args.completedSectionCount,
    leaseExpiresAt: now + PERSONAL_PLAYLIST_LEASE_MS,
    updatedAt: now,
  });

  return { updated: true };
};
