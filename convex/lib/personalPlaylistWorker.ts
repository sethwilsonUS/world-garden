import type { Id } from "../_generated/dataModel";
import type { ActionCtx } from "../_generated/server";
import { internal } from "../_generated/api";
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
import { getAudioGenerationBaseUrl } from "../../lib/audio-generation-url";

const PERSONAL_PODCAST_ALBUM_TITLE = "Curio Garden Personal Playlist";

export const processViewerPlaylistEpisodeForCtx = async (
  ctx: ActionCtx,
  args: {
    episodeId: Id<"personalPlaylistEpisodes">;
    /** Ignored legacy field retained for direct orchestration compatibility. */
    baseUrl?: string;
  },
) => {
  const baseUrl = getAudioGenerationBaseUrl();
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
      { episodeId: args.episodeId },
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
      },
    );
  };

  let pendingCombinedStorageId: Id<"_storage"> | null = null;
  const discardPendingCombinedStorage = async (): Promise<
    "none" | "discarded" | "referenced" | "unknown"
  > => {
    const storageId = pendingCombinedStorageId;
    if (!storageId) return "none";

    try {
      const result = await ctx.runMutation(
        internal.personalPlaylist.discardViewerPlaylistEpisodeStorageInternal,
        {
          episodeId: args.episodeId,
          viewerTokenIdentifier: claim.viewerTokenIdentifier!,
          storageId,
        },
      );
      if (result.discarded || result.referenced) {
        pendingCombinedStorageId = null;
      }
      return result.referenced
        ? "referenced"
        : result.discarded
          ? "discarded"
          : "unknown";
    } catch {
      return "unknown";
    }
  };

  let shouldRetryCurrentAfterLease = false;
  try {
    const generationEpisode = await ctx.runQuery(
      internal.personalPlaylist.getPersonalPlaylistEpisodeInternal,
      { episodeId: args.episodeId },
    );
    if (
      !generationEpisode ||
      generationEpisode.removedAt != null ||
      generationEpisode.status !== "running" ||
      generationEpisode.leaseOwner !== owner
    ) {
      throw new Error("Personal playlist episode lease was lost.");
    }

    const article = await ctx.runQuery(
      internal.personalPlaylist.getPersonalPlaylistArticleInternal,
      {
        articleId: generationEpisode.articleId,
      },
    );

    if (!article) {
      throw new Error("Article not found.");
    }

    const sections = getArticleAudioSections(article);
    if (sections.length === 0) {
      throw new Error("Article does not contain any narratable source tracks.");
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
        slug: article.slug ?? generationEpisode.slug,
      },
      albumTitle: PERSONAL_PODCAST_ALBUM_TITLE,
      baseUrl,
      preferredProvider: "openai",
      requestedTtsMetadata:
        generationEpisode.requestedTtsMetadata?.provider === "openai"
          ? generationEpisode.requestedTtsMetadata
          : undefined,
      getCachedSectionAudioUrls: async ({ ttsCacheKey, sourceHashes }) => {
        const cachedAudio = await ctx.runQuery(
          internal.audio.getAllSectionAudioInternal,
          {
            articleId: article._id,
            ttsNormVersion: TTS_NORM_VERSION,
            ttsCacheKey,
            sourceHashes,
          },
        );
        return cachedAudio.urls;
      },
      saveSectionAudio: async ({
        sectionKey,
        sourceHash,
        blob,
        durationSeconds,
        metadata,
      }) => {
        const uploadUrl = await ctx.runMutation(
          internal.audio.generateUploadUrlInternal,
          {},
        );
        const storageId = await uploadBlobToConvexStorage(uploadUrl, blob);
        await ctx.runMutation(internal.audio.saveSectionAudioRecordInternal, {
          articleId: article._id,
          sectionKey,
          sourceHash,
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
        const uploadUrl = await ctx.runMutation(
          internal.audio.generateUploadUrlInternal,
          {},
        );
        const upload = await uploadStreamToConvexStorage(
          uploadUrl,
          stream,
          contentType,
        );
        pendingCombinedStorageId = upload.storageId;
        let registration: { registered: boolean };
        try {
          registration = await ctx.runMutation(
            internal.personalPlaylist
              .registerViewerPlaylistEpisodeStorageInternal,
            {
              episodeId: args.episodeId,
              viewerTokenIdentifier: claim.viewerTokenIdentifier!,
              owner,
              storageId: upload.storageId,
            },
          );
        } catch (error) {
          await discardPendingCombinedStorage();
          throw error;
        }
        if (!registration.registered) {
          pendingCombinedStorageId = null;
          throw new Error(
            "Personal playlist episode was removed before audio could be attached.",
          );
        }
        return upload;
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
        narrationHash: result.narrationHash,
        viewerTokenIdentifier: claim.viewerTokenIdentifier,
      },
    );
    if (completion.completed) {
      pendingCombinedStorageId = null;
    } else {
      await discardPendingCombinedStorage();
    }
    shouldRetryCurrentAfterLease = !completion.completed;
  } catch (error) {
    const discardDisposition = await discardPendingCombinedStorage();
    if (discardDisposition !== "referenced") {
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
