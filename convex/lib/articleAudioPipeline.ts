import { type Id } from "../_generated/dataModel";
import { titleToSlug } from "./wikipedia";
import {
  addMp3MetadataToBlob,
  concatenateMp3Blobs,
} from "../../lib/audio-metadata";
import { generateTtsAudio } from "../../lib/tts-client";
import { hasFullAudio, type AudioMode, type AudioReason } from "../../lib/audio-suitability";

const TTS_WORDS_PER_SECOND = 2.5;

export type ArticleAudioSource = {
  _id: Id<"articles">;
  title: string;
  slug?: string;
  summary?: string;
  thumbnailUrl?: string;
  sections?: {
    title: string;
    level: number;
    content: string;
    audioMode?: AudioMode;
    audioReason?: AudioReason;
  }[];
};

export type ArticleAudioSection = {
  sectionKey: string;
  text: string;
};

export type AssembleArticleAudioArgs = {
  article: ArticleAudioSource;
  albumTitle: string;
  baseUrl: string;
  getCachedSectionAudioUrls: () => Promise<Record<string, string | null | undefined>>;
  saveSectionAudio: (args: {
    sectionKey: string;
    blob: Blob;
    durationSeconds: number;
  }) => Promise<void>;
  onProgress?: (args: {
    completedSectionCount: number;
    sectionCount: number;
    stage: "rendering_audio" | "packaging";
  }) => Promise<void> | void;
};

export type AssembleArticleAudioResult = {
  blob: Blob;
  byteLength: number;
  durationSeconds: number;
  sectionCount: number;
  generatedSectionCount: number;
  reusedSectionCount: number;
};

const countWords = (text: string): number =>
  text.split(/\s+/).filter(Boolean).length;

export const estimateDurationSeconds = (text: string | string[]): number => {
  const joined = Array.isArray(text) ? text.join(" ") : text;
  return Math.round(countWords(joined) / TTS_WORDS_PER_SECOND);
};

export const getArticleAudioSections = (
  article: ArticleAudioSource,
): ArticleAudioSection[] => {
  const sections: ArticleAudioSection[] = [];

  if ((article.summary ?? "").trim().length >= 10) {
    sections.push({
      sectionKey: "summary",
      text: article.summary ?? "",
    });
  }

  for (let index = 0; index < (article.sections ?? []).length; index += 1) {
    const section = article.sections?.[index];
    if (!section || !hasFullAudio(section)) continue;

    sections.push({
      sectionKey: `section-${index}`,
      text: `${section.title}. ${section.content}`,
    });
  }

  return sections;
};

export const fetchBlobFromUrl = async (url: string): Promise<Blob> => {
  const response = await fetch(url, { cache: "no-store" });
  if (!response.ok) {
    throw new Error(`Fetching cached audio failed: ${response.status}`);
  }
  return await response.blob();
};

export const fetchArticleArtwork = async ({
  baseUrl,
  slug,
  title,
}: {
  baseUrl: string;
  slug?: string;
  title: string;
}) => {
  const resolvedSlug = slug?.trim() || titleToSlug(title);
  if (!resolvedSlug) {
    return undefined;
  }

  try {
    const response = await fetch(
      `${baseUrl}/api/article/${encodeURIComponent(resolvedSlug)}/artwork`,
      { cache: "no-store" },
    );
    const mimeType = response.headers.get("Content-Type")?.split(";")[0]?.trim();

    if (!response.ok || !mimeType?.startsWith("image/")) {
      return undefined;
    }

    const data = new Uint8Array(await response.arrayBuffer());
    if (data.length === 0) return undefined;

    return {
      data,
      mimeType,
      description: title,
    };
  } catch {
    return undefined;
  }
};

export const assembleArticleAudio = async ({
  article,
  albumTitle,
  baseUrl,
  getCachedSectionAudioUrls,
  saveSectionAudio,
  onProgress,
}: AssembleArticleAudioArgs): Promise<AssembleArticleAudioResult> => {
  const sections = getArticleAudioSections(article);
  if (sections.length === 0) {
    throw new Error("Article does not contain any audio-suitable sections.");
  }

  const cachedUrls = await getCachedSectionAudioUrls();
  const audioChunks: Blob[] = [];
  let generatedSectionCount = 0;
  let reusedSectionCount = 0;

  for (let index = 0; index < sections.length; index += 1) {
    const section = sections[index];
    let blob: Blob | null = null;
    const cachedUrl = cachedUrls[section.sectionKey];

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

      await saveSectionAudio({
        sectionKey: section.sectionKey,
        blob,
        durationSeconds: estimateDurationSeconds(section.text),
      });
    }

    audioChunks.push(blob);

    await onProgress?.({
      completedSectionCount: index + 1,
      sectionCount: sections.length,
      stage: "rendering_audio",
    });
  }

  await onProgress?.({
    completedSectionCount: sections.length,
    sectionCount: sections.length,
    stage: "packaging",
  });

  const combinedBlob = await concatenateMp3Blobs(audioChunks);
  const artwork = await fetchArticleArtwork({
    baseUrl,
    slug: article.slug,
    title: article.title,
  });
  const taggedBlob = await addMp3MetadataToBlob(combinedBlob, {
    title: article.title,
    artist: "Curio Garden",
    album: albumTitle,
    artwork,
  });

  return {
    blob: taggedBlob,
    byteLength: taggedBlob.size,
    durationSeconds: estimateDurationSeconds(sections.map((section) => section.text)),
    sectionCount: sections.length,
    generatedSectionCount,
    reusedSectionCount,
  };
};
