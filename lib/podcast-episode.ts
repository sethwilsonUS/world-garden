import { randomUUID } from "node:crypto";
import { anyApi } from "convex/server";
import { fetchAction, fetchMutation, fetchQuery } from "convex/nextjs";
import { api } from "@/convex/_generated/api";
import { type Doc, type Id } from "@/convex/_generated/dataModel";
import type { FetchAndCacheResult } from "@/convex/articles";
import { titleToSlug } from "@/convex/lib/wikipedia";
import { addMp3MetadataToBlob } from "@/lib/audio-metadata";
import { fetchCurrentFeaturedArticle } from "@/lib/featured-article";
import {
  FEATURED_EPISODE_ARTWORK_VERSION,
  renderFeaturedPodcastArtworkPng,
} from "@/lib/featured-podcast-artwork";
import { FEATURED_PODCAST_TITLE, getPodcastDescription } from "@/lib/podcast-feed";
import { TTS_NORM_VERSION } from "@/lib/tts-normalize";
import { generateTtsAudio } from "@/lib/tts-client";
import { hasFullAudio } from "@/lib/audio-suitability";

const MIN_TTS_TEXT_LENGTH = 10;
const TTS_WORDS_PER_SECOND = 2.5;
const JOB_LEASE_MS = 8 * 60 * 1000;

type FeaturedPodcastEpisodeWithUrl = Doc<"featuredPodcastEpisodes"> & {
  audioUrl: string | null;
};

type PodcastSectionSource = {
  sectionKey: string;
  text: string;
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

export const getPodcastSectionSources = (article: FetchAndCacheResult): PodcastSectionSource[] => {
  const items: PodcastSectionSource[] = [];

  if (article.summary && article.summary.length >= MIN_TTS_TEXT_LENGTH) {
    items.push({
      sectionKey: "summary",
      text: article.summary,
    });
  }

  for (let index = 0; index < article.sections.length; index += 1) {
    const section = article.sections[index];
    if (!hasFullAudio(section)) continue;
    items.push({
      sectionKey: `section-${index}`,
      text: `${section.title}. ${section.content}`,
    });
  }

  return items;
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
}: {
  audioBlob: Blob;
  title: string;
  artwork?: {
    data: Uint8Array;
    mimeType: string;
  } | null;
}): Promise<Blob> => {
  return await addMp3MetadataToBlob(audioBlob, {
    title,
    artist: "Curio Garden",
    album: FEATURED_PODCAST_TITLE,
    artwork: artwork ?? undefined,
  });
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
    "status" | "wikiPageId" | "title" | "artworkVersion"
  > | null;
  article: Pick<FetchAndCacheResult, "wikiPageId" | "title">;
}): boolean =>
  !force &&
  existingEpisode?.status === "ready" &&
  (!regenArt || hasCurrentFeaturedArtworkVersion(existingEpisode)) &&
  doesFeaturedEpisodeMatchArticle(existingEpisode, article);

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
  await fetchMutation(anyApi.podcast.finalizeFeaturedEpisodeJob, {
    featuredDate,
    articleId,
    owner,
    status,
    lastError,
  });
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
  const { tfa, feedDateIso } = await fetchCurrentFeaturedArticle();
  if (!tfa) {
    throw new Error("Wikipedia did not return a featured article");
  }

  const article = await fetchAction(api.articles.fetchAndCacheBySlug, {
    slug: titleToSlug(tfa.title),
  });
  const articleId = article._id;
  const source = {
    featuredDate: feedDateIso,
    title: article.title,
    wikiPageId: article.wikiPageId,
  };
  const existingEpisode = await getExistingEpisode(feedDateIso);
  const existingReadyEpisode =
    existingEpisode?.status === "ready" ? existingEpisode : null;
  const existingEpisodeMatchesArticle = existingReadyEpisode
    ? doesFeaturedEpisodeMatchArticle(existingReadyEpisode, article)
    : false;
  const repairedExisting = Boolean(
    existingReadyEpisode && !existingEpisodeMatchesArticle,
  );
  const owner = randomUUID();
  const runId = owner.slice(0, 8);
  let stage = "initializing";

  if (
    shouldReuseExistingFeaturedEpisode({
      force,
      regenArt,
      existingEpisode: existingReadyEpisode,
      article,
    })
    && existingReadyEpisode
  ) {
    return {
      status: "already_exists",
      episode: existingReadyEpisode,
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

  const claim = await fetchMutation(anyApi.podcast.claimFeaturedEpisodeJob, {
    featuredDate: feedDateIso,
    articleId,
    owner,
    leaseMs: JOB_LEASE_MS,
  });

  if (!claim.claimed) {
    const latestEpisode = await getExistingEpisode(feedDateIso);
    if (
      latestEpisode?.status === "ready" &&
      doesFeaturedEpisodeMatchArticle(latestEpisode, article)
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

  if (sections.length === 0) {
    await finalizeJob({
      featuredDate: feedDateIso,
      articleId,
      owner,
      status: "failed",
      lastError: "Featured article does not contain any audio-suitable sections",
    });
    throw new Error("Featured article does not contain any audio-suitable sections");
  }

  if (!existingReadyEpisode) {
    await fetchMutation(anyApi.podcast.saveFeaturedEpisode, {
      featuredDate: feedDateIso,
      articleId,
      wikiPageId: article.wikiPageId,
      slug: titleToSlug(article.title),
      title: article.title,
      description,
      imageUrl: article.thumbnailUrl,
      ttsNormVersion: TTS_NORM_VERSION,
      status: "pending",
      publishedAt,
    });
  }

  try {
    console.info(
      `[podcast:featured ${feedDateIso} run=${runId}] start force=${force} regenArt=${regenArt} existingStatus=${existingEpisode?.status ?? "missing"} sections=${sections.length}`,
    );

    if (
      regenArt &&
      existingReadyEpisode &&
      existingEpisodeMatchesArticle &&
      existingReadyEpisode.audioUrl
    ) {
      stage = "reusing_existing_audio";
      const audioBlob = await fetchBlobFromUrl(existingReadyEpisode.audioUrl);
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
        fetchMutation(anyApi.podcast.generateUploadUrl, {}),
        fetchMutation(anyApi.podcast.generateUploadUrl, {}),
      ]);
      stage = "uploading_assets";
      const [storageId, artworkStorageId] = await Promise.all([
        uploadBlobToConvexStorage(uploadUrl, taggedBlob),
        uploadBlobToConvexStorage(artworkUploadUrl, artworkBlob),
      ]);

      stage = "saving_episode";
      await fetchMutation(anyApi.podcast.saveFeaturedEpisode, {
        featuredDate: feedDateIso,
        articleId,
        wikiPageId: article.wikiPageId,
        slug: titleToSlug(article.title),
        title: article.title,
        description,
        imageUrl: article.thumbnailUrl,
        storageId,
        artworkStorageId,
        artworkVersion: FEATURED_EPISODE_ARTWORK_VERSION,
        durationSeconds: existingReadyEpisode.durationSeconds,
        byteLength: taggedBlob.size,
        ttsNormVersion: TTS_NORM_VERSION,
        status: "ready",
        publishedAt,
      });

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
        throw new Error("Featured podcast episode artwork was regenerated but could not be reloaded");
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

    const cachedAudio = await fetchQuery(api.audio.getAllSectionAudio, {
      articleId,
      ttsNormVersion: TTS_NORM_VERSION,
    });

    let generatedSectionCount = 0;
    let reusedSectionCount = 0;
    const audioChunks: Blob[] = [];

    for (const section of sections) {
      let blob: Blob | null = null;
      const cachedUrl = cachedAudio.urls[section.sectionKey];

      if (cachedUrl) {
        try {
          blob = await fetchBlobFromUrl(cachedUrl);
          reusedSectionCount += 1;
        } catch {
          blob = null;
        }
      }

      if (!blob) {
        stage = `generating_section_audio:${section.sectionKey}`;
        try {
          blob = await generateTtsAudio(
            { text: section.text },
            { apiBaseUrl: baseUrl },
          );
        } catch (error) {
          throw new Error(
            `Section ${section.sectionKey} audio failed: ${getErrorMessage(error)}`,
          );
        }
        generatedSectionCount += 1;

        stage = `uploading_section_audio:${section.sectionKey}`;
        const sectionUploadUrl = await fetchMutation(api.audio.generateUploadUrl, {});
        const sectionStorageId = await uploadBlobToConvexStorage(
          sectionUploadUrl,
          blob,
        );

        stage = `saving_section_audio:${section.sectionKey}`;
        await fetchMutation(api.audio.saveSectionAudioRecord, {
          articleId,
          sectionKey: section.sectionKey,
          storageId: sectionStorageId,
          ttsNormVersion: TTS_NORM_VERSION,
          durationSeconds: Math.round(
            section.text.split(/\s+/).filter(Boolean).length /
              TTS_WORDS_PER_SECOND,
          ),
        });
      }

      audioChunks.push(blob);
    }

    const combinedBlob = new Blob(audioChunks, { type: "audio/mpeg" });
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
    });
    const artworkBlob = new Blob([Buffer.from(artwork.data)], {
      type: artwork.mimeType,
    });
    const [uploadUrl, artworkUploadUrl] = await Promise.all([
      fetchMutation(anyApi.podcast.generateUploadUrl, {}),
      fetchMutation(anyApi.podcast.generateUploadUrl, {}),
    ]);
    stage = "uploading_assets";
    const [storageId, artworkStorageId] = await Promise.all([
      uploadBlobToConvexStorage(uploadUrl, taggedBlob),
      uploadBlobToConvexStorage(artworkUploadUrl, artworkBlob),
    ]);

    stage = "saving_episode";
    const episodeId = (await fetchMutation(anyApi.podcast.saveFeaturedEpisode, {
      featuredDate: feedDateIso,
      articleId,
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
      ttsNormVersion: TTS_NORM_VERSION,
      status: "ready",
      publishedAt,
    })) as Id<"featuredPodcastEpisodes">;

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
      throw new Error("Featured podcast episode was saved but could not be reloaded");
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

    await finalizeJob({
      featuredDate: feedDateIso,
      articleId,
      owner,
      status: "failed",
      lastError: detailedMessage,
    });

    if (!existingReadyEpisode) {
      await fetchMutation(anyApi.podcast.saveFeaturedEpisode, {
        featuredDate: feedDateIso,
        articleId,
        wikiPageId: article.wikiPageId,
        slug: titleToSlug(article.title),
        title: article.title,
        description,
        imageUrl: article.thumbnailUrl,
        ttsNormVersion: TTS_NORM_VERSION,
        status: "failed",
        publishedAt,
      });
    }

    throw new Error(detailedMessage);
  }
};
