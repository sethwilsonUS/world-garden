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
import { TTS_NORM_VERSION } from "../lib/tts-normalize";
import { titleToSlug } from "./lib/wikipedia";
import {
  assembleArticleAudio,
  getArticleAudioSections,
  type ArticleAudioSource,
} from "./lib/articleAudioPipeline";
import { uploadBlobToConvexStorage, uploadStreamToConvexStorage } from "./lib/storageUpload";

type ArticleExportStage = "queued" | "rendering_audio" | "packaging";

type ArticleExportSource = ArticleAudioSource;

export const getArticleExportSections = getArticleAudioSections;

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
      const result = await assembleArticleAudio({
        article: {
          ...article,
          slug: article.slug ?? record.slug,
        },
        albumTitle: "Curio Garden Article Audio",
        baseUrl: args.baseUrl,
        getCachedSectionAudioUrls: async () => {
          const cachedAudio = await ctx.runQuery(api.audio.getAllSectionAudio, {
            articleId: article._id,
            ttsNormVersion: TTS_NORM_VERSION,
          });
          return cachedAudio.urls;
        },
        saveSectionAudio: async ({ sectionKey, blob, durationSeconds }) => {
          const uploadUrl = await ctx.runMutation(api.audio.generateUploadUrl, {});
          const storageId = await uploadBlobToConvexStorage(uploadUrl, blob);
          await ctx.runMutation(api.audio.saveSectionAudioRecord, {
            articleId: article._id,
            sectionKey,
            storageId,
            ttsNormVersion: TTS_NORM_VERSION,
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
        onProgress: async ({ completedSectionCount, stage }) => {
          await ctx.runMutation(
            internal.articleExports.updateArticleAudioExportProgress,
            {
              exportId: args.exportId,
              completedSectionCount,
              stage: stage satisfies ArticleExportStage,
            },
          );
        },
      });

      await ctx.runMutation(internal.articleExports.completeArticleAudioExport, {
        exportId: args.exportId,
        storageId: result.storageId,
        byteLength: result.byteLength,
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
