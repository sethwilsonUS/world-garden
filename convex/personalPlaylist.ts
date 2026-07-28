import {
  action,
  internalAction,
  internalMutation,
  internalQuery,
  mutation,
  query,
} from "./_generated/server";
import { api, internal } from "./_generated/api";
import { v } from "convex/values";
import { getAuthenticatedViewerTokenIdentifier } from "./bookmarks";
import {
  getArticleAudioSections,
  type ArticleAudioSource,
} from "./lib/articleAudioPipeline";
import { processViewerPlaylistEpisodeForCtx } from "./lib/personalPlaylistWorker";
import { buildArticleNarrationHash } from "../lib/section-narration";
import { isTtsMetadataValid, type TtsMetadata } from "../lib/tts-profile";
import { verifyPersonalFeedMediaReadAttestation } from "../lib/personal-feed-media-attestation";
import {
  assertViewerAccountActiveForCtx,
  isViewerAccountDeletionActiveForCtx,
} from "./lib/accountDeletionState";
import {
  deleteAccountOwnedStorageForCtx,
  registerAccountOwnedStorageForCtx,
} from "./lib/accountOwnedStorage";
import {
  completeViewerPlaylistEpisodeForCtx,
  ensureViewerPersonalPodcastFeedForCtx,
  failViewerPlaylistEpisodeForCtx,
  getNextQueuedEpisodeForViewerForCtx,
  getReadyPersonalPodcastEpisodeForFeed,
  getViewerFeedRecord,
  getViewerFeedRecordByToken,
  getViewerPersonalFeedState,
  listViewerPodcastFeedEpisodesForCtx,
  listViewerPlaylistEpisodesForCtx,
  markViewerPlaylistEpisodeRunningForCtx,
  moveViewerPlaylistEpisodeForCtx,
  removeViewerPlaylistEpisodeForCtx,
  retryViewerPlaylistEpisodeForCtx,
  revokeViewerPersonalPodcastFeedForCtx,
  rotateViewerPersonalPodcastFeedForCtx,
  updateViewerPlaylistEpisodeProgressForCtx,
  upsertViewerPlaylistEpisodeForCtx,
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
const ttsMetadataValidator = v.object({
  provider: v.union(v.literal("openai"), v.literal("edge")),
  model: v.string(),
  voiceId: v.string(),
  promptVersion: v.string(),
  ttsNormVersion: v.string(),
  ttsCacheKey: v.string(),
});
const serverAttestationValidator = v.object({
  issuedAt: v.number(),
  expiresAt: v.number(),
  nonce: v.string(),
  signature: v.string(),
});

const assertRequestedTtsMetadataValid = (
  metadata: TtsMetadata | undefined,
): void => {
  if (metadata && !isTtsMetadataValid(metadata)) {
    throw new Error("Invalid TTS profile identity.");
  }
  if (metadata && metadata.provider !== "openai") {
    throw new Error(
      "Personal Playlist requires an OpenAI TTS profile identity.",
    );
  }
};

export const getViewerFeedState = query({
  args: {},
  async handler(ctx) {
    const viewerTokenIdentifier =
      await getAuthenticatedViewerTokenIdentifier(ctx);
    const feed = await getViewerFeedRecord(ctx, viewerTokenIdentifier);
    return getViewerPersonalFeedState(feed);
  },
});

export const rotateViewerFeedToken = mutation({
  args: {},
  async handler(ctx) {
    const viewerTokenIdentifier =
      await getAuthenticatedViewerTokenIdentifier(ctx);
    return await rotateViewerPersonalPodcastFeedForCtx(
      ctx,
      viewerTokenIdentifier,
    );
  },
});

export const revokeViewerFeedToken = mutation({
  args: {},
  async handler(ctx) {
    const viewerTokenIdentifier =
      await getAuthenticatedViewerTokenIdentifier(ctx);
    return await revokeViewerPersonalPodcastFeedForCtx(
      ctx,
      viewerTokenIdentifier,
    );
  },
});

export const listViewerPlaylistEpisodes = query({
  args: {},
  async handler(ctx) {
    const viewerTokenIdentifier =
      await getAuthenticatedViewerTokenIdentifier(ctx);
    return await listViewerPlaylistEpisodesForCtx(ctx, viewerTokenIdentifier);
  },
});

export const addViewerPlaylistEpisodeBySlug = action({
  args: {
    slug: v.string(),
    ttsMetadata: v.optional(ttsMetadataValidator),
    // Accepted only so stale pre-deploy clients continue to validate. The
    // server deliberately ignores it and owns the worker origin.
    baseUrl: v.optional(v.string()),
  },
  async handler(ctx, args): Promise<UpsertViewerPlaylistEpisodeResult> {
    void args.baseUrl;
    const identity = await ctx.auth.getUserIdentity();
    if (!identity) {
      throw new Error("Unauthorized");
    }
    assertRequestedTtsMetadataValid(args.ttsMetadata);

    const viewerTokenIdentifier = identity.tokenIdentifier;
    await ctx.runQuery(
      internal.personalPlaylist.assertViewerPlaylistAccountActiveInternal,
      { viewerTokenIdentifier },
    );
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
        narrationHash: buildArticleNarrationHash(article),
        requestedTtsMetadata: args.ttsMetadata,
      },
    );

    if (result.shouldSchedule) {
      await ctx.scheduler.runAfter(
        0,
        internal.personalPlaylist.processViewerPlaylistEpisode,
        {
          episodeId: result.episodeId,
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
    const viewerTokenIdentifier =
      await getAuthenticatedViewerTokenIdentifier(ctx);
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
    const viewerTokenIdentifier =
      await getAuthenticatedViewerTokenIdentifier(ctx);
    return await removeViewerPlaylistEpisodeForCtx(ctx, {
      viewerTokenIdentifier,
      episodeId: args.episodeId,
    });
  },
});

export const retryViewerPlaylistEpisode = mutation({
  args: {
    episodeId: v.id("personalPlaylistEpisodes"),
    ttsMetadata: v.optional(ttsMetadataValidator),
    // Accepted only so stale pre-deploy clients continue to validate. The
    // server deliberately ignores it and owns the worker origin.
    baseUrl: v.optional(v.string()),
  },
  async handler(ctx, args) {
    void args.baseUrl;
    const viewerTokenIdentifier =
      await getAuthenticatedViewerTokenIdentifier(ctx);
    assertRequestedTtsMetadataValid(args.ttsMetadata);
    const result = await retryViewerPlaylistEpisodeForCtx(ctx, {
      viewerTokenIdentifier,
      episodeId: args.episodeId,
      requestedTtsMetadata: args.ttsMetadata,
    });

    if (!result.queued) {
      return result;
    }

    await ctx.scheduler.runAfter(
      0,
      internal.personalPlaylist.processViewerPlaylistEpisode,
      {
        episodeId: args.episodeId,
      },
    );

    return result;
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
    if (
      await isViewerAccountDeletionActiveForCtx(ctx, feed.viewerTokenIdentifier)
    ) {
      return null;
    }

    const episodes = await listViewerPodcastFeedEpisodesForCtx(
      ctx,
      feed.viewerTokenIdentifier,
    );

    return {
      feed: { updatedAt: feed.updatedAt },
      episodes,
    };
  },
});

export const getEpisodeForPersonalFeedServer = mutation({
  args: {
    feedToken: v.string(),
    episodeId: v.string(),
    attestation: serverAttestationValidator,
  },
  async handler(ctx, args) {
    const validAttestation = await verifyPersonalFeedMediaReadAttestation({
      feedToken: args.feedToken,
      episodeId: args.episodeId,
      attestation: args.attestation,
    });
    if (!validAttestation) {
      throw new Error(
        "A valid server attestation is required to read personal feed media.",
      );
    }

    const feed = await getViewerFeedRecordByToken(ctx, args.feedToken);
    if (!feed) {
      return null;
    }
    if (
      await isViewerAccountDeletionActiveForCtx(ctx, feed.viewerTokenIdentifier)
    ) {
      return null;
    }
    const episode = await getReadyPersonalPodcastEpisodeForFeed(
      ctx,
      feed,
      args.episodeId,
    );
    if (!episode?.storageId) {
      return null;
    }
    const audioUrl = await ctx.storage.getUrl(episode.storageId);
    return audioUrl ? { title: episode.title, audioUrl } : null;
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
    narrationHash: v.string(),
    requestedTtsMetadata: v.optional(ttsMetadataValidator),
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
    return (await ctx.db.get(
      args.episodeId,
    )) as PersonalPlaylistEpisodeDoc | null;
  },
});

export const assertViewerPlaylistAccountActiveInternal = internalQuery({
  args: {
    viewerTokenIdentifier: v.string(),
  },
  async handler(ctx, args) {
    await assertViewerAccountActiveForCtx(ctx, args.viewerTokenIdentifier);
    return { active: true as const };
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
    narrationHash: v.string(),
    viewerTokenIdentifier: v.optional(v.string()),
  },
  async handler(ctx, args) {
    return await completeViewerPlaylistEpisodeForCtx(ctx, args);
  },
});

export const registerViewerPlaylistEpisodeStorageInternal = internalMutation({
  args: {
    episodeId: v.id("personalPlaylistEpisodes"),
    viewerTokenIdentifier: v.string(),
    owner: v.string(),
    storageId: v.id("_storage"),
  },
  async handler(ctx, args) {
    const episode = await ctx.db.get(args.episodeId);
    const now = Date.now();
    if (
      !episode ||
      episode.removedAt != null ||
      episode.viewerTokenIdentifier !== args.viewerTokenIdentifier ||
      episode.status !== "running" ||
      episode.leaseOwner !== args.owner ||
      (episode.leaseExpiresAt ?? 0) <= now
    ) {
      if (episode?.storageId !== args.storageId) {
        await deleteAccountOwnedStorageForCtx(
          ctx,
          args.storageId,
          args.viewerTokenIdentifier,
        );
      }
      return { registered: false };
    }

    return await registerAccountOwnedStorageForCtx(ctx, {
      viewerTokenIdentifier: args.viewerTokenIdentifier,
      storageId: args.storageId,
      kind: "personal_playlist_episode",
      parentId: String(args.episodeId),
    });
  },
});

export const discardViewerPlaylistEpisodeStorageInternal = internalMutation({
  args: {
    episodeId: v.id("personalPlaylistEpisodes"),
    viewerTokenIdentifier: v.string(),
    storageId: v.id("_storage"),
  },
  async handler(ctx, args) {
    const episode = await ctx.db.get(args.episodeId);
    if (
      episode &&
      episode.viewerTokenIdentifier !== args.viewerTokenIdentifier
    ) {
      return { discarded: false, referenced: false };
    }
    if (episode?.storageId === args.storageId) {
      return { discarded: false, referenced: true };
    }

    await deleteAccountOwnedStorageForCtx(
      ctx,
      args.storageId,
      args.viewerTokenIdentifier,
    );
    return { discarded: true, referenced: false };
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
    // Accepted only so already-scheduled pre-deploy jobs still validate. The
    // worker deliberately ignores it and resolves a server-owned origin.
    baseUrl: v.optional(v.string()),
  },
  async handler(ctx, args) {
    await processViewerPlaylistEpisodeForCtx(ctx, {
      episodeId: args.episodeId,
    });
  },
});
