import { anyApi } from "convex/server";
import { fetchAction, fetchMutation, fetchQuery } from "convex/nextjs";
import { api } from "@/convex/_generated/api";
import { type Doc, type Id } from "@/convex/_generated/dataModel";
import type { FetchAndCacheResult } from "@/convex/articles";
import { titleToSlug } from "@/convex/lib/wikipedia";
import { fetchCurrentFeaturedArticle } from "@/lib/featured-article";
import { getPodcastDescription } from "@/lib/podcast-feed";
import { TTS_NORM_VERSION } from "@/lib/tts-normalize";
import { generateTtsAudio } from "@/lib/tts-client";

const MIN_TTS_TEXT_LENGTH = 10;
const MIN_AUDIO_CONTENT_LENGTH = 20;
const TTS_WORDS_PER_SECOND = 2.5;

type FeaturedPodcastEpisodeWithUrl = Doc<"featuredPodcastEpisodes"> & {
  audioUrl: string | null;
};

type FeaturedPodcastJob = Doc<"featuredPodcastJobs">;

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

const getPodcastSectionSources = (article: FetchAndCacheResult): PodcastSectionSource[] => {
  const items: PodcastSectionSource[] = [];

  if (article.summary && article.summary.length >= MIN_TTS_TEXT_LENGTH) {
    items.push({
      sectionKey: "summary",
      text: article.summary,
    });
  }

  for (let index = 0; index < article.sections.length; index += 1) {
    const section = article.sections[index];
    if (section.content.length < MIN_AUDIO_CONTENT_LENGTH) continue;
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

const getExistingEpisode = async (
  featuredDate: string,
): Promise<FeaturedPodcastEpisodeWithUrl | null> =>
  (await fetchQuery(anyApi.podcast.getFeaturedEpisodeByDate, {
    featuredDate,
  })) as FeaturedPodcastEpisodeWithUrl | null;

const getExistingJob = async (
  featuredDate: string,
): Promise<FeaturedPodcastJob | null> =>
  (await fetchQuery(anyApi.podcast.getFeaturedEpisodeJobByDate, {
    featuredDate,
  })) as FeaturedPodcastJob | null;

const updateJob = async ({
  featuredDate,
  articleId,
  status,
  attempts,
  lastError,
}: {
  featuredDate: string;
  articleId?: Id<"articles">;
  status: "pending" | "running" | "ready" | "failed";
  attempts: number;
  lastError?: string;
}) => {
  await fetchMutation(anyApi.podcast.upsertFeaturedEpisodeJob, {
    featuredDate,
    articleId,
    status,
    attempts,
    lastError,
  });
};

export const syncFeaturedPodcastEpisode = async ({
  baseUrl,
  force = false,
}: {
  baseUrl: string;
  force?: boolean;
}): Promise<FeaturedPodcastSyncResult> => {
  const { tfa, feedDateIso } = await fetchCurrentFeaturedArticle();
  if (!tfa) {
    throw new Error("Wikipedia did not return a featured article");
  }

  const existingEpisode = await getExistingEpisode(feedDateIso);
  const existingReadyEpisode =
    existingEpisode?.status === "ready" ? existingEpisode : null;

  if (!force && existingReadyEpisode) {
    return {
      status: "already_exists",
      episode: existingReadyEpisode,
      generatedSectionCount: 0,
      reusedSectionCount: 0,
      totalSectionCount: 0,
    };
  }

  const article = await fetchAction(api.articles.fetchAndCacheBySlug, {
    slug: titleToSlug(tfa.title),
  });
  const articleId = article._id;
  const publishedAt = getPublishedAt(feedDateIso, tfa.featuredDate);
  const sections = getPodcastSectionSources(article);
  const description = getPodcastDescription(article.summary || tfa.extract);

  if (sections.length === 0) {
    throw new Error("Featured article does not contain any audio-suitable sections");
  }

  const existingJob = await getExistingJob(feedDateIso);
  const attempts = (existingJob?.attempts ?? 0) + 1;

  await updateJob({
    featuredDate: feedDateIso,
    articleId,
    status: "running",
    attempts,
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
      status: "pending",
      publishedAt,
    });
  }

  try {
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
        blob = await generateTtsAudio(
          { text: section.text },
          { apiBaseUrl: baseUrl },
        );
        generatedSectionCount += 1;

        const sectionUploadUrl = await fetchMutation(api.audio.generateUploadUrl, {});
        const sectionStorageId = await uploadBlobToConvexStorage(
          sectionUploadUrl,
          blob,
        );

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
    const uploadUrl = await fetchMutation(anyApi.podcast.generateUploadUrl, {});
    const storageId = await uploadBlobToConvexStorage(uploadUrl, combinedBlob);

    const episodeId = (await fetchMutation(anyApi.podcast.saveFeaturedEpisode, {
      featuredDate: feedDateIso,
      articleId,
      wikiPageId: article.wikiPageId,
      slug: titleToSlug(article.title),
      title: article.title,
      description,
      imageUrl: article.thumbnailUrl,
      storageId,
      durationSeconds: estimateDurationSeconds(sections.map((s) => s.text)),
      byteLength: combinedBlob.size,
      ttsNormVersion: TTS_NORM_VERSION,
      status: "ready",
      publishedAt,
    })) as Id<"featuredPodcastEpisodes">;

    await updateJob({
      featuredDate: feedDateIso,
      articleId,
      status: "ready",
      attempts,
    });

    const savedEpisode = await getExistingEpisode(feedDateIso);
    if (!savedEpisode || savedEpisode._id !== episodeId) {
      throw new Error("Featured podcast episode was saved but could not be reloaded");
    }

    return {
      status: "created",
      episode: savedEpisode,
      generatedSectionCount,
      reusedSectionCount,
      totalSectionCount: sections.length,
    };
  } catch (error) {
    const message =
      error instanceof Error ? error.message : "Episode generation failed";

    await updateJob({
      featuredDate: feedDateIso,
      articleId,
      status: "failed",
      attempts,
      lastError: message,
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

    throw error;
  }
};
