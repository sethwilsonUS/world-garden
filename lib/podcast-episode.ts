import { randomUUID } from "node:crypto";
import { anyApi } from "convex/server";
import { fetchAction, fetchMutation, fetchQuery } from "convex/nextjs";
import { api } from "@/convex/_generated/api";
import { type Doc, type Id } from "@/convex/_generated/dataModel";
import type { FetchAndCacheResult } from "@/convex/articles";
import { titleToSlug } from "@/convex/lib/wikipedia";
import {
  addMp3MetadataToBlob,
  concatenateMp3Blobs,
} from "@/lib/audio-metadata";
import {
  FEATURED_EPISODE_ARTWORK_VERSION,
  renderFeaturedPodcastArtworkPng,
} from "@/lib/featured-podcast-artwork";
import {
  FEATURED_PODCAST_TITLE,
  getPodcastDescription,
} from "@/lib/podcast-feed";
import { getTodayWikipediaData } from "@/lib/today-snapshot";
import { generateTtsAudioWithMetadata } from "@/lib/tts-client";
import {
  createAudioCacheReadAttestation,
  createAudioCacheSaveAttestation,
  createAudioCacheUploadAttestation,
  getTrustedTtsGenerationHeaders,
} from "@/lib/tts-quota-bypass";
import {
  buildArticleNarrationHash,
  buildArticleNarrationTracks,
} from "@/lib/section-narration";
import {
  doesTtsMetadataMatch,
  getTtsMetadata,
  getTtsProfile,
  type TtsMetadata,
} from "@/lib/tts-profile";
import {
  createPublicAudioWriteAttestation,
  type PublicAudioWriteOperation,
} from "@/lib/public-audio-write-attestation";
import { isExactCurrentEdgeAudioMetadata } from "@/lib/public-edge-audio-metadata";
import {
  recordAudioCacheReadResultBestEffort,
  recordAudioCacheWriteFailureBestEffort,
} from "@/lib/audio-cache-ledger";
import { createAudioCacheLedgerAssetKey } from "@/lib/audio-cache-ledger-key";

export { doesTtsMetadataMatch } from "@/lib/tts-profile";

const TTS_WORDS_PER_SECOND = 2.5;
const JOB_LEASE_MS = 8 * 60 * 1000;

const withFeaturedWriteAttestation = async <
  TArgs extends Record<string, unknown>,
>(
  operation: PublicAudioWriteOperation,
  args: TArgs,
) => ({
  ...args,
  attestation: await createPublicAudioWriteAttestation({
    pipeline: "featured",
    operation,
    args,
  }),
});

const generateFeaturedUploadUrl = async (): Promise<string> =>
  (await fetchMutation(
    anyApi.podcast.generateUploadUrl,
    await withFeaturedWriteAttestation("generate-upload-url", {}),
  )) as string;

class FeaturedPodcastLeaseLostError extends Error {
  constructor() {
    super("Featured podcast job lease was lost before finalization.");
    this.name = "FeaturedPodcastLeaseLostError";
  }
}

type FeaturedPodcastEpisodeWithUrl = Doc<"featuredPodcastEpisodes"> & {
  audioUrl: string | null;
};

type PodcastSectionSource = {
  sectionKey: string;
  text: string;
  sourceHash: string;
};

export type FeaturedPodcastSyncResult = {
  status: "created" | "already_exists";
  episode: FeaturedPodcastEpisodeWithUrl;
  generatedSectionCount: number;
  reusedSectionCount: number;
  totalSectionCount: number;
  source: {
    featuredDate: string;
    title: string;
    wikiPageId: string;
  };
  publication: {
    reusedExisting: boolean;
    repairedExisting: boolean;
    regeneratedArtwork: boolean;
  };
};

const getPublishedAt = (
  featuredDateIso: string,
  featuredTimestamp: string | null,
): number => {
  if (featuredTimestamp) {
    const parsed = Date.parse(featuredTimestamp);
    if (Number.isFinite(parsed)) return parsed;
  }

  const fallback = Date.parse(`${featuredDateIso}T00:00:00.000Z`);
  return Number.isFinite(fallback) ? fallback : Date.now();
};

const estimateDurationSeconds = (texts: string[]): number =>
  Math.round(
    texts.reduce(
      (total, text) => total + text.split(/\s+/).filter(Boolean).length,
      0,
    ) / TTS_WORDS_PER_SECOND,
  );

const uploadBlobToConvexStorage = async (
  uploadUrl: string,
  blob: Blob,
): Promise<Id<"_storage">> => {
  const result = await fetch(uploadUrl, {
    method: "POST",
    headers: { "Content-Type": blob.type || "audio/mpeg" },
    body: blob,
  });

  if (!result.ok) {
    throw new Error(`Convex storage upload failed: ${result.status}`);
  }

  const body = (await result.json()) as { storageId?: Id<"_storage"> };
  if (!body.storageId) {
    throw new Error("Convex storage upload did not return a storageId");
  }

  return body.storageId;
};

const getErrorMessage = (error: unknown): string =>
  error instanceof Error ? error.message : "Unknown error";

export const getPodcastSectionSources = (
  article: FetchAndCacheResult,
): PodcastSectionSource[] => {
  return buildArticleNarrationTracks(article).map((track) => ({
    sectionKey: track.sectionKey,
    text: track.text,
    sourceHash: track.sourceHash,
  }));
};

const fetchBlobFromUrl = async (url: string): Promise<Blob> => {
  const response = await fetch(url, { cache: "no-store" });
  if (!response.ok) {
    throw new Error(`Fetching cached audio failed: ${response.status}`);
  }
  return await response.blob();
};

const tagPodcastEpisodeAudio = async ({
  audioBlob,
  title,
  artwork,
  stripExistingId3Tags = true,
}: {
  audioBlob: Blob;
  title: string;
  artwork?: {
    data: Uint8Array;
    mimeType: string;
  } | null;
  stripExistingId3Tags?: boolean;
}): Promise<Blob> => {
  return await addMp3MetadataToBlob(
    audioBlob,
    {
      title,
      artist: "Curio Garden",
      album: FEATURED_PODCAST_TITLE,
      artwork: artwork ?? undefined,
    },
    {
      stripExistingId3Tags,
    },
  );
};

const getExistingEpisode = async (
  featuredDate: string,
): Promise<FeaturedPodcastEpisodeWithUrl | null> =>
  (await fetchQuery(anyApi.podcast.getFeaturedEpisodeByDate, {
    featuredDate,
  })) as FeaturedPodcastEpisodeWithUrl | null;

const normalizeTitle = (value: string): string => value.trim().toLowerCase();

export const doesFeaturedEpisodeMatchArticle = (
  episode: Pick<FeaturedPodcastEpisodeWithUrl, "wikiPageId" | "title">,
  article: Pick<FetchAndCacheResult, "wikiPageId" | "title">,
): boolean =>
  episode.wikiPageId === article.wikiPageId &&
  normalizeTitle(episode.title) === normalizeTitle(article.title);

export const hasCurrentFeaturedArtworkVersion = (
  episode: Pick<FeaturedPodcastEpisodeWithUrl, "artworkVersion"> | null,
): boolean => episode?.artworkVersion === FEATURED_EPISODE_ARTWORK_VERSION;

export const shouldReuseExistingFeaturedEpisode = ({
  force,
  regenArt,
  existingEpisode,
  article,
}: {
  force: boolean;
  regenArt: boolean;
  existingEpisode: Pick<
    FeaturedPodcastEpisodeWithUrl,
    | "status"
    | "audioUrl"
    | "wikiPageId"
    | "title"
    | "artworkVersion"
    | "provider"
    | "model"
    | "voiceId"
    | "promptVersion"
    | "ttsNormVersion"
    | "ttsCacheKey"
    | "narrationHash"
  > | null;
  article: FetchAndCacheResult;
}): boolean => {
  const expected = getTtsMetadata(getTtsProfile("edge"));
  return (
    !force &&
    existingEpisode?.status === "ready" &&
    Boolean(existingEpisode.audioUrl?.trim()) &&
    isExactCurrentEdgeAudioMetadata(existingEpisode, expected.ttsCacheKey) &&
    existingEpisode.narrationHash === buildArticleNarrationHash(article) &&
    (!regenArt || hasCurrentFeaturedArtworkVersion(existingEpisode)) &&
    doesFeaturedEpisodeMatchArticle(existingEpisode, article)
  );
};

const finalizeJob = async ({
  featuredDate,
  articleId,
  status,
  owner,
  lastError,
}: {
  featuredDate: string;
  articleId?: Id<"articles">;
  status: "ready" | "failed";
  owner: string;
  lastError?: string;
}) => {
  const writeArgs = {
    featuredDate,
    articleId,
    owner,
    status,
    lastError,
  };
  const result = (await fetchMutation(
    anyApi.podcast.finalizeFeaturedEpisodeJob,
    await withFeaturedWriteAttestation("finalize-job", writeArgs),
  )) as { updated?: boolean };
  if (result.updated !== true) {
    throw new FeaturedPodcastLeaseLostError();
  }
};

export const syncFeaturedPodcastEpisode = async ({
  baseUrl,
  force = false,
  regenArt = false,
}: {
  baseUrl: string;
  force?: boolean;
  regenArt?: boolean;
}): Promise<FeaturedPodcastSyncResult> => {
  const today = await getTodayWikipediaData({ allowLiveFallback: true });
  if (!today?.feedDate) {
    throw new Error("Today on Wikipedia snapshot is not available");
  }
  const tfa = today.tfa ?? null;
  const feedDateIso = today.feedDate;
  if (!tfa) {
    throw new Error("Wikipedia did not return a featured article");
  }

  const article = await fetchAction(api.articles.fetchAndCacheBySlug, {
    slug: titleToSlug(tfa.title),
  });
  const articleId = article._id;
  const narrationHash = buildArticleNarrationHash(article);
  const source = {
    featuredDate: feedDateIso,
    title: article.title,
    wikiPageId: article.wikiPageId,
  };
  const expectedTtsMetadata = getTtsMetadata(getTtsProfile("edge"));
  const existingEpisode = await getExistingEpisode(feedDateIso);
  const previousReadyEpisode =
    existingEpisode?.status === "ready" ? existingEpisode : null;
  const previousReadyEpisodeMatchesArticle = previousReadyEpisode
    ? doesFeaturedEpisodeMatchArticle(previousReadyEpisode, article)
    : false;
  const previousReusableReadyEpisode =
    previousReadyEpisode &&
    previousReadyEpisodeMatchesArticle &&
    Boolean(previousReadyEpisode.audioUrl?.trim()) &&
    previousReadyEpisode.narrationHash === narrationHash &&
    isExactCurrentEdgeAudioMetadata(
      previousReadyEpisode,
      expectedTtsMetadata.ttsCacheKey,
    )
      ? previousReadyEpisode
      : null;
  const repairedExisting = Boolean(
    previousReadyEpisode && !previousReusableReadyEpisode,
  );
  const owner = randomUUID();
  const runId = owner.slice(0, 8);
  let stage = "initializing";

  if (
    shouldReuseExistingFeaturedEpisode({
      force,
      regenArt,
      existingEpisode: previousReusableReadyEpisode,
      article,
    }) &&
    previousReusableReadyEpisode
  ) {
    return {
      status: "already_exists",
      episode: previousReusableReadyEpisode,
      generatedSectionCount: 0,
      reusedSectionCount: 0,
      totalSectionCount: 0,
      source,
      publication: {
        reusedExisting: true,
        repairedExisting: false,
        regeneratedArtwork: false,
      },
    };
  }

  const claimArgs = {
    featuredDate: feedDateIso,
    articleId,
    owner,
    leaseMs: JOB_LEASE_MS,
  };
  const claim = await fetchMutation(
    anyApi.podcast.claimFeaturedEpisodeJob,
    await withFeaturedWriteAttestation("claim-job", claimArgs),
  );

  if (!claim.claimed) {
    const latestEpisode = await getExistingEpisode(feedDateIso);
    if (
      latestEpisode &&
      shouldReuseExistingFeaturedEpisode({
        force: false,
        regenArt,
        existingEpisode:
          latestEpisode.status === "ready" ? latestEpisode : null,
        article,
      })
    ) {
      return {
        status: "already_exists",
        episode: latestEpisode,
        generatedSectionCount: 0,
        reusedSectionCount: 0,
        totalSectionCount: 0,
        source,
        publication: {
          reusedExisting: true,
          repairedExisting: false,
          regeneratedArtwork: false,
        },
      };
    }

    throw new Error(`Featured podcast sync already running for ${feedDateIso}`);
  }

  const publishedAt = getPublishedAt(feedDateIso, tfa.featuredDate);
  const sections = getPodcastSectionSources(article);
  const description = getPodcastDescription(article.summary || tfa.extract);
  let currentTtsMetadata = expectedTtsMetadata;
  let committedReadyEpisode = false;

  try {
    if (sections.length === 0) {
      throw new Error(
        "Featured article does not contain any narratable source tracks",
      );
    }

    if (!previousReusableReadyEpisode) {
      const pendingEpisodeArgs = {
        featuredDate: feedDateIso,
        articleId,
        owner,
        wikiPageId: article.wikiPageId,
        slug: titleToSlug(article.title),
        title: article.title,
        description,
        imageUrl: article.thumbnailUrl,
        ttsNormVersion: currentTtsMetadata.ttsNormVersion,
        ttsCacheKey: currentTtsMetadata.ttsCacheKey,
        provider: currentTtsMetadata.provider,
        model: currentTtsMetadata.model,
        voiceId: currentTtsMetadata.voiceId,
        promptVersion: currentTtsMetadata.promptVersion,
        narrationHash,
        status: "pending",
        publishedAt,
      } as const;
      await fetchMutation(
        anyApi.podcast.saveFeaturedEpisode,
        await withFeaturedWriteAttestation("save-record", pendingEpisodeArgs),
      );
    }

    console.info(
      `[podcast:featured ${feedDateIso} run=${runId}] start force=${force} regenArt=${regenArt} existingStatus=${existingEpisode?.status ?? "missing"} sections=${sections.length}`,
    );

    if (
      regenArt &&
      previousReusableReadyEpisode &&
      previousReusableReadyEpisode.audioUrl &&
      isExactCurrentEdgeAudioMetadata(
        previousReusableReadyEpisode,
        expectedTtsMetadata.ttsCacheKey,
      ) &&
      previousReusableReadyEpisode.narrationHash === narrationHash
    ) {
      stage = "reusing_existing_audio";
      const audioBlob = await fetchBlobFromUrl(
        previousReusableReadyEpisode.audioUrl,
      );
      stage = "rendering_artwork";
      const artwork = await renderFeaturedPodcastArtworkPng({
        featuredDate: feedDateIso,
        title: article.title,
        imageUrl: article.thumbnailUrl,
      });
      stage = "tagging_audio";
      const taggedBlob = await tagPodcastEpisodeAudio({
        audioBlob,
        title: article.title,
        artwork,
      });
      const artworkBlob = new Blob([Buffer.from(artwork.data)], {
        type: artwork.mimeType,
      });
      const [uploadUrl, artworkUploadUrl] = await Promise.all([
        generateFeaturedUploadUrl(),
        generateFeaturedUploadUrl(),
      ]);
      stage = "uploading_assets";
      const [storageId, artworkStorageId] = await Promise.all([
        uploadBlobToConvexStorage(uploadUrl, taggedBlob),
        uploadBlobToConvexStorage(artworkUploadUrl, artworkBlob),
      ]);

      stage = "saving_episode";
      const readyEpisodeArgs = {
        featuredDate: feedDateIso,
        articleId,
        owner,
        wikiPageId: article.wikiPageId,
        slug: titleToSlug(article.title),
        title: article.title,
        description,
        imageUrl: article.thumbnailUrl,
        storageId,
        artworkStorageId,
        artworkVersion: FEATURED_EPISODE_ARTWORK_VERSION,
        durationSeconds: previousReusableReadyEpisode.durationSeconds,
        byteLength: taggedBlob.size,
        ttsNormVersion: previousReusableReadyEpisode.ttsNormVersion,
        ttsCacheKey: previousReusableReadyEpisode.ttsCacheKey,
        provider: previousReusableReadyEpisode.provider,
        model: previousReusableReadyEpisode.model,
        voiceId: previousReusableReadyEpisode.voiceId,
        promptVersion: previousReusableReadyEpisode.promptVersion,
        narrationHash,
        status: "ready",
        publishedAt,
      } as const;
      await fetchMutation(
        anyApi.podcast.saveFeaturedEpisode,
        await withFeaturedWriteAttestation("save-record", readyEpisodeArgs),
      );
      committedReadyEpisode = true;

      stage = "finalizing_job";
      await finalizeJob({
        featuredDate: feedDateIso,
        articleId,
        owner,
        status: "ready",
      });

      stage = "reloading_saved_episode";
      const savedEpisode = await getExistingEpisode(feedDateIso);
      if (!savedEpisode) {
        throw new Error(
          "Featured podcast episode artwork was regenerated but could not be reloaded",
        );
      }

      return {
        status: "created",
        episode: savedEpisode,
        generatedSectionCount: 0,
        reusedSectionCount: 0,
        totalSectionCount: 0,
        source,
        publication: {
          reusedExisting: false,
          repairedExisting,
          regeneratedArtwork: true,
        },
      };
    }

    const loadSectionAudio = async (): Promise<{
      audioChunks: Blob[];
      generatedSectionCount: number;
      reusedSectionCount: number;
      metadata: TtsMetadata;
    }> => {
      const passMetadata = expectedTtsMetadata;
      currentTtsMetadata = passMetadata;
      const cacheArgs = {
        articleId,
        ttsNormVersion: passMetadata.ttsNormVersion,
        ttsCacheKey: passMetadata.ttsCacheKey,
        sourceHashes: sections.map(({ sectionKey, sourceHash }) => ({
          sectionKey,
          sourceHash,
        })),
      };
      const readAttestation = await createAudioCacheReadAttestation(cacheArgs);
      const cachedAudio = await fetchMutation(
        anyApi.audio.getAllSectionAudioForServer,
        { ...cacheArgs, attestation: readAttestation },
      );

      let generatedSectionCount = 0;
      let reusedSectionCount = 0;
      let producedMetadata: TtsMetadata | null = null;
      const audioChunks: Blob[] = [];

      for (const section of sections) {
        let blob: Blob | null = null;
        const cachedUrl = cachedAudio.urls[section.sectionKey];

        if (
          cachedUrl &&
          doesTtsMetadataMatch(
            cachedAudio.metadata?.[section.sectionKey],
            passMetadata,
          )
        ) {
          try {
            blob = await fetchBlobFromUrl(cachedUrl);
            const cachedDurationSeconds =
              cachedAudio.durations?.[section.sectionKey];
            await recordAudioCacheReadResultBestEffort({
              source: "featured_podcast",
              provider: passMetadata.provider,
              hit: true,
              byteLength: blob.size,
              durationSeconds:
                typeof cachedDurationSeconds === "number" &&
                Number.isFinite(cachedDurationSeconds) &&
                cachedDurationSeconds >= 0
                  ? cachedDurationSeconds
                  : estimateDurationSeconds([section.text]),
            });
            reusedSectionCount += 1;
          } catch {
            blob = null;
          }
        }

        if (!blob) {
          await recordAudioCacheReadResultBestEffort({
            source: "featured_podcast",
            provider: passMetadata.provider,
            hit: false,
            byteLength: 0,
            durationSeconds: 0,
          });
          let metadata: TtsMetadata;
          stage = `generating_section_audio:${section.sectionKey}`;
          try {
            const generatedAudio = await generateTtsAudioWithMetadata(
              { text: section.text, provider: passMetadata.provider },
              {
                apiBaseUrl: baseUrl,
                headers: await getTrustedTtsGenerationHeaders(
                  baseUrl,
                  "featured_podcast",
                ),
              },
            );
            blob = generatedAudio.blob;
            metadata = generatedAudio.metadata;
          } catch (error) {
            throw new Error(
              `Section ${section.sectionKey} audio failed: ${getErrorMessage(error)}`,
            );
          }

          if (!doesTtsMetadataMatch(metadata, passMetadata)) {
            throw new Error(
              `TTS profile mismatch: expected ${passMetadata.ttsCacheKey}, got ${metadata.ttsCacheKey}`,
            );
          }

          producedMetadata = metadata;
          generatedSectionCount += 1;
          const ledgerAssetKey = createAudioCacheLedgerAssetKey();
          try {
            stage = `uploading_section_audio:${section.sectionKey}`;
            const uploadAttestation = await createAudioCacheUploadAttestation();
            const sectionUploadUrl = await fetchMutation(
              api.audio.generateUploadUrl,
              { attestation: uploadAttestation },
            );
            const sectionStorageId = await uploadBlobToConvexStorage(
              sectionUploadUrl,
              blob,
            );

            stage = `saving_section_audio:${section.sectionKey}`;
            const record = {
              articleId,
              sectionKey: section.sectionKey,
              sourceHash: section.sourceHash,
              storageId: sectionStorageId,
              ttsNormVersion: metadata.ttsNormVersion,
              ttsCacheKey: metadata.ttsCacheKey,
              provider: metadata.provider,
              model: metadata.model,
              voiceId: metadata.voiceId,
              promptVersion: metadata.promptVersion,
              durationSeconds: Math.round(
                section.text.split(/\s+/).filter(Boolean).length /
                  TTS_WORDS_PER_SECOND,
              ),
              ...(ledgerAssetKey
                ? {
                    byteLength: blob.size,
                    ledgerAssetKey,
                    ledgerSource: "featured_podcast" as const,
                  }
                : {}),
            };
            const saveAttestation =
              await createAudioCacheSaveAttestation(record);
            await fetchMutation(api.audio.saveSectionAudioRecord, {
              ...record,
              attestation: saveAttestation,
            });
          } catch (error) {
            if (ledgerAssetKey) {
              await recordAudioCacheWriteFailureBestEffort({
                ledgerAssetKey,
                source: "featured_podcast",
                provider: metadata.provider,
              });
            }
            throw error;
          }
        }

        audioChunks.push(blob);
      }

      return {
        audioChunks,
        generatedSectionCount,
        reusedSectionCount,
        metadata: producedMetadata ?? passMetadata,
      };
    };

    const sectionAudio = await loadSectionAudio();
    const { audioChunks, generatedSectionCount, reusedSectionCount } =
      sectionAudio;

    const combinedBlob = await concatenateMp3Blobs(audioChunks, {
      stripId3Tags: "none",
    });
    stage = "rendering_artwork";
    const artwork = await renderFeaturedPodcastArtworkPng({
      featuredDate: feedDateIso,
      title: article.title,
      imageUrl: article.thumbnailUrl,
    });
    stage = "tagging_audio";
    const taggedBlob = await tagPodcastEpisodeAudio({
      audioBlob: combinedBlob,
      title: article.title,
      artwork,
      stripExistingId3Tags: false,
    });
    const artworkBlob = new Blob([Buffer.from(artwork.data)], {
      type: artwork.mimeType,
    });
    const [uploadUrl, artworkUploadUrl] = await Promise.all([
      generateFeaturedUploadUrl(),
      generateFeaturedUploadUrl(),
    ]);
    stage = "uploading_assets";
    const [storageId, artworkStorageId] = await Promise.all([
      uploadBlobToConvexStorage(uploadUrl, taggedBlob),
      uploadBlobToConvexStorage(artworkUploadUrl, artworkBlob),
    ]);

    stage = "saving_episode";
    const readyEpisodeArgs = {
      featuredDate: feedDateIso,
      articleId,
      owner,
      wikiPageId: article.wikiPageId,
      slug: titleToSlug(article.title),
      title: article.title,
      description,
      imageUrl: article.thumbnailUrl,
      storageId,
      artworkStorageId,
      artworkVersion: FEATURED_EPISODE_ARTWORK_VERSION,
      durationSeconds: estimateDurationSeconds(sections.map((s) => s.text)),
      byteLength: taggedBlob.size,
      ttsNormVersion: sectionAudio.metadata.ttsNormVersion,
      ttsCacheKey: sectionAudio.metadata.ttsCacheKey,
      provider: sectionAudio.metadata.provider,
      model: sectionAudio.metadata.model,
      voiceId: sectionAudio.metadata.voiceId,
      promptVersion: sectionAudio.metadata.promptVersion,
      narrationHash,
      status: "ready",
      publishedAt,
    } as const;
    const episodeId = (await fetchMutation(
      anyApi.podcast.saveFeaturedEpisode,
      await withFeaturedWriteAttestation("save-record", readyEpisodeArgs),
    )) as Id<"featuredPodcastEpisodes">;
    committedReadyEpisode = true;

    stage = "finalizing_job";
    await finalizeJob({
      featuredDate: feedDateIso,
      articleId,
      owner,
      status: "ready",
    });

    stage = "reloading_saved_episode";
    const savedEpisode = await getExistingEpisode(feedDateIso);
    if (!savedEpisode || savedEpisode._id !== episodeId) {
      throw new Error(
        "Featured podcast episode was saved but could not be reloaded",
      );
    }

    console.info(
      `[podcast:featured ${feedDateIso} run=${runId}] success generatedSections=${generatedSectionCount} reusedSections=${reusedSectionCount}`,
    );

    return {
      status: "created",
      episode: savedEpisode,
      generatedSectionCount,
      reusedSectionCount,
      totalSectionCount: sections.length,
      source,
      publication: {
        reusedExisting: false,
        repairedExisting,
        regeneratedArtwork: false,
      },
    };
  } catch (error) {
    const message = getErrorMessage(error);
    const detailedMessage = `[${stage}] ${message}`;

    console.error(
      `[podcast:featured ${feedDateIso} run=${runId}] failed at stage=${stage}: ${message}`,
      error,
    );

    if (error instanceof FeaturedPodcastLeaseLostError) {
      throw error;
    }

    let cleanupError: unknown;
    try {
      if (!previousReusableReadyEpisode && !committedReadyEpisode) {
        const failedEpisodeArgs = {
          featuredDate: feedDateIso,
          articleId,
          owner,
          wikiPageId: article.wikiPageId,
          slug: titleToSlug(article.title),
          title: article.title,
          description,
          imageUrl: article.thumbnailUrl,
          ttsNormVersion: currentTtsMetadata.ttsNormVersion,
          ttsCacheKey: currentTtsMetadata.ttsCacheKey,
          provider: currentTtsMetadata.provider,
          model: currentTtsMetadata.model,
          voiceId: currentTtsMetadata.voiceId,
          promptVersion: currentTtsMetadata.promptVersion,
          narrationHash,
          status: "failed",
          publishedAt,
        } as const;
        await fetchMutation(
          anyApi.podcast.saveFeaturedEpisode,
          await withFeaturedWriteAttestation("save-record", failedEpisodeArgs),
        );
      }
    } catch (failedSaveError) {
      cleanupError = failedSaveError;
    }

    try {
      await finalizeJob({
        featuredDate: feedDateIso,
        articleId,
        owner,
        status: "failed",
        lastError: detailedMessage,
      });
    } catch (finalizeError) {
      cleanupError ??= finalizeError;
    }

    if (cleanupError) {
      throw new Error(
        `${detailedMessage} Cleanup failed: ${getErrorMessage(cleanupError)}`,
      );
    }

    throw new Error(detailedMessage);
  }
};
