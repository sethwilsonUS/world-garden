import type { Id } from "../_generated/dataModel";
import type { ActionCtx } from "../_generated/server";
import { api, internal } from "../_generated/api";
import {
  assembleArticleAudio,
  getArticleAudioSections,
} from "./articleAudioPipeline";
import {
  uploadBlobToConvexStorage,
  uploadStreamToConvexStorage,
} from "./storageUpload";
import { PERSONAL_PLAYLIST_LEASE_MS } from "./personalPlaylistPersistence";
import { TTS_NORM_VERSION } from "../../lib/tts-normalize";

const PERSONAL_PODCAST_ALBUM_TITLE = "Curio Garden Personal Playlist";

export const processViewerPlaylistEpisodeForCtx = async (
  ctx: ActionCtx,
  args: {
    episodeId: Id<"personalPlaylistEpisodes">;
    baseUrl: string;
  },
) => {
  const episode = await ctx.runQuery(
    internal.personalPlaylist.getPersonalPlaylistEpisodeInternal,
    {
      episodeId: args.episodeId,
    },
  );

  if (!episode || episode.removedAt != null || episode.status === "ready") {
    return;
  }

  const scheduleCurrentEpisodeAfterLease = async () => {
    await ctx.scheduler.runAfter(
      PERSONAL_PLAYLIST_LEASE_MS,
      internal.personalPlaylist.processViewerPlaylistEpisode,
      args,
    );
  };

  const owner = crypto.randomUUID();
  const claim = await ctx.runMutation(
    internal.personalPlaylist.markViewerPlaylistEpisodeRunningInternal,
    {
      episodeId: args.episodeId,
      owner,
    },
  );

  if (!claim.claimed || !claim.viewerTokenIdentifier) {
    if (claim.viewerTokenIdentifier) {
      await scheduleCurrentEpisodeAfterLease();
    }
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

  let shouldRetryCurrentAfterLease = false;
  try {
    const article = await ctx.runQuery(
      internal.personalPlaylist.getPersonalPlaylistArticleInternal,
      {
        articleId: episode.articleId,
      },
    );

    if (!article) {
      throw new Error("Article not found.");
    }

    const sections = getArticleAudioSections(article);
    if (sections.length === 0) {
      throw new Error("Article does not contain any audio-suitable sections.");
    }

    const initialProgress = await ctx.runMutation(
      internal.personalPlaylist.updateViewerPlaylistEpisodeProgressInternal,
      {
        episodeId: args.episodeId,
        owner,
        completedSectionCount: 0,
        sectionCount: sections.length,
        stage: "rendering_audio",
      },
    );
    if (!initialProgress.updated) {
      throw new Error("Personal playlist episode lease was lost.");
    }

    const result = await assembleArticleAudio({
      article: {
        ...article,
        slug: article.slug ?? episode.slug,
      },
      albumTitle: PERSONAL_PODCAST_ALBUM_TITLE,
      baseUrl: args.baseUrl,
      getCachedSectionAudioUrls: async ({ ttsCacheKey }) => {
        const cachedAudio = await ctx.runQuery(api.audio.getAllSectionAudio, {
          articleId: article._id,
          ttsNormVersion: TTS_NORM_VERSION,
          ttsCacheKey,
        });
        return cachedAudio.urls;
      },
      saveSectionAudio: async ({ sectionKey, blob, durationSeconds, metadata }) => {
        const uploadUrl = await ctx.runMutation(api.audio.generateUploadUrl, {});
        const storageId = await uploadBlobToConvexStorage(uploadUrl, blob);
        await ctx.runMutation(api.audio.saveSectionAudioRecord, {
          articleId: article._id,
          sectionKey,
          storageId,
          ttsNormVersion: metadata.ttsNormVersion,
          ttsCacheKey: metadata.ttsCacheKey,
          provider: metadata.provider,
          model: metadata.model,
          voiceId: metadata.voiceId,
          promptVersion: metadata.promptVersion,
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
        const progress = await ctx.runMutation(
          internal.personalPlaylist.updateViewerPlaylistEpisodeProgressInternal,
          {
            episodeId: args.episodeId,
            owner,
            completedSectionCount,
            sectionCount,
            stage,
          },
        );
        if (!progress.updated) {
          throw new Error("Personal playlist episode lease was lost.");
        }
      },
    });
    const completion = await ctx.runMutation(
      internal.personalPlaylist.completeViewerPlaylistEpisodeInternal,
      {
        episodeId: args.episodeId,
        owner,
        storageId: result.storageId,
        durationSeconds: result.durationSeconds,
        byteLength: result.byteLength,
        ttsCacheKey: result.metadata.ttsCacheKey,
        provider: result.metadata.provider,
        model: result.metadata.model,
        voiceId: result.metadata.voiceId,
        promptVersion: result.metadata.promptVersion,
        ttsNormVersion: result.metadata.ttsNormVersion,
      },
    );
    shouldRetryCurrentAfterLease = !completion.completed;
  } catch (error) {
    try {
      const failure = await ctx.runMutation(
        internal.personalPlaylist.failViewerPlaylistEpisodeInternal,
        {
          episodeId: args.episodeId,
          owner,
          lastError:
            error instanceof Error
              ? error.message
              : "Personal playlist episode generation failed.",
        },
      );
      shouldRetryCurrentAfterLease = !failure.failed;
    } catch {
      shouldRetryCurrentAfterLease = true;
    }
  } finally {
    try {
      if (shouldRetryCurrentAfterLease) {
        await scheduleCurrentEpisodeAfterLease();
      }
    } finally {
      await scheduleNextQueuedEpisode();
    }
  }
};
