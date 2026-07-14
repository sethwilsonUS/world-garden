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
          ttsCacheKey: result.metadata.ttsCacheKey,
          provider: result.metadata.provider,
          model: result.metadata.model,
          voiceId: result.metadata.voiceId,
          promptVersion: result.metadata.promptVersion,
          ttsNormVersion: result.metadata.ttsNormVersion,
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
};
