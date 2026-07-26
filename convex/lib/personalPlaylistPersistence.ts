import type { Doc, Id } from "../_generated/dataModel";
import type { MutationCtx, QueryCtx } from "../_generated/server";
import type { TtsMetadata } from "../../lib/tts-profile";
import { upsertTtsAudioVariant } from "./ttsAudioVariants";

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
  feedToken: string;
  episodeId: Id<"personalPlaylistEpisodes">;
  status: PersonalPlaylistEpisodeDoc["status"];
  added: boolean;
  shouldSchedule: boolean;
};

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

const getPersonalPlaylistOpenAiQuotaKey = (
  viewerTokenIdentifier: string,
): string => `personal-playlist:openai:daily:${viewerTokenIdentifier}`;

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
    narrationHash: string;
    requestedTtsMetadata?: TtsMetadata;
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
      feedToken: feed.feedToken,
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

  await reservePersonalPlaylistOpenAiGeneration(ctx, {
    viewerTokenIdentifier: args.viewerTokenIdentifier,
    activeEpisodes: await getActiveViewerEpisodes(
      ctx,
      args.viewerTokenIdentifier,
    ),
    increasesActiveCount: true,
    countsTowardDailyLimit: false,
  });

  await ctx.db.patch(args.episodeId, {
    status: "queued",
    stage: "queued",
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
  },
) => {
  const episode = await ctx.db.get(args.episodeId);
  const now = Date.now();
  if (!hasActiveEpisodeLease(episode, args.owner, now)) {
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
  if (!hasActiveEpisodeLease(episode, args.owner, now)) {
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
  if (!hasActiveEpisodeLease(episode, args.owner, now)) {
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
