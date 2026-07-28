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
import { getCombinedAudioStorageContentType } from "../lib/account-owned-audio-storage";
import {
  ARTICLE_AUDIO_EXPORT_READ_ATTESTATION_SCOPE,
  buildArticleAudioExportReadAttestationPayload,
} from "../lib/article-audio-export-attestation";
import { verifyServerAttestation } from "../lib/server-attestation";
import { getArticleAudioExportQuotaKey } from "./lib/accountQuotaKeys";
import {
  assertViewerAccountActiveForCtx,
  isViewerAccountDeletionActiveForCtx,
} from "./lib/accountDeletionState";
import {
  deleteAccountOwnedStorageForCtx,
  hasAccountOwnedAudioStorageMarkerForCtx,
  registerAccountOwnedStorageForCtx,
} from "./lib/accountOwnedStorage";

type ArticleExportStage = "queued" | "rendering_audio" | "packaging";

type ArticleExportSource = ArticleAudioSource;
export const MAX_RECENT_EXPORT_CANDIDATES = 50;
const DEFAULT_RECENT_ARTICLE_AUDIO_EXPORT_LIMIT = 4;
const MAX_RECENT_ARTICLE_AUDIO_EXPORT_LIMIT = 10;
const DEFAULT_OPENAI_EXPORT_DAILY_LIMIT = 5;
const DEFAULT_OPENAI_EXPORT_DAILY_WINDOW_MS = 24 * 60 * 60 * 1000;
export const ARTICLE_AUDIO_EXPORT_LEASE_MS = 10 * 60 * 1000;
const ARTICLE_AUDIO_EXPORT_WATCHDOG_GRACE_MS = 1_000;

const ttsMetadataValidator = v.object({
  provider: v.union(v.literal("openai"), v.literal("edge")),
  model: v.string(),
  voiceId: v.string(),
  promptVersion: v.string(),
  ttsNormVersion: v.string(),
  ttsCacheKey: v.string(),
});

const serverAttestationValidator = v.object({
  issuedAt: v.number(),
  expiresAt: v.number(),
  nonce: v.string(),
  signature: v.string(),
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
  metadata &&
  isTtsMetadataValid(metadata) &&
  (preferredProvider == null || metadata.provider === preferredProvider)
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

type ArticleAudioExportAccessRecord = {
  ttsProvider?: string;
  ttsCacheKey?: string;
  ownerTokenIdentifier?: string;
};

export const getArticleAudioExportProvider = (
  isAuthenticated: boolean,
): TtsProvider => (isAuthenticated ? "openai" : "edge");

export const normalizeArticleAudioExportProvider = (
  provider: string | undefined,
): TtsProvider | null =>
  provider === "edge" ? "edge" : provider === "openai" ? "openai" : null;

export const canAccessArticleAudioExport = (
  record: ArticleAudioExportAccessRecord,
  viewerTokenIdentifier: string | null,
): boolean => {
  if (record.ttsProvider === "edge") return true;
  if (
    record.ttsProvider !== "openai" ||
    !viewerTokenIdentifier ||
    !record.ownerTokenIdentifier
  ) {
    return false;
  }
  return record.ownerTokenIdentifier === viewerTokenIdentifier;
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

const withPublicStorageUrl = async <
  T extends {
    storageId?: Id<"_storage">;
    ttsProvider?: string;
  },
>(
  ctx: {
    storage: {
      getUrl(storageId: Id<"_storage">): Promise<string | null>;
    };
  },
  record: T,
) => {
  if (record.ttsProvider === "edge") {
    return await withStorageUrl(ctx, record);
  }

  const { storageId, ...safeRecord } = record;
  void storageId;
  return { ...safeRecord, audioUrl: null };
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
    if (viewerTokenIdentifier) {
      await assertViewerAccountActiveForCtx(ctx, viewerTokenIdentifier);
    }
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
              q.and(
                q.eq(q.field("ttsProvider"), "openai"),
                q.eq(q.field("ownerTokenIdentifier"), viewerTokenIdentifier),
              ),
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
        .map((record) => withPublicStorageUrl(ctx, record)),
    );
  },
});

export const getArticleAudioExportById = query({
  args: {
    exportId: v.id("articleAudioExports"),
    ttsCacheKey: v.string(),
  },
  async handler(ctx, args) {
    const identity = await ctx.auth.getUserIdentity();
    const viewerTokenIdentifier = identity?.tokenIdentifier ?? null;
    if (viewerTokenIdentifier) {
      await assertViewerAccountActiveForCtx(ctx, viewerTokenIdentifier);
    }

    const record = await ctx.db.get(args.exportId);
    if (!record) return null;
    if (!canAccessArticleAudioExport(record, viewerTokenIdentifier)) {
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
    return await withPublicStorageUrl(ctx, record);
  },
});

export const getArticleAudioExportForServer = mutation({
  args: {
    exportId: v.id("articleAudioExports"),
    ttsCacheKey: v.string(),
    attestation: serverAttestationValidator,
  },
  async handler(ctx, args) {
    const validAttestation = await verifyServerAttestation({
      attestation: args.attestation,
      scope: ARTICLE_AUDIO_EXPORT_READ_ATTESTATION_SCOPE,
      payload: buildArticleAudioExportReadAttestationPayload({
        exportId: args.exportId,
        ttsCacheKey: args.ttsCacheKey,
      }),
      secret: process.env.TTS_QUOTA_BYPASS_SECRET?.trim() || undefined,
    });
    if (!validAttestation) {
      throw new Error(
        "A valid server attestation is required to read this audio export.",
      );
    }

    const identity = await ctx.auth.getUserIdentity();
    const viewerTokenIdentifier = identity?.tokenIdentifier ?? null;
    if (viewerTokenIdentifier) {
      await assertViewerAccountActiveForCtx(ctx, viewerTokenIdentifier);
    }

    const record = await ctx.db.get(args.exportId);
    const ttsProvider = normalizeArticleAudioExportProvider(
      record?.ttsProvider,
    );
    if (
      !record ||
      !ttsProvider ||
      record.status !== "ready" ||
      !record.storageId
    ) {
      return null;
    }

    if (!canAccessArticleAudioExport(record, viewerTokenIdentifier)) {
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

    const audioUrl = await ctx.storage.getUrl(record.storageId);
    if (!audioUrl) return null;

    return {
      _id: record._id,
      title: record.title,
      status: record.status,
      ttsProvider,
      audioUrl,
    };
  },
});

export const getArticleAudioExportDownloadIdentity = query({
  args: {
    exportId: v.string(),
  },
  async handler(ctx, args) {
    const identity = await ctx.auth.getUserIdentity();
    const viewerTokenIdentifier = identity?.tokenIdentifier ?? null;
    if (viewerTokenIdentifier) {
      await assertViewerAccountActiveForCtx(ctx, viewerTokenIdentifier);
    }

    const exportId = ctx.db.normalizeId("articleAudioExports", args.exportId);
    if (!exportId) return null;

    const record = await ctx.db.get(exportId);
    const ttsProvider = normalizeArticleAudioExportProvider(
      record?.ttsProvider,
    );
    if (
      !record ||
      !ttsProvider ||
      record.status !== "ready" ||
      !record.storageId ||
      !record.ttsCacheKey
    ) {
      return null;
    }
    if (!canAccessArticleAudioExport(record, viewerTokenIdentifier)) {
      return null;
    }
    const article = await ctx.db.get(record.articleId);
    if (
      !article ||
      record.narrationHash !== buildArticleNarrationHash(article)
    ) {
      return null;
    }
    return {
      exportId: record._id,
      ttsCacheKey: record.ttsCacheKey,
      ttsProvider,
    };
  },
});

export const startArticleAudioExport = mutation({
  args: {
    clientId: v.string(),
    articleId: v.id("articles"),
    expectedTtsProvider: v.optional(
      v.union(v.literal("openai"), v.literal("edge")),
    ),
  },
  async handler(ctx, args) {
    const identity = await ctx.auth.getUserIdentity();
    if (identity) {
      await assertViewerAccountActiveForCtx(ctx, identity.tokenIdentifier);
    }
    const ownerTokenIdentifier = identity?.tokenIdentifier.trim() || undefined;

    const article = await ctx.db.get(args.articleId);
    if (!article) {
      throw new Error("Article not found");
    }

    const ttsProvider = getArticleAudioExportProvider(
      ownerTokenIdentifier != null,
    );
    if (
      args.expectedTtsProvider != null &&
      args.expectedTtsProvider !== ttsProvider
    ) {
      throw new Error("Audio voice access changed. Refresh and try again.");
    }
    const queueKey = getArticleAudioExportQueueKey({
      clientId: args.clientId,
      ttsProvider,
      ownerTokenIdentifier,
    });
    const requestedTtsMetadata = getTtsMetadata(getTtsProfile(ttsProvider));
    const activeTtsCacheKey = requestedTtsMetadata.ttsCacheKey;
    const narrationHash = buildArticleNarrationHash(article);
    const now = Date.now();
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
      if (
        existing.status === "queued" ||
        (existing.status === "running" && (existing.leaseExpiresAt ?? 0) <= now)
      ) {
        await ctx.scheduler.runAfter(
          0,
          internal.articleExports.processArticleAudioExport,
          { exportId: existing._id },
        );
      }
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
    const identity = await ctx.auth.getUserIdentity();
    const viewerTokenIdentifier = identity?.tokenIdentifier ?? null;
    if (viewerTokenIdentifier) {
      await assertViewerAccountActiveForCtx(ctx, viewerTokenIdentifier);
    }

    const record = await ctx.db.get(args.exportId);
    if (
      !record ||
      record.clientId !== args.clientId ||
      !canAccessArticleAudioExport(record, viewerTokenIdentifier)
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
    const excludeExportId = args.excludeExportId;
    const queueRecords = await ctx.db
      .query("articleAudioExports")
      .withIndex("by_queueKey_status", (q) =>
        q.eq("queueKey", args.queueKey).eq("status", "queued"),
      )
      .filter((q) =>
        excludeExportId
          ? q.and(
              q.eq(q.field("dismissedAt"), undefined),
              q.neq(q.field("_id"), excludeExportId),
            )
          : q.eq(q.field("dismissedAt"), undefined),
      )
      .order("asc")
      .take(1);
    const legacyClientRecords = await ctx.db
      .query("articleAudioExports")
      .withIndex("by_clientId", (q) => q.eq("clientId", args.legacyClientId))
      .filter((q) =>
        excludeExportId
          ? q.and(
              q.eq(q.field("queueKey"), undefined),
              q.eq(q.field("status"), "queued"),
              q.eq(q.field("dismissedAt"), undefined),
              q.neq(q.field("_id"), excludeExportId),
            )
          : q.and(
              q.eq(q.field("queueKey"), undefined),
              q.eq(q.field("status"), "queued"),
              q.eq(q.field("dismissedAt"), undefined),
            ),
      )
      .order("asc")
      .take(MAX_RECENT_EXPORT_CANDIDATES);
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
          (record) => record.dismissedAt == null && record.status === "queued",
        )
        .sort((a, b) => a.createdAt - b.createdAt)[0] ?? null
    );
  },
});

export const markArticleAudioExportRunning = internalMutation({
  args: {
    exportId: v.id("articleAudioExports"),
    owner: v.string(),
    sectionCount: v.number(),
    ttsMetadata: ttsMetadataValidator,
  },
  async handler(ctx, args) {
    const record = await ctx.db.get(args.exportId);
    if (
      !record ||
      record.dismissedAt != null ||
      record.status === "ready" ||
      record.status === "failed"
    ) {
      return { claimed: false };
    }
    if (
      record.ownerTokenIdentifier &&
      (await isViewerAccountDeletionActiveForCtx(
        ctx,
        record.ownerTokenIdentifier,
      ))
    ) {
      return { claimed: false };
    }

    const now = Date.now();
    const scheduleRetryAt = async (leaseExpiresAt: number) => {
      await ctx.scheduler.runAfter(
        Math.max(0, leaseExpiresAt - now) +
          ARTICLE_AUDIO_EXPORT_WATCHDOG_GRACE_MS,
        internal.articleExports.processArticleAudioExport,
        { exportId: args.exportId },
      );
    };

    if (record.status === "running" && (record.leaseExpiresAt ?? 0) > now) {
      await scheduleRetryAt(record.leaseExpiresAt!);
      return { claimed: false };
    }

    if (record.status !== "queued" && record.status !== "running") {
      return { claimed: false };
    }

    const queueKey = record.queueKey ?? getArticleAudioExportQueueKey(record);
    const queueRecords = await ctx.db
      .query("articleAudioExports")
      .withIndex("by_queueKey_status", (q) =>
        q.eq("queueKey", queueKey).eq("status", "running"),
      )
      .filter((q) =>
        q.and(
          q.neq(q.field("_id"), args.exportId),
          q.eq(q.field("dismissedAt"), undefined),
          q.gt(q.field("leaseExpiresAt"), now),
        ),
      )
      .order("asc")
      .take(1);
    const legacyClientRecords = await ctx.db
      .query("articleAudioExports")
      .withIndex("by_clientId", (q) => q.eq("clientId", record.clientId))
      .filter((q) =>
        q.and(
          q.neq(q.field("_id"), args.exportId),
          q.eq(q.field("queueKey"), undefined),
          q.eq(q.field("status"), "running"),
          q.eq(q.field("dismissedAt"), undefined),
          q.gt(q.field("leaseExpiresAt"), now),
        ),
      )
      .order("asc")
      .take(MAX_RECENT_EXPORT_CANDIDATES);
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
        candidate.status === "running" &&
        (candidate.leaseExpiresAt ?? 0) > now,
    );

    if (otherRunningRecord) {
      await scheduleRetryAt(otherRunningRecord.leaseExpiresAt!);
      return { claimed: false };
    }

    await ctx.db.patch(args.exportId, {
      status: "running",
      stage: "rendering_audio",
      queueKey,
      sectionCount: args.sectionCount,
      completedSectionCount: 0,
      requestedTtsMetadata: args.ttsMetadata,
      ttsCacheKey: args.ttsMetadata.ttsCacheKey,
      lastError: undefined,
      leaseOwner: args.owner,
      leaseExpiresAt: now + ARTICLE_AUDIO_EXPORT_LEASE_MS,
      updatedAt: now,
    });
    await ctx.scheduler.runAfter(
      ARTICLE_AUDIO_EXPORT_LEASE_MS + ARTICLE_AUDIO_EXPORT_WATCHDOG_GRACE_MS,
      internal.articleExports.processArticleAudioExport,
      { exportId: args.exportId },
    );

    return { claimed: true };
  },
});

export const updateArticleAudioExportProgress = internalMutation({
  args: {
    exportId: v.id("articleAudioExports"),
    owner: v.string(),
    completedSectionCount: v.number(),
    stage: v.union(
      v.literal("queued"),
      v.literal("rendering_audio"),
      v.literal("packaging"),
    ),
  },
  async handler(ctx, args) {
    const record = await ctx.db.get(args.exportId);
    if (
      !record ||
      record.status !== "running" ||
      record.leaseOwner !== args.owner
    ) {
      return { updated: false };
    }
    if (
      record.ownerTokenIdentifier &&
      (await isViewerAccountDeletionActiveForCtx(
        ctx,
        record.ownerTokenIdentifier,
      ))
    ) {
      return { updated: false };
    }

    const now = Date.now();
    await ctx.db.patch(args.exportId, {
      status: "running",
      stage: args.stage,
      completedSectionCount: args.completedSectionCount,
      leaseExpiresAt: now + ARTICLE_AUDIO_EXPORT_LEASE_MS,
      updatedAt: now,
    });
    return { updated: true };
  },
});

export const completeArticleAudioExport = internalMutation({
  args: {
    exportId: v.id("articleAudioExports"),
    owner: v.string(),
    storageId: v.id("_storage"),
    expectedViewerTokenIdentifier: v.optional(v.string()),
    byteLength: v.number(),
    producedTtsCacheKey: v.string(),
    narrationHash: v.string(),
  },
  async handler(ctx, args) {
    const record = await ctx.db.get(args.exportId);
    const now = Date.now();

    if (!record) {
      await deleteAccountOwnedStorageForCtx(
        ctx,
        args.storageId,
        args.expectedViewerTokenIdentifier,
      );
      return { completed: false, uploadAlreadyDiscarded: true };
    }

    if (
      record.ownerTokenIdentifier &&
      (await isViewerAccountDeletionActiveForCtx(
        ctx,
        record.ownerTokenIdentifier,
      ))
    ) {
      await deleteAccountOwnedStorageForCtx(
        ctx,
        args.storageId,
        record.ownerTokenIdentifier,
      );
      return { completed: false, uploadAlreadyDiscarded: true };
    }

    const exactDuplicate =
      record.status === "ready" &&
      record.storageId === args.storageId &&
      record.byteLength === args.byteLength &&
      record.producedTtsCacheKey === args.producedTtsCacheKey &&
      record.narrationHash === args.narrationHash &&
      record.completedSectionCount === record.sectionCount;

    if (exactDuplicate) {
      if (record.ownerTokenIdentifier) {
        const registration = await registerAccountOwnedStorageForCtx(ctx, {
          viewerTokenIdentifier: record.ownerTokenIdentifier,
          storageId: args.storageId,
          kind: "article_audio_export",
          parentId: String(args.exportId),
        });
        if (!registration.registered) {
          return { completed: false };
        }
      }
      return { completed: true };
    }

    if (
      record.status !== "running" ||
      record.leaseOwner !== args.owner ||
      (record.leaseExpiresAt ?? 0) <= now
    ) {
      if (record.storageId !== args.storageId) {
        await deleteAccountOwnedStorageForCtx(
          ctx,
          args.storageId,
          record.ownerTokenIdentifier,
        );
        return { completed: false, uploadAlreadyDiscarded: true };
      }
      return { completed: false };
    }

    if (record.ownerTokenIdentifier) {
      const registration = await registerAccountOwnedStorageForCtx(ctx, {
        viewerTokenIdentifier: record.ownerTokenIdentifier,
        storageId: args.storageId,
        kind: "article_audio_export",
        parentId: String(args.exportId),
      });
      if (!registration.registered) {
        return { completed: false, uploadAlreadyDiscarded: true };
      }
    }

    await ctx.db.patch(args.exportId, {
      status: "ready",
      stage: undefined,
      storageId: args.storageId,
      byteLength: args.byteLength,
      producedTtsCacheKey: args.producedTtsCacheKey,
      narrationHash: args.narrationHash,
      completedSectionCount: record.sectionCount,
      leaseOwner: undefined,
      leaseExpiresAt: undefined,
      updatedAt: now,
    });
    return { completed: true };
  },
});

export const discardArticleAudioExportUpload = internalMutation({
  args: {
    exportId: v.id("articleAudioExports"),
    storageId: v.id("_storage"),
    expectedViewerTokenIdentifier: v.optional(v.string()),
  },
  async handler(ctx, args) {
    const record = await ctx.db.get(args.exportId);
    if (record?.storageId === args.storageId) {
      return { discarded: false, referenced: true };
    }

    if (
      record &&
      args.expectedViewerTokenIdentifier !== undefined &&
      record.ownerTokenIdentifier !== args.expectedViewerTokenIdentifier
    ) {
      throw new Error("Article audio export upload owner mismatch.");
    }

    await deleteAccountOwnedStorageForCtx(
      ctx,
      args.storageId,
      record?.ownerTokenIdentifier ?? args.expectedViewerTokenIdentifier,
    );
    return { discarded: true, referenced: false };
  },
});

export const registerArticleAudioExportUpload = internalMutation({
  args: {
    exportId: v.id("articleAudioExports"),
    owner: v.string(),
    storageId: v.id("_storage"),
  },
  async handler(ctx, args) {
    const record = await ctx.db.get(args.exportId);
    const now = Date.now();
    if (
      !record ||
      record.status !== "running" ||
      record.leaseOwner !== args.owner ||
      (record.leaseExpiresAt ?? 0) <= now
    ) {
      if (record?.storageId !== args.storageId) {
        await deleteAccountOwnedStorageForCtx(
          ctx,
          args.storageId,
          record?.ownerTokenIdentifier,
        );
      }
      return { registered: false };
    }

    if (!record.ownerTokenIdentifier) {
      return { registered: true };
    }

    if (!(await hasAccountOwnedAudioStorageMarkerForCtx(ctx, args.storageId))) {
      await deleteAccountOwnedStorageForCtx(
        ctx,
        args.storageId,
        record.ownerTokenIdentifier,
      );
      return { registered: false };
    }

    return await registerAccountOwnedStorageForCtx(ctx, {
      viewerTokenIdentifier: record.ownerTokenIdentifier,
      storageId: args.storageId,
      kind: "article_audio_export",
      parentId: String(args.exportId),
    });
  },
});

export const failArticleAudioExport = internalMutation({
  args: {
    exportId: v.id("articleAudioExports"),
    owner: v.string(),
    lastError: v.string(),
  },
  async handler(ctx, args) {
    const record = await ctx.db.get(args.exportId);
    const now = Date.now();
    if (
      !record ||
      record.status === "ready" ||
      record.status === "failed" ||
      (record.status === "running" &&
        record.leaseOwner !== args.owner &&
        (record.leaseExpiresAt ?? 0) > now)
    ) {
      return { failed: false };
    }
    if (
      record.ownerTokenIdentifier &&
      (await isViewerAccountDeletionActiveForCtx(
        ctx,
        record.ownerTokenIdentifier,
      ))
    ) {
      return { failed: false };
    }

    await ctx.db.patch(args.exportId, {
      status: "failed",
      stage: undefined,
      lastError: args.lastError,
      leaseOwner: undefined,
      leaseExpiresAt: undefined,
      updatedAt: now,
    });
    return { failed: true };
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

    if (
      !record ||
      record.dismissedAt != null ||
      record.status === "ready" ||
      record.status === "failed"
    ) {
      return;
    }
    const queueKey = record.queueKey ?? getArticleAudioExportQueueKey(record);
    const owner = crypto.randomUUID();
    const ttsProvider = normalizeArticleAudioExportProvider(record.ttsProvider);

    if (!ttsProvider) {
      const failure = await ctx.runMutation(
        internal.articleExports.failArticleAudioExport,
        {
          exportId: args.exportId,
          owner,
          lastError: "Audio voice provider is missing or unsupported.",
        },
      );
      if (failure.failed) {
        await scheduleNextQueuedExport(queueKey, record.clientId);
      }
      return;
    }

    const article = await ctx.runQuery(
      internal.articleExports.getArticleExportSource,
      {
        articleId: record.articleId,
      },
    );

    if (!article) {
      const failure = await ctx.runMutation(
        internal.articleExports.failArticleAudioExport,
        {
          exportId: args.exportId,
          owner,
          lastError: "Article not found.",
        },
      );
      if (failure.failed) {
        await scheduleNextQueuedExport(queueKey, record.clientId);
      }
      return;
    }

    const sections = getArticleExportSections(article);
    if (sections.length === 0) {
      const failure = await ctx.runMutation(
        internal.articleExports.failArticleAudioExport,
        {
          exportId: args.exportId,
          owner,
          lastError: "Article does not contain any narratable source tracks.",
        },
      );
      if (failure.failed) {
        await scheduleNextQueuedExport(queueKey, record.clientId);
      }
      return;
    }

    const requestedTtsMetadata = resolveRequestedArticleExportTtsMetadata(
      record.requestedTtsMetadata,
      ttsProvider,
    );
    const claim = await ctx.runMutation(
      internal.articleExports.markArticleAudioExportRunning,
      {
        exportId: args.exportId,
        owner,
        sectionCount: sections.length,
        ttsMetadata: requestedTtsMetadata,
      },
    );
    if (!claim.claimed) {
      return;
    }

    let uploadedCombinedStorageId: Id<"_storage"> | null = null;
    const discardCombinedUpload = async () => {
      if (!uploadedCombinedStorageId) return "none" as const;
      try {
        const discard = await ctx.runMutation(
          internal.articleExports.discardArticleAudioExportUpload,
          {
            exportId: args.exportId,
            storageId: uploadedCombinedStorageId,
            ...(record.ownerTokenIdentifier
              ? {
                  expectedViewerTokenIdentifier: record.ownerTokenIdentifier,
                }
              : {}),
          },
        );
        if (discard.referenced) {
          uploadedCombinedStorageId = null;
          return "referenced" as const;
        }
        if (discard.discarded) {
          uploadedCombinedStorageId = null;
          return "discarded" as const;
        }
        return "failed" as const;
      } catch (discardError) {
        console.error(
          "[article-export] Combined upload discard failed",
          discardError instanceof Error
            ? discardError.name
            : typeof discardError,
        );
        return "failed" as const;
      }
    };

    try {
      const result = await assembleArticleAudio({
        preferredProvider: ttsProvider,
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
          const upload = await uploadStreamToConvexStorage(
            uploadUrl,
            stream,
            getCombinedAudioStorageContentType(
              contentType,
              record.ownerTokenIdentifier !== undefined,
            ),
          );
          uploadedCombinedStorageId = upload.storageId;
          const registration = await ctx.runMutation(
            internal.articleExports.registerArticleAudioExportUpload,
            {
              exportId: args.exportId,
              owner,
              storageId: upload.storageId,
            },
          );
          if (!registration.registered) {
            uploadedCombinedStorageId = null;
            throw new Error("Article audio export lease was lost.");
          }
          return upload;
        },
        onProgress: async ({ completedSectionCount, stage }) => {
          const progress = await ctx.runMutation(
            internal.articleExports.updateArticleAudioExportProgress,
            {
              exportId: args.exportId,
              owner,
              completedSectionCount,
              stage: stage satisfies ArticleExportStage,
            },
          );
          if (!progress.updated) {
            throw new Error("Article audio export lease was lost.");
          }
        },
      });

      const completion = await ctx.runMutation(
        internal.articleExports.completeArticleAudioExport,
        {
          exportId: args.exportId,
          owner,
          storageId: result.storageId,
          ...(record.ownerTokenIdentifier
            ? {
                expectedViewerTokenIdentifier: record.ownerTokenIdentifier,
              }
            : {}),
          byteLength: result.byteLength,
          producedTtsCacheKey: result.metadata.ttsCacheKey,
          narrationHash: result.narrationHash,
        },
      );
      if (!completion.completed) {
        if (
          "uploadAlreadyDiscarded" in completion &&
          completion.uploadAlreadyDiscarded
        ) {
          uploadedCombinedStorageId = null;
          return;
        }
        const disposition = await discardCombinedUpload();
        if (disposition === "referenced") {
          await scheduleNextQueuedExport(queueKey, record.clientId);
        }
        return;
      }
      uploadedCombinedStorageId = null;
      await scheduleNextQueuedExport(queueKey, record.clientId);
    } catch (error) {
      const disposition = await discardCombinedUpload();
      if (disposition === "referenced") {
        await scheduleNextQueuedExport(queueKey, record.clientId);
        return;
      }
      const failure = await ctx.runMutation(
        internal.articleExports.failArticleAudioExport,
        {
          exportId: args.exportId,
          owner,
          lastError:
            error instanceof Error
              ? error.message
              : "Article audio export failed.",
        },
      );
      if (failure.failed) {
        await scheduleNextQueuedExport(queueKey, record.clientId);
      }
    }
  },
});
