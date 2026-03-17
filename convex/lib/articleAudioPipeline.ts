import { type Id } from "../_generated/dataModel";
import { titleToSlug } from "./wikipedia";
import { addMp3MetadataToBlob } from "../../lib/audio-metadata";
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

export type AssembleArticleAudioArgs<TStorageId = string> = {
  article: ArticleAudioSource;
  albumTitle: string;
  baseUrl: string;
  getCachedSectionAudioUrls: () => Promise<Record<string, string | null | undefined>>;
  saveSectionAudio: (args: {
    sectionKey: string;
    blob: Blob;
    durationSeconds: number;
  }) => Promise<string>;
  saveCombinedAudio: (args: {
    stream: ReadableStream<Uint8Array>;
    contentType: string;
  }) => Promise<{
    storageId: TStorageId;
    byteLength: number;
  }>;
  onProgress?: (args: {
    completedSectionCount: number;
    sectionCount: number;
    stage: "rendering_audio" | "packaging";
  }) => Promise<void> | void;
};

export type AssembleArticleAudioResult<TStorageId = string> = {
  storageId: TStorageId;
  byteLength: number;
  durationSeconds: number;
  sectionCount: number;
  generatedSectionCount: number;
  reusedSectionCount: number;
};

const countWords = (text: string): number =>
  text.split(/\s+/).filter(Boolean).length;

const getErrorMessage = (error: unknown): string =>
  error instanceof Error ? error.message : "Unknown error";

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

const verifyBlobUrlAccessible = async (url: string): Promise<void> => {
  const response = await fetch(url, { cache: "no-store" });
  if (!response.ok) {
    throw new Error(`Fetching cached audio failed: ${response.status}`);
  }

  await response.body?.cancel();
};

const pipeStreamToController = async (
  stream: ReadableStream<Uint8Array>,
  controller: ReadableStreamDefaultController<Uint8Array>,
): Promise<void> => {
  const reader = stream.getReader();

  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) return;
      if (value) controller.enqueue(value);
    }
  } finally {
    reader.releaseLock();
  }
};

const createArticleAudioStream = async ({
  sectionAudioUrls,
  metadata,
}: {
  sectionAudioUrls: string[];
  metadata: {
    title: string;
    artist: string;
    album: string;
    artwork?: {
      data: Uint8Array;
      mimeType: string;
      description?: string;
    };
  };
}): Promise<ReadableStream<Uint8Array>> => {
  const metadataBlob = await addMp3MetadataToBlob(
    new Blob([], { type: "audio/mpeg" }),
    metadata,
    {
      stripExistingId3Tags: false,
    },
  );

  return new ReadableStream<Uint8Array>({
    async start(controller) {
      try {
        await pipeStreamToController(metadataBlob.stream(), controller);

        for (const sectionAudioUrl of sectionAudioUrls) {
          const response = await fetch(sectionAudioUrl, { cache: "no-store" });
          if (!response.ok || !response.body) {
            throw new Error(`Fetching section audio failed: ${response.status}`);
          }

          await pipeStreamToController(response.body, controller);
        }

        controller.close();
      } catch (error) {
        controller.error(error);
      }
    },
  });
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

export const assembleArticleAudio = async <TStorageId = string>({
  article,
  albumTitle,
  baseUrl,
  getCachedSectionAudioUrls,
  saveSectionAudio,
  saveCombinedAudio,
  onProgress,
}: AssembleArticleAudioArgs<TStorageId>): Promise<AssembleArticleAudioResult<TStorageId>> => {
  const sections = getArticleAudioSections(article);
  if (sections.length === 0) {
    throw new Error("Article does not contain any audio-suitable sections.");
  }

  const cachedUrls = await getCachedSectionAudioUrls();
  const sectionAudioUrls: string[] = [];
  let generatedSectionCount = 0;
  let reusedSectionCount = 0;

  for (let index = 0; index < sections.length; index += 1) {
    const section = sections[index];
    let sectionAudioUrl: string | null = null;
    const cachedUrl = cachedUrls[section.sectionKey]?.trim() || null;

    if (cachedUrl) {
      try {
        await verifyBlobUrlAccessible(cachedUrl);
        sectionAudioUrl = cachedUrl;
        reusedSectionCount += 1;
      } catch {
        sectionAudioUrl = null;
      }
    }

    if (!sectionAudioUrl) {
      let blob: Blob;
      try {
        blob = await generateTtsAudio(
          { text: section.text },
          { apiBaseUrl: baseUrl },
        );
      } catch (error) {
        throw new Error(
          `Generating audio for ${section.sectionKey} failed: ${getErrorMessage(error)}`,
        );
      }
      generatedSectionCount += 1;

      try {
        sectionAudioUrl = await saveSectionAudio({
          sectionKey: section.sectionKey,
          blob,
          durationSeconds: estimateDurationSeconds(section.text),
        });
      } catch (error) {
        throw new Error(
          `Saving audio for ${section.sectionKey} failed: ${getErrorMessage(error)}`,
        );
      }
    }

    sectionAudioUrls.push(sectionAudioUrl);

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

  const artwork = await fetchArticleArtwork({
    baseUrl,
    slug: article.slug,
    title: article.title,
  });
  let combinedAudio: {
    storageId: TStorageId;
    byteLength: number;
  };
  try {
    const stream = await createArticleAudioStream({
      sectionAudioUrls,
      metadata: {
        title: article.title,
        artist: "Curio Garden",
        album: albumTitle,
        artwork,
      },
    });
    combinedAudio = await saveCombinedAudio({
      stream,
      contentType: "audio/mpeg",
    });
  } catch (error) {
    throw new Error(`Packaging combined audio failed: ${getErrorMessage(error)}`);
  }

  return {
    storageId: combinedAudio.storageId,
    byteLength: combinedAudio.byteLength,
    durationSeconds: estimateDurationSeconds(sections.map((section) => section.text)),
    sectionCount: sections.length,
    generatedSectionCount,
    reusedSectionCount,
  };
};
