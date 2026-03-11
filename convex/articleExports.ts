import { v } from "convex/values";
import { api, internal } from "./_generated/api";
import { type Id } from "./_generated/dataModel";
import {
  internalAction,
  internalMutation,
  internalQuery,
  mutation,
  query,
} from "./_generated/server";
import { addMp3MetadataToBlob } from "../lib/audio-metadata";
import {
  getServerTtsMaxWordsPerRequest,
  TTS_API_ROUTE,
  TTS_MIN_TEXT_LENGTH,
} from "../lib/tts-contract";
import { normalizeTtsText, TTS_NORM_VERSION } from "../lib/tts-normalize";
import { titleToSlug } from "./lib/wikipedia";
import { hasFullAudio, type AudioMode, type AudioReason } from "../lib/audio-suitability";

const MIN_TTS_TEXT_LENGTH = 10;
const TTS_WORDS_PER_SECOND = 2.5;
type TtsRequest = {
  text: string;
  voiceId?: string;
};

type ArticleExportStage = "queued" | "rendering_audio" | "packaging";

type ArticleExportSource = {
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

type ArticleExportSection = {
  sectionKey: string;
  text: string;
};

export const getArticleExportSections = (
  article: ArticleExportSource,
): ArticleExportSection[] => {
  const sections: ArticleExportSection[] = [];

  if ((article.summary ?? "").length >= MIN_TTS_TEXT_LENGTH) {
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

const estimateDurationSeconds = (text: string): number =>
  Math.round(text.split(/\s+/).filter(Boolean).length / TTS_WORDS_PER_SECOND);

const countWords = (text: string): number =>
  text.split(/\s+/).filter(Boolean).length;

const resolveTtsApiRoute = (apiBaseUrl?: string): string =>
  apiBaseUrl ? new URL(TTS_API_ROUTE, apiBaseUrl).toString() : TTS_API_ROUTE;

const splitIntoParagraphs = (text: string): string[] =>
  text
    .split(/\n\s*\n+/)
    .map((part) => part.trim())
    .filter(Boolean);

const splitIntoSentences = (text: string): string[] => {
  const matches = text.match(/[^.!?]+(?:[.!?]+|$)/g);
  if (!matches) return [text.trim()].filter(Boolean);
  return matches.map((part) => part.trim()).filter(Boolean);
};

const splitIntoWordChunks = (
  text: string,
  maxWords = getServerTtsMaxWordsPerRequest(),
): string[] => {
  const words = text.split(/\s+/).filter(Boolean);
  const chunks: string[] = [];

  for (let index = 0; index < words.length; index += maxWords) {
    chunks.push(words.slice(index, index + maxWords).join(" "));
  }

  return chunks;
};

const packSegments = (
  segments: string[],
  maxWords = getServerTtsMaxWordsPerRequest(),
): string[] => {
  const chunks: string[] = [];
  let current = "";
  let currentWords = 0;

  for (const segment of segments) {
    const trimmed = segment.trim();
    if (!trimmed) continue;

    const words = countWords(trimmed);
    if (words > maxWords) {
      throw new Error("Segment exceeded TTS chunk limit during packing");
    }

    if (currentWords > 0 && currentWords + words > maxWords) {
      chunks.push(current);
      current = trimmed;
      currentWords = words;
      continue;
    }

    current = current ? `${current} ${trimmed}` : trimmed;
    currentWords += words;
  }

  if (current) chunks.push(current);

  return chunks;
};

const splitLongParagraph = (
  paragraph: string,
  maxWords = getServerTtsMaxWordsPerRequest(),
): string[] => {
  if (countWords(paragraph) <= maxWords) return [paragraph];

  const sentences = splitIntoSentences(paragraph);
  if (sentences.length > 1) {
    return packSegments(
      sentences.flatMap((sentence) =>
        countWords(sentence) <= maxWords
          ? [sentence]
          : splitIntoWordChunks(sentence, maxWords),
      ),
      maxWords,
    );
  }

  return splitIntoWordChunks(paragraph, maxWords);
};

const splitTtsTextIntoChunks = (
  text: string,
  maxWords = getServerTtsMaxWordsPerRequest(),
): string[] => {
  const normalized = normalizeTtsText(text).trim();
  if (!normalized) return [];

  const paragraphs = splitIntoParagraphs(normalized);
  if (paragraphs.length > 1) {
    return packSegments(
      paragraphs.flatMap((paragraph) => splitLongParagraph(paragraph, maxWords)),
      maxWords,
    );
  }

  return splitLongParagraph(normalized, maxWords);
};

const fetchSingleTtsAudio = async (
  { text, voiceId }: TtsRequest,
  apiBaseUrl?: string,
): Promise<Blob> => {
  const response = await fetch(resolveTtsApiRoute(apiBaseUrl), {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      text,
      ...(voiceId ? { voiceId } : {}),
    }),
  });

  if (!response.ok) {
    const body = (await response.json().catch(() => ({}))) as {
      error?: string;
    };
    throw new Error(body.error ?? "Audio generation failed");
  }

  return await response.blob();
};

const generateTtsAudio = async (
  { text, voiceId }: TtsRequest,
  apiBaseUrl?: string,
): Promise<Blob> => {
  const chunks = splitTtsTextIntoChunks(text);
  const joinedText = chunks.join(" ");

  if (!joinedText || joinedText.length < TTS_MIN_TEXT_LENGTH) {
    throw new Error("Text is too short to generate audio");
  }

  const audioChunks: Blob[] = [];
  for (const chunk of chunks) {
    audioChunks.push(await fetchSingleTtsAudio({ text: chunk, voiceId }, apiBaseUrl));
  }

  return audioChunks.length === 1
    ? audioChunks[0]
    : new Blob(audioChunks, { type: "audio/mpeg" });
};

const fetchBlobFromUrl = async (url: string): Promise<Blob> => {
  const response = await fetch(url, { cache: "no-store" });
  if (!response.ok) {
    throw new Error(`Fetching cached audio failed: ${response.status}`);
  }
  return await response.blob();
};

const fetchArticleArtwork = async ({
  baseUrl,
  slug,
  title,
}: {
  baseUrl: string;
  slug: string;
  title: string;
}) => {
  try {
    const response = await fetch(
      `${baseUrl}/api/article/${encodeURIComponent(slug)}/artwork`,
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

const withStorageUrl = async <
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

export const getRecentArticleAudioExports = query({
  args: {
    clientId: v.string(),
    limit: v.optional(v.number()),
  },
  async handler(ctx, args) {
    const limit = Math.max(1, Math.min(args.limit ?? 4, 10));
    const records = await ctx.db
      .query("articleAudioExports")
      .withIndex("by_clientId", (q) => q.eq("clientId", args.clientId))
      .collect();

    const filtered = records
      .filter((record) => record.dismissedAt == null)
      .sort((a, b) => b.updatedAt - a.updatedAt)
      .slice(0, limit);

    return await Promise.all(filtered.map((record) => withStorageUrl(ctx, record)));
  },
});

export const getArticleAudioExportById = query({
  args: {
    exportId: v.id("articleAudioExports"),
  },
  async handler(ctx, args) {
    const record = await ctx.db.get(args.exportId);
    return record ? await withStorageUrl(ctx, record) : null;
  },
});

export const startArticleAudioExport = mutation({
  args: {
    clientId: v.string(),
    articleId: v.id("articles"),
    baseUrl: v.string(),
  },
  async handler(ctx, args) {
    const article = await ctx.db.get(args.articleId);
    if (!article) {
      throw new Error("Article not found");
    }

    const existing = (
      await ctx.db
        .query("articleAudioExports")
        .withIndex("by_clientId_articleId", (q) =>
          q.eq("clientId", args.clientId).eq("articleId", args.articleId),
        )
        .collect()
    )
      .filter((record) => record.dismissedAt == null)
      .sort((a, b) => b.updatedAt - a.updatedAt)[0];

    if (
      existing &&
      (existing.status === "queued" ||
        existing.status === "running" ||
        existing.status === "ready")
    ) {
      return {
        exportId: existing._id,
        status: existing.status,
        reused: true,
      };
    }

    const sectionCount = getArticleExportSections({
      _id: article._id,
      title: article.title,
      slug: article.slug,
      summary: article.summary,
      thumbnailUrl: article.thumbnailUrl,
      sections: article.sections,
    }).length;

    const now = Date.now();
    const exportId = await ctx.db.insert("articleAudioExports", {
      clientId: args.clientId,
      articleId: args.articleId,
      slug: article.slug ?? titleToSlug(article.title),
      title: article.title,
      status: sectionCount > 0 ? "queued" : "failed",
      stage: sectionCount > 0 ? "queued" : undefined,
      sectionCount,
      completedSectionCount: 0,
      lastError:
        sectionCount > 0
          ? undefined
          : "Article does not contain any audio-suitable sections.",
      createdAt: now,
      updatedAt: now,
    });

    if (sectionCount > 0) {
      await ctx.scheduler.runAfter(
        0,
        internal.articleExports.processArticleAudioExport,
        {
          exportId,
          baseUrl: args.baseUrl,
        },
      );
    }

    return {
      exportId,
      status: sectionCount > 0 ? "queued" : "failed",
      reused: false,
    };
  },
});

export const dismissArticleAudioExport = mutation({
  args: {
    exportId: v.id("articleAudioExports"),
    clientId: v.string(),
  },
  async handler(ctx, args) {
    const record = await ctx.db.get(args.exportId);
    if (!record || record.clientId !== args.clientId) {
      return { dismissed: false };
    }

    await ctx.db.patch(args.exportId, {
      dismissedAt: Date.now(),
      updatedAt: Date.now(),
    });

    return { dismissed: true };
  },
});

export const getArticleExportSource = internalQuery({
  args: {
    articleId: v.id("articles"),
  },
  async handler(ctx, args) {
    return (await ctx.db.get(args.articleId)) as ArticleExportSource | null;
  },
});

export const getArticleAudioExportInternal = internalQuery({
  args: {
    exportId: v.id("articleAudioExports"),
  },
  async handler(ctx, args) {
    return await ctx.db.get(args.exportId);
  },
});

export const getNextQueuedArticleAudioExportForClient = internalQuery({
  args: {
    clientId: v.string(),
    excludeExportId: v.optional(v.id("articleAudioExports")),
  },
  async handler(ctx, args) {
    const records = await ctx.db
      .query("articleAudioExports")
      .withIndex("by_clientId", (q) => q.eq("clientId", args.clientId))
      .collect();

    return records
      .filter(
        (record) =>
          record._id !== args.excludeExportId &&
          record.dismissedAt == null &&
          record.status === "queued",
      )
      .sort((a, b) => a.createdAt - b.createdAt)[0] ?? null;
  },
});

export const markArticleAudioExportRunning = internalMutation({
  args: {
    exportId: v.id("articleAudioExports"),
    sectionCount: v.number(),
  },
  async handler(ctx, args) {
    const record = await ctx.db.get(args.exportId);
    if (
      !record ||
      record.dismissedAt != null ||
      record.status === "ready" ||
      record.status === "failed" ||
      record.status === "running"
    ) {
      return { claimed: false };
    }

    const clientRecords = await ctx.db
      .query("articleAudioExports")
      .withIndex("by_clientId", (q) => q.eq("clientId", record.clientId))
      .collect();
    const otherRunningRecord = clientRecords.find(
      (candidate) =>
        candidate._id !== args.exportId &&
        candidate.dismissedAt == null &&
        candidate.status === "running",
    );

    if (otherRunningRecord) {
      return { claimed: false };
    }

    await ctx.db.patch(args.exportId, {
      status: "running",
      stage: "rendering_audio",
      sectionCount: args.sectionCount,
      completedSectionCount: 0,
      lastError: undefined,
      updatedAt: Date.now(),
    });

    return { claimed: true };
  },
});

export const updateArticleAudioExportProgress = internalMutation({
  args: {
    exportId: v.id("articleAudioExports"),
    completedSectionCount: v.number(),
    stage: v.union(
      v.literal("queued"),
      v.literal("rendering_audio"),
      v.literal("packaging"),
    ),
  },
  async handler(ctx, args) {
    await ctx.db.patch(args.exportId, {
      status: "running",
      stage: args.stage,
      completedSectionCount: args.completedSectionCount,
      updatedAt: Date.now(),
    });
  },
});

export const completeArticleAudioExport = internalMutation({
  args: {
    exportId: v.id("articleAudioExports"),
    storageId: v.id("_storage"),
    byteLength: v.number(),
  },
  async handler(ctx, args) {
    const record = await ctx.db.get(args.exportId);
    if (!record) return;

    await ctx.db.patch(args.exportId, {
      status: "ready",
      stage: undefined,
      storageId: args.storageId,
      byteLength: args.byteLength,
      completedSectionCount: record.sectionCount,
      updatedAt: Date.now(),
    });
  },
});

export const failArticleAudioExport = internalMutation({
  args: {
    exportId: v.id("articleAudioExports"),
    lastError: v.string(),
  },
  async handler(ctx, args) {
    await ctx.db.patch(args.exportId, {
      status: "failed",
      stage: undefined,
      lastError: args.lastError,
      updatedAt: Date.now(),
    });
  },
});

export const processArticleAudioExport = internalAction({
  args: {
    exportId: v.id("articleAudioExports"),
    baseUrl: v.string(),
  },
  async handler(ctx, args) {
    const scheduleNextQueuedExport = async (clientId: string) => {
      const nextQueued = await ctx.runQuery(
        internal.articleExports.getNextQueuedArticleAudioExportForClient,
        {
          clientId,
          excludeExportId: args.exportId,
        },
      );

      if (!nextQueued) return;

      await ctx.scheduler.runAfter(0, internal.articleExports.processArticleAudioExport, {
        exportId: nextQueued._id,
        baseUrl: args.baseUrl,
      });
    };

    const record = await ctx.runQuery(
      internal.articleExports.getArticleAudioExportInternal,
      {
        exportId: args.exportId,
      },
    );

    if (!record || record.dismissedAt != null || record.status === "ready") {
      return;
    }

    const article = await ctx.runQuery(internal.articleExports.getArticleExportSource, {
      articleId: record.articleId,
    });

    if (!article) {
      await ctx.runMutation(internal.articleExports.failArticleAudioExport, {
        exportId: args.exportId,
        lastError: "Article not found.",
      });
      await scheduleNextQueuedExport(record.clientId);
      return;
    }

    const sections = getArticleExportSections(article);
    if (sections.length === 0) {
      await ctx.runMutation(internal.articleExports.failArticleAudioExport, {
        exportId: args.exportId,
        lastError: "Article does not contain any audio-suitable sections.",
      });
      await scheduleNextQueuedExport(record.clientId);
      return;
    }

    const claim = await ctx.runMutation(internal.articleExports.markArticleAudioExportRunning, {
      exportId: args.exportId,
      sectionCount: sections.length,
    });
    if (!claim.claimed) {
      return;
    }

    try {
      const cachedAudio = await ctx.runQuery(api.audio.getAllSectionAudio, {
        articleId: article._id,
        ttsNormVersion: TTS_NORM_VERSION,
      });

      const audioChunks: Blob[] = [];

      for (let index = 0; index < sections.length; index += 1) {
        const section = sections[index];
        let blob: Blob | null = null;
        const cachedUrl = cachedAudio.urls[section.sectionKey];

        if (cachedUrl) {
          try {
            blob = await fetchBlobFromUrl(cachedUrl);
          } catch {
            blob = null;
          }
        }

        if (!blob) {
          blob = await generateTtsAudio({ text: section.text }, args.baseUrl);

          const storageId = await ctx.storage.store(blob);

          await ctx.runMutation(api.audio.saveSectionAudioRecord, {
            articleId: article._id,
            sectionKey: section.sectionKey,
            storageId,
            ttsNormVersion: TTS_NORM_VERSION,
            durationSeconds: estimateDurationSeconds(section.text),
          });
        }

        audioChunks.push(blob);

        await ctx.runMutation(
          internal.articleExports.updateArticleAudioExportProgress,
          {
            exportId: args.exportId,
            completedSectionCount: index + 1,
            stage: "rendering_audio" satisfies ArticleExportStage,
          },
        );
      }

      await ctx.runMutation(internal.articleExports.updateArticleAudioExportProgress, {
        exportId: args.exportId,
        completedSectionCount: sections.length,
        stage: "packaging",
      });

      const combinedBlob = new Blob(audioChunks, { type: "audio/mpeg" });
      const artwork = await fetchArticleArtwork({
        baseUrl: args.baseUrl,
        slug: record.slug,
        title: record.title,
      });
      const taggedBlob = await addMp3MetadataToBlob(combinedBlob, {
        title: record.title,
        artist: "Curio Garden",
        album: "Curio Garden Article Audio",
        artwork,
      });

      const storageId = await ctx.storage.store(taggedBlob);

      await ctx.runMutation(internal.articleExports.completeArticleAudioExport, {
        exportId: args.exportId,
        storageId,
        byteLength: taggedBlob.size,
      });
      await scheduleNextQueuedExport(record.clientId);
    } catch (error) {
      await ctx.runMutation(internal.articleExports.failArticleAudioExport, {
        exportId: args.exportId,
        lastError:
          error instanceof Error
            ? error.message
            : "Article audio export failed.",
      });
      await scheduleNextQueuedExport(record.clientId);
    }
  },
});
