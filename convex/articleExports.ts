import { v } from "convex/values";
import { internal } from "./_generated/api";
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
import {
  uploadBlobToConvexStorage,
  uploadStreamToConvexStorage,
} from "./lib/storageUpload";
import {
  getTtsMetadata,
  getTtsProfile,
  isTtsMetadataValid,
  type TtsMetadata,
  type TtsProvider,
} from "../lib/tts-profile";
import { buildArticleNarrationHash } from "../lib/section-narration";
import { getAudioGenerationBaseUrl } from "../lib/audio-generation-url";

type ArticleExportStage = "queued" | "rendering_audio" | "packaging";

type ArticleExportSource = ArticleAudioSource;
export const MAX_RECENT_EXPORT_CANDIDATES = 50;
const DEFAULT_RECENT_ARTICLE_AUDIO_EXPORT_LIMIT = 4;
const MAX_RECENT_ARTICLE_AUDIO_EXPORT_LIMIT = 10;
const DEFAULT_OPENAI_EXPORT_DAILY_LIMIT = 5;
const DEFAULT_OPENAI_EXPORT_DAILY_WINDOW_MS = 24 * 60 * 60 * 1000;

const ttsMetadataValidator = v.object({
  provider: v.union(v.literal("openai"), v.literal("edge")),
  model: v.string(),
  voiceId: v.string(),
  promptVersion: v.string(),
  ttsNormVersion: v.string(),
  ttsCacheKey: v.string(),
});

export const isRequestedTtsMetadataValid = (metadata: TtsMetadata): boolean =>
  isTtsMetadataValid(metadata);

export const normalizeRecentArticleAudioExportLimit = (
  value?: number,
): number => {
  if (value === undefined || !Number.isFinite(value)) {
    return DEFAULT_RECENT_ARTICLE_AUDIO_EXPORT_LIMIT;
  }
  return Math.max(
    1,
    Math.min(Math.trunc(value), MAX_RECENT_ARTICLE_AUDIO_EXPORT_LIMIT),
  );
};

export const resolveRequestedArticleExportTtsMetadata = (
  metadata: TtsMetadata | undefined,
  preferredProvider?: TtsProvider,
): TtsMetadata =>
  metadata && isTtsMetadataValid(metadata)
    ? metadata
    : getTtsMetadata(getTtsProfile(preferredProvider));

type ArticleAudioExportQueueRecord = {
  clientId: string;
  queueKey?: string;
  ttsProvider?: string;
  ownerTokenIdentifier?: string;
};

type ArticleAudioExportQuotaRecord = {
  count: number;
  windowStart: number;
  expiresAt: number;
};

type ArticleAudioExportQuotaDecision = {
  allowed: boolean;
  nextCount: number;
  windowStart: number;
  expiresAt: number;
  remaining: number;
};

const readPositiveInteger = (
  environment: Record<string, string | undefined>,
  name: string,
  fallback: number,
): number => {
  const parsed = Number.parseInt(environment[name] ?? "", 10);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
};

export const getArticleAudioExportQuotaConfig = (
  environment: Record<string, string | undefined> = process.env,
) => ({
  dailyLimit: readPositiveInteger(
    environment,
    "ARTICLE_AUDIO_EXPORT_OPENAI_DAILY_LIMIT",
    DEFAULT_OPENAI_EXPORT_DAILY_LIMIT,
  ),
  dailyWindowMs: readPositiveInteger(
    environment,
    "ARTICLE_AUDIO_EXPORT_OPENAI_DAILY_WINDOW_MS",
    DEFAULT_OPENAI_EXPORT_DAILY_WINDOW_MS,
  ),
});

export const evaluateArticleAudioExportAllowance = ({
  existing,
  now,
  limit,
  windowMs,
}: {
  existing: ArticleAudioExportQuotaRecord | null;
  now: number;
  limit: number;
  windowMs: number;
}): ArticleAudioExportQuotaDecision => {
  if (!existing || existing.expiresAt <= now) {
    return {
      allowed: true,
      nextCount: 1,
      windowStart: now,
      expiresAt: now + windowMs,
      remaining: Math.max(0, limit - 1),
    };
  }

  if (existing.count >= limit) {
    return {
      allowed: false,
      nextCount: existing.count,
      windowStart: existing.windowStart,
      expiresAt: existing.expiresAt,
      remaining: 0,
    };
  }

  const nextCount = existing.count + 1;
  return {
    allowed: true,
    nextCount,
    windowStart: existing.windowStart,
    expiresAt: existing.expiresAt,
    remaining: Math.max(0, limit - nextCount),
  };
};

export const getArticleAudioExportQueueKey = ({
  clientId,
  ttsProvider,
  ownerTokenIdentifier,
}: ArticleAudioExportQueueRecord): string =>
  ttsProvider === "openai" && ownerTokenIdentifier
    ? `owner:${ownerTokenIdentifier}`
    : `client:${clientId}`;

export const resolveArticleAudioExportBaseUrl = (
  configuredBaseUrl: string,
  legacyRequestedBaseUrl?: string,
): string => {
  void legacyRequestedBaseUrl;
  return configuredBaseUrl;
};

const getArticleAudioExportQuotaKey = (ownerTokenIdentifier: string): string =>
  `article-audio-export:openai:daily:${ownerTokenIdentifier}`;

type ArticleAudioExportAccessRecord = {
  ttsProvider?: string;
  ttsCacheKey?: string;
  ownerTokenIdentifier?: string;
};

export const getArticleAudioExportProvider = (
  isAuthenticated: boolean,
): TtsProvider => (isAuthenticated ? "openai" : "edge");

export const canAccessArticleAudioExport = (
  record: ArticleAudioExportAccessRecord,
  viewerTokenIdentifier: string | null,
): boolean => {
  if (record.ttsProvider === "edge") return true;
  if (!viewerTokenIdentifier) return false;
  return (
    record.ownerTokenIdentifier == null ||
    record.ownerTokenIdentifier === viewerTokenIdentifier
  );
};

export const selectAccessibleArticleAudioExportCandidates = <
  TRecord extends ArticleAudioExportAccessRecord & {
    dismissedAt?: number;
    updatedAt: number;
  },
>(
  records: TRecord[],
  viewerTokenIdentifier: string | null,
  limit: number,
): TRecord[] =>
  records
    .filter(
      (record) =>
        record.dismissedAt == null &&
        canAccessArticleAudioExport(record, viewerTokenIdentifier),
    )
    .sort((a, b) => b.updatedAt - a.updatedAt)
    .slice(0, Math.max(0, limit));

export const getArticleExportSections = getArticleAudioSections;

type ReusableArticleAudioExport = {
  status: string;
  updatedAt: number;
  dismissedAt?: number;
  producedTtsCacheKey?: string;
  ttsCacheKey?: string;
  narrationHash?: string;
};

type ArticleAudioExportIdentity = Pick<
  ReusableArticleAudioExport,
  "narrationHash" | "ttsCacheKey"
>;

export const isArticleAudioExportCompatible = (
  record: ArticleAudioExportIdentity,
  ttsCacheKey: string,
  narrationHash: string,
): boolean =>
  record.narrationHash === narrationHash && record.ttsCacheKey === ttsCacheKey;

export const isArticleAudioExportReusable = (
  record: ReusableArticleAudioExport,
  ttsCacheKey: string,
  narrationHash: string,
): boolean =>
  isArticleAudioExportCompatible(record, ttsCacheKey, narrationHash) &&
  (record.status !== "ready" ||
    (record.producedTtsCacheKey ?? record.ttsCacheKey) === ttsCacheKey);

export const findReusableArticleAudioExport = <
  TRecord extends ReusableArticleAudioExport,
>(
  records: TRecord[],
  ttsCacheKey: string,
  narrationHash: string,
): TRecord | undefined =>
  records
    .filter(
      (record) =>
        record.dismissedAt == null &&
        isArticleAudioExportReusable(record, ttsCacheKey, narrationHash) &&
        (record.status === "queued" ||
          record.status === "running" ||
          record.status === "ready"),
    )
    .sort((a, b) => b.updatedAt - a.updatedAt)[0];

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
    ttsCacheKey: v.optional(v.string()),
  },
  async handler(ctx, args) {
    const limit = normalizeRecentArticleAudioExportLimit(args.limit);
    const identity = await ctx.auth.getUserIdentity();
    const viewerTokenIdentifier = identity?.tokenIdentifier ?? null;
    const records = await ctx.db
      .query("articleAudioExports")
      .withIndex("by_clientId_updatedAt", (q) =>
        q.eq("clientId", args.clientId),
      )
      .filter((q) => q.eq(q.field("dismissedAt"), undefined))
      .filter((q) =>
        viewerTokenIdentifier
          ? q.or(
              q.eq(q.field("ttsProvider"), "edge"),
              q.eq(q.field("ownerTokenIdentifier"), viewerTokenIdentifier),
              q.eq(q.field("ownerTokenIdentifier"), undefined),
            )
          : q.eq(q.field("ttsProvider"), "edge"),
      )
      .order("desc")
      .take(MAX_RECENT_EXPORT_CANDIDATES);
    const accessibleRecords = selectAccessibleArticleAudioExportCandidates(
      records,
      viewerTokenIdentifier,
      MAX_RECENT_EXPORT_CANDIDATES,
    );
    const compatibleRecords = [];

    for (const record of accessibleRecords) {
      // Keep this guard even though the database filter normally removes the
      // row. It prevents an expensive article read if a mocked or future
      // query implementation returns a dismissed record.
      if (record.dismissedAt != null) continue;
      const article = await ctx.db.get(record.articleId);
      if (
        article &&
        (args.ttsCacheKey !== undefined
          ? isArticleAudioExportCompatible(
              record,
              args.ttsCacheKey,
              buildArticleNarrationHash(article),
            )
          : record.narrationHash === buildArticleNarrationHash(article))
      ) {
        compatibleRecords.push(record);
        if (compatibleRecords.length >= limit) break;
      }
    }

    return await Promise.all(
      compatibleRecords
        .slice(0, limit)
        .map((record) => withStorageUrl(ctx, record)),
    );
  },
});

export const getArticleAudioExportById = query({
  args: {
    exportId: v.id("articleAudioExports"),
    ttsCacheKey: v.string(),
  },
  async handler(ctx, args) {
    const record = await ctx.db.get(args.exportId);
    if (!record) return null;
    const identity = await ctx.auth.getUserIdentity();
    if (
      !canAccessArticleAudioExport(record, identity?.tokenIdentifier ?? null)
    ) {
      return null;
    }
    const article = await ctx.db.get(record.articleId);
    if (
      !article ||
      !isArticleAudioExportCompatible(
        record,
        args.ttsCacheKey,
        buildArticleNarrationHash(article),
      )
    ) {
      return null;
    }
    return await withStorageUrl(ctx, record);
  },
});

export const getArticleAudioExportDownloadIdentity = query({
  args: {
    exportId: v.string(),
  },
  async handler(ctx, args) {
    const exportId = ctx.db.normalizeId("articleAudioExports", args.exportId);
    if (!exportId) return null;

    const record = await ctx.db.get(exportId);
    if (
      !record ||
      record.status !== "ready" ||
      !record.storageId ||
      !record.ttsCacheKey
    ) {
      return null;
    }
    const article = await ctx.db.get(record.articleId);
    if (
      !article ||
      record.narrationHash !== buildArticleNarrationHash(article)
    ) {
      return null;
    }
    return { exportId: record._id, ttsCacheKey: record.ttsCacheKey };
  },
});

export const startArticleAudioExport = mutation({
  args: {
    clientId: v.string(),
    articleId: v.id("articles"),
  },
  async handler(ctx, args) {
    const article = await ctx.db.get(args.articleId);
    if (!article) {
      throw new Error("Article not found");
    }

    const identity = await ctx.auth.getUserIdentity();
    const ownerTokenIdentifier = identity?.tokenIdentifier.trim() || undefined;
    const ttsProvider = getArticleAudioExportProvider(
      ownerTokenIdentifier != null,
    );
    const queueKey = getArticleAudioExportQueueKey({
      clientId: args.clientId,
      ttsProvider,
      ownerTokenIdentifier,
    });
    const requestedTtsMetadata = getTtsMetadata(getTtsProfile(ttsProvider));
    const activeTtsCacheKey = requestedTtsMetadata.ttsCacheKey;
    const narrationHash = buildArticleNarrationHash(article);
    const existing = findReusableArticleAudioExport(
      await ctx.db
        .query("articleAudioExports")
        .withIndex("by_clientId_articleId", (q) =>
          q.eq("clientId", args.clientId).eq("articleId", args.articleId),
        )
        .collect()
        .then((records) =>
          records.filter(
            (record) =>
              record.ttsProvider === ttsProvider &&
              canAccessArticleAudioExport(record, ownerTokenIdentifier ?? null),
          ),
        ),
      activeTtsCacheKey,
      narrationHash,
    );

    if (existing) {
      return {
        exportId: existing._id,
        status: existing.status,
        ttsProvider,
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
    if (sectionCount > 0 && ttsProvider === "openai" && ownerTokenIdentifier) {
      const quotaConfig = getArticleAudioExportQuotaConfig();
      const quotaKey = getArticleAudioExportQuotaKey(ownerTokenIdentifier);
      const existingQuota = await ctx.db
        .query("routeQuotas")
        .withIndex("by_key", (q) => q.eq("key", quotaKey))
        .first();
      const quotaDecision = evaluateArticleAudioExportAllowance({
        existing: existingQuota,
        now,
        limit: quotaConfig.dailyLimit,
        windowMs: quotaConfig.dailyWindowMs,
      });

      if (!quotaDecision.allowed) {
        throw new Error(
          `AI article audio export limit reached. Try again after ${new Date(
            quotaDecision.expiresAt,
          ).toISOString()}.`,
        );
      }

      const quotaPayload = {
        key: quotaKey,
        count: quotaDecision.nextCount,
        windowStart: quotaDecision.windowStart,
        expiresAt: quotaDecision.expiresAt,
        updatedAt: now,
      };
      if (existingQuota) {
        await ctx.db.patch(existingQuota._id, quotaPayload);
      } else {
        await ctx.db.insert("routeQuotas", {
          ...quotaPayload,
          createdAt: now,
        });
      }
    }

    const exportId = await ctx.db.insert("articleAudioExports", {
      clientId: args.clientId,
      articleId: args.articleId,
      slug: article.slug ?? titleToSlug(article.title),
      title: article.title,
      status: sectionCount > 0 ? "queued" : "failed",
      stage: sectionCount > 0 ? "queued" : undefined,
      sectionCount,
      completedSectionCount: 0,
      narrationHash,
      requestedTtsMetadata,
      ttsCacheKey: activeTtsCacheKey,
      ttsProvider,
      ownerTokenIdentifier,
      queueKey,
      lastError:
        sectionCount > 0
          ? undefined
          : "Article does not contain any narratable source tracks.",
      createdAt: now,
      updatedAt: now,
    });

    if (sectionCount > 0) {
      await ctx.scheduler.runAfter(
        0,
        internal.articleExports.processArticleAudioExport,
        {
          exportId,
        },
      );
    }

    return {
      exportId,
      status: sectionCount > 0 ? "queued" : "failed",
      ttsProvider,
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
    const identity = await ctx.auth.getUserIdentity();
    if (
      !record ||
      record.clientId !== args.clientId ||
      !canAccessArticleAudioExport(record, identity?.tokenIdentifier ?? null)
    ) {
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

export const getNextQueuedArticleAudioExportForQueue = internalQuery({
  args: {
    queueKey: v.string(),
    legacyClientId: v.string(),
    excludeExportId: v.optional(v.id("articleAudioExports")),
  },
  async handler(ctx, args) {
    const queueRecords = await ctx.db
      .query("articleAudioExports")
      .withIndex("by_queueKey", (q) => q.eq("queueKey", args.queueKey))
      .collect();
    const legacyClientRecords = await ctx.db
      .query("articleAudioExports")
      .withIndex("by_clientId", (q) => q.eq("clientId", args.legacyClientId))
      .collect();
    const records = [
      ...queueRecords,
      ...legacyClientRecords.filter(
        (record) =>
          record.queueKey == null &&
          getArticleAudioExportQueueKey(record) === args.queueKey,
      ),
    ];

    return (
      records
        .filter(
          (record) =>
            record._id !== args.excludeExportId &&
            record.dismissedAt == null &&
            record.status === "queued",
        )
        .sort((a, b) => a.createdAt - b.createdAt)[0] ?? null
    );
  },
});

export const markArticleAudioExportRunning = internalMutation({
  args: {
    exportId: v.id("articleAudioExports"),
    sectionCount: v.number(),
    ttsMetadata: ttsMetadataValidator,
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

    const queueKey = record.queueKey ?? getArticleAudioExportQueueKey(record);
    const queueRecords = await ctx.db
      .query("articleAudioExports")
      .withIndex("by_queueKey", (q) => q.eq("queueKey", queueKey))
      .collect();
    const legacyClientRecords = await ctx.db
      .query("articleAudioExports")
      .withIndex("by_clientId", (q) => q.eq("clientId", record.clientId))
      .collect();
    const queueCandidates = [
      ...queueRecords,
      ...legacyClientRecords.filter(
        (candidate) =>
          candidate.queueKey == null &&
          getArticleAudioExportQueueKey(candidate) === queueKey,
      ),
    ];
    const otherRunningRecord = queueCandidates.find(
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
      ttsProvider: record.ttsProvider ?? "edge",
      queueKey,
      sectionCount: args.sectionCount,
      completedSectionCount: 0,
      requestedTtsMetadata: args.ttsMetadata,
      ttsCacheKey: args.ttsMetadata.ttsCacheKey,
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
    producedTtsCacheKey: v.string(),
    narrationHash: v.string(),
  },
  async handler(ctx, args) {
    const record = await ctx.db.get(args.exportId);
    if (!record) return;

    await ctx.db.patch(args.exportId, {
      status: "ready",
      stage: undefined,
      storageId: args.storageId,
      byteLength: args.byteLength,
      producedTtsCacheKey: args.producedTtsCacheKey,
      narrationHash: args.narrationHash,
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
    const record = await ctx.db.get(args.exportId);
    if (!record || record.status === "ready") return;

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
    // Kept only so jobs scheduled by the previous deployment still validate.
    // The value is deliberately ignored in favor of the server-owned origin.
    baseUrl: v.optional(v.string()),
  },
  async handler(ctx, args) {
    const baseUrl = resolveArticleAudioExportBaseUrl(
      getAudioGenerationBaseUrl(),
      args.baseUrl,
    );
    const scheduleNextQueuedExport = async (
      queueKey: string,
      legacyClientId: string,
    ) => {
      const nextQueued = await ctx.runQuery(
        internal.articleExports.getNextQueuedArticleAudioExportForQueue,
        {
          queueKey,
          legacyClientId,
          excludeExportId: args.exportId,
        },
      );

      if (!nextQueued) return;

      await ctx.scheduler.runAfter(
        0,
        internal.articleExports.processArticleAudioExport,
        {
          exportId: nextQueued._id,
        },
      );
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
    const queueKey = record.queueKey ?? getArticleAudioExportQueueKey(record);

    const article = await ctx.runQuery(
      internal.articleExports.getArticleExportSource,
      {
        articleId: record.articleId,
      },
    );

    if (!article) {
      await ctx.runMutation(internal.articleExports.failArticleAudioExport, {
        exportId: args.exportId,
        lastError: "Article not found.",
      });
      await scheduleNextQueuedExport(queueKey, record.clientId);
      return;
    }

    const sections = getArticleExportSections(article);
    if (sections.length === 0) {
      await ctx.runMutation(internal.articleExports.failArticleAudioExport, {
        exportId: args.exportId,
        lastError: "Article does not contain any narratable source tracks.",
      });
      await scheduleNextQueuedExport(queueKey, record.clientId);
      return;
    }

    const requestedTtsMetadata = resolveRequestedArticleExportTtsMetadata(
      record.requestedTtsMetadata,
      record.ttsProvider === "openai" ? "openai" : "edge",
    );
    const claim = await ctx.runMutation(
      internal.articleExports.markArticleAudioExportRunning,
      {
        exportId: args.exportId,
        sectionCount: sections.length,
        ttsMetadata: requestedTtsMetadata,
      },
    );
    if (!claim.claimed) {
      return;
    }

    try {
      const result = await assembleArticleAudio({
        preferredProvider: record.ttsProvider === "openai" ? "openai" : "edge",
        article: {
          ...article,
          slug: article.slug ?? record.slug,
        },
        albumTitle: "Curio Garden Article Audio",
        baseUrl,
        requestedTtsMetadata,
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
            ttsNormVersion: TTS_NORM_VERSION,
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
          return await uploadStreamToConvexStorage(
            uploadUrl,
            stream,
            contentType,
          );
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

      await ctx.runMutation(
        internal.articleExports.completeArticleAudioExport,
        {
          exportId: args.exportId,
          storageId: result.storageId,
          byteLength: result.byteLength,
          producedTtsCacheKey: result.metadata.ttsCacheKey,
          narrationHash: result.narrationHash,
        },
      );
      await scheduleNextQueuedExport(queueKey, record.clientId);
    } catch (error) {
      await ctx.runMutation(internal.articleExports.failArticleAudioExport, {
        exportId: args.exportId,
        lastError:
          error instanceof Error
            ? error.message
            : "Article audio export failed.",
      });
      await scheduleNextQueuedExport(queueKey, record.clientId);
    }
  },
});
