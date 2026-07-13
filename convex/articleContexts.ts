import { anyApi } from "convex/server";
import {
  action,
  internalMutation,
  internalQuery,
  query,
  type MutationCtx,
  type QueryCtx,
} from "./_generated/server";
import type { Id } from "./_generated/dataModel";
import { v } from "convex/values";

export const MAX_ARTICLE_CONTEXT_MANIFEST_BYTES = 400_000;
export const MAX_ARTICLE_CONTEXT_BLOCKS = 6;
export const MAX_CACHE_VARIANTS_PER_REVISION = 4;
export const MAX_REPORTERS_PER_CONTEXT_BLOCK = 50;
export const ARTICLE_CONTEXT_SCHEMA_VERSION = 2;

const reportReasonValidator = v.union(
  v.literal("inaccurate"),
  v.literal("misleading"),
  v.literal("accessibility"),
  v.literal("broken"),
  v.literal("inappropriate"),
  v.literal("other"),
);

const reportStatusValidator = v.union(
  v.literal("open"),
  v.literal("reviewing"),
  v.literal("resolved"),
  v.literal("dismissed"),
);

const moderationModeValidator = v.union(
  v.literal("suppress"),
  v.literal("override"),
);

const contextTextOverrideValidator = v.object({
  title: v.optional(v.string()),
  caption: v.optional(v.string()),
  longDescription: v.optional(v.string()),
});

export type ArticleContextCacheKey = {
  wikiPageId: string;
  revisionId: string;
  extractorVersion: string;
  sourceHash: string;
};

export type ArticleContextBlockKey = {
  wikiPageId: string;
  revisionId: string;
  blockId: string;
  sourceHash: string;
};

export type ArticleContextReportReason =
  | "inaccurate"
  | "misleading"
  | "accessibility"
  | "broken"
  | "inappropriate"
  | "other";

export type ArticleContextReportStatus =
  | "open"
  | "reviewing"
  | "resolved"
  | "dismissed";

export type ArticleContextTextOverride = {
  title?: string;
  caption?: string;
  longDescription?: string;
};

type Environment = Record<string, string | undefined>;

const utf8Length = (value: string) => new TextEncoder().encode(value).byteLength;

const assertBoundedKeyPart = (
  name: string,
  value: string,
  maxBytes: number,
) => {
  if (!value || value !== value.trim()) {
    throw new Error(`${name} must be a non-empty, trimmed string`);
  }
  if (/\p{Cc}/u.test(value)) {
    throw new Error(`${name} must not contain control characters`);
  }
  if (utf8Length(value) > maxBytes) {
    throw new Error(`${name} is too long`);
  }
};

const assertSourceHash = (sourceHash: string) => {
  assertBoundedKeyPart("sourceHash", sourceHash, 256);
  if (!/^[A-Za-z0-9._~:+/=-]+$/.test(sourceHash)) {
    throw new Error("sourceHash must be an opaque ASCII hash value");
  }
};

export const assertValidCacheKey = (key: ArticleContextCacheKey) => {
  assertBoundedKeyPart("wikiPageId", key.wikiPageId, 128);
  assertBoundedKeyPart("revisionId", key.revisionId, 128);
  assertBoundedKeyPart("extractorVersion", key.extractorVersion, 64);
  assertSourceHash(key.sourceHash);
};

export const assertValidBlockKey = (key: ArticleContextBlockKey) => {
  assertBoundedKeyPart("wikiPageId", key.wikiPageId, 128);
  assertBoundedKeyPart("revisionId", key.revisionId, 128);
  assertBoundedKeyPart("blockId", key.blockId, 256);
  assertSourceHash(key.sourceHash);
};

const constantTimeEqual = (left: string, right: string) => {
  let mismatch = left.length ^ right.length;
  const length = Math.max(left.length, right.length);

  for (let index = 0; index < length; index += 1) {
    const leftCode = index < left.length ? left.charCodeAt(index) : 0;
    const rightCode = index < right.length ? right.charCodeAt(index) : 0;
    mismatch |= leftCode ^ rightCode;
  }

  return mismatch === 0;
};

/**
 * Server-originated writes are authenticated inside the Convex runtime.
 * ARTICLE_CONTEXT_WRITE_SECRET is preferred; CRON_SECRET is a convenient
 * fallback for existing deployments. An explicit local-only escape hatch is
 * available for isolated development deployments and is never enabled by
 * NODE_ENV alone.
 */
export const assertArticleContextWriteAuthorized = (
  providedSecret: string,
  environment: Environment = process.env,
) => {
  const expectedSecret =
    environment.ARTICLE_CONTEXT_WRITE_SECRET?.trim() ||
    environment.CRON_SECRET?.trim();

  if (expectedSecret) {
    if (!constantTimeEqual(providedSecret, expectedSecret)) {
      throw new Error("Unauthorized");
    }
    return;
  }

  if (environment.ARTICLE_CONTEXT_ALLOW_INSECURE_LOCAL_WRITES === "1") {
    return;
  }

  throw new Error(
    "ARTICLE_CONTEXT_WRITE_SECRET (or CRON_SECRET) is not configured in Convex",
  );
};

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null && !Array.isArray(value);

export const validateAndNormalizeManifestJson = (
  manifestJson: string,
  key: ArticleContextCacheKey,
) => {
  assertValidCacheKey(key);

  if (utf8Length(manifestJson) > MAX_ARTICLE_CONTEXT_MANIFEST_BYTES) {
    throw new Error(
      `Article context manifests may not exceed ${MAX_ARTICLE_CONTEXT_MANIFEST_BYTES} UTF-8 bytes`,
    );
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(manifestJson);
  } catch {
    throw new Error("manifestJson must contain valid JSON");
  }

  if (!isRecord(parsed)) {
    throw new Error("manifestJson must contain a JSON object");
  }
  if (parsed.schemaVersion !== ARTICLE_CONTEXT_SCHEMA_VERSION) {
    throw new Error("Unsupported article context schemaVersion");
  }
  if (parsed.wikiPageId !== key.wikiPageId) {
    throw new Error("Manifest wikiPageId does not match the cache key");
  }
  if (parsed.revisionId !== key.revisionId) {
    throw new Error("Manifest revisionId does not match the cache key");
  }
  if (parsed.extractorVersion !== key.extractorVersion) {
    throw new Error("Manifest extractorVersion does not match the cache key");
  }
  if (parsed.sourceHash !== key.sourceHash) {
    throw new Error("Manifest sourceHash does not match the cache key");
  }
  if (!Array.isArray(parsed.blocks)) {
    throw new Error("Manifest blocks must be an array");
  }
  if (parsed.blocks.length > MAX_ARTICLE_CONTEXT_BLOCKS) {
    throw new Error(
      `Article context manifests may not contain more than ${MAX_ARTICLE_CONTEXT_BLOCKS} blocks`,
    );
  }

  const seenBlockIds = new Set<string>();
  for (const block of parsed.blocks) {
    if (!isRecord(block) || typeof block.id !== "string") {
      throw new Error("Every context block must have a string id");
    }
    assertBoundedKeyPart("block.id", block.id, 256);
    if (seenBlockIds.has(block.id)) {
      throw new Error(`Duplicate context block id: ${block.id}`);
    }
    seenBlockIds.add(block.id);

    if (
      block.kind !== "map" &&
      block.kind !== "timeline" &&
      block.kind !== "chart" &&
      block.kind !== "diagram"
    ) {
      throw new Error(`Unsupported context block kind for ${block.id}`);
    }

    if (
      typeof block.title !== "string" ||
      !block.title.trim() ||
      typeof block.caption !== "string" ||
      !block.caption.trim() ||
      typeof block.longDescription !== "string" ||
      !block.longDescription.trim()
    ) {
      throw new Error(
        `Context block ${block.id} is missing schema-v2 accessibility copy`,
      );
    }
    if ("takeaway" in block || "spokenSummary" in block) {
      throw new Error(`Context block ${block.id} contains legacy audio copy`);
    }

    if (!isRecord(block.provenance)) {
      throw new Error(`Context block ${block.id} is missing provenance`);
    }
    if (block.provenance.sourceHash !== key.sourceHash) {
      throw new Error(`Context block ${block.id} has a mismatched sourceHash`);
    }
    if (block.provenance.extractorVersion !== key.extractorVersion) {
      throw new Error(
        `Context block ${block.id} has a mismatched extractorVersion`,
      );
    }
  }

  const normalizedJson = JSON.stringify(parsed);
  const byteLength = utf8Length(normalizedJson);
  if (byteLength > MAX_ARTICLE_CONTEXT_MANIFEST_BYTES) {
    throw new Error(
      `Article context manifests may not exceed ${MAX_ARTICLE_CONTEXT_MANIFEST_BYTES} UTF-8 bytes`,
    );
  }

  return {
    manifestJson: normalizedJson,
    byteLength,
    blockCount: parsed.blocks.length,
    schemaVersion: ARTICLE_CONTEXT_SCHEMA_VERSION,
  };
};

const normalizeOptionalText = (
  name: string,
  value: string | undefined,
  maxBytes: number,
) => {
  if (value === undefined) return undefined;
  const normalized = value.trim();
  if (!normalized) return undefined;
  if (utf8Length(normalized) > maxBytes) {
    throw new Error(`${name} is too long`);
  }
  return normalized;
};

export const validateTextOverride = (
  override: ArticleContextTextOverride | undefined,
) => {
  if (!override || !isRecord(override)) {
    throw new Error("An override requires at least one replacement text field");
  }

  const normalized: ArticleContextTextOverride = {
    title: normalizeOptionalText("override.title", override.title, 500),
    caption: normalizeOptionalText(
      "override.caption",
      override.caption,
      4_000,
    ),
    longDescription: normalizeOptionalText(
      "override.longDescription",
      override.longDescription,
      32_000,
    ),
  };

  if (!Object.values(normalized).some((value) => value !== undefined)) {
    throw new Error("An override requires at least one replacement text field");
  }

  return normalized;
};

type ReadCtx = Pick<QueryCtx, "db">;
type WriteCtx = Pick<MutationCtx, "db">;

const toPublicCacheRecord = <
  T extends {
    wikiPageId: string;
    revisionId: string;
    extractorVersion: string;
    sourceHash: string;
    schemaVersion: number;
    manifestJson: string;
    byteLength: number;
    blockCount: number;
    createdAt: number;
    updatedAt: number;
  },
>(record: T) => ({
  wikiPageId: record.wikiPageId,
  revisionId: record.revisionId,
  extractorVersion: record.extractorVersion,
  sourceHash: record.sourceHash,
  schemaVersion: record.schemaVersion,
  manifestJson: record.manifestJson,
  byteLength: record.byteLength,
  blockCount: record.blockCount,
  createdAt: record.createdAt,
  updatedAt: record.updatedAt,
});

export const getArticleContextCacheForCtx = async (
  ctx: ReadCtx,
  key: ArticleContextCacheKey,
) => {
  assertValidCacheKey(key);
  const record = await ctx.db
    .query("articleContextCaches")
    .withIndex("by_cache_key", (index) =>
      index
        .eq("wikiPageId", key.wikiPageId)
        .eq("revisionId", key.revisionId)
        .eq("extractorVersion", key.extractorVersion)
        .eq("sourceHash", key.sourceHash),
    )
    .unique();

  return record ? toPublicCacheRecord(record) : null;
};

export const getLatestArticleContextCacheForCtx = async (
  ctx: ReadCtx,
  key: Omit<ArticleContextCacheKey, "sourceHash">,
) => {
  assertBoundedKeyPart("wikiPageId", key.wikiPageId, 128);
  assertBoundedKeyPart("revisionId", key.revisionId, 128);
  assertBoundedKeyPart("extractorVersion", key.extractorVersion, 64);

  const records = await ctx.db
    .query("articleContextCaches")
    .withIndex("by_page_revision_extractor", (index) =>
      index
        .eq("wikiPageId", key.wikiPageId)
        .eq("revisionId", key.revisionId)
        .eq("extractorVersion", key.extractorVersion),
    )
    .collect();

  const latest = records.sort(
    (left, right) => right.updatedAt - left.updatedAt,
  )[0];
  return latest ? toPublicCacheRecord(latest) : null;
};

export const upsertArticleContextCacheForCtx = async (
  ctx: WriteCtx,
  args: ArticleContextCacheKey & { manifestJson: string; now?: number },
) => {
  const normalized = validateAndNormalizeManifestJson(args.manifestJson, args);
  const now = args.now ?? Date.now();
  const existing = await ctx.db
    .query("articleContextCaches")
    .withIndex("by_cache_key", (index) =>
      index
        .eq("wikiPageId", args.wikiPageId)
        .eq("revisionId", args.revisionId)
        .eq("extractorVersion", args.extractorVersion)
        .eq("sourceHash", args.sourceHash),
    )
    .unique();

  let cacheId: Id<"articleContextCaches">;
  let created: boolean;
  if (existing) {
    cacheId = existing._id;
    created = false;
    await ctx.db.patch(existing._id, {
      ...normalized,
      updatedAt: now,
    });
  } else {
    created = true;
    cacheId = await ctx.db.insert("articleContextCaches", {
      wikiPageId: args.wikiPageId,
      revisionId: args.revisionId,
      extractorVersion: args.extractorVersion,
      sourceHash: args.sourceHash,
      ...normalized,
      createdAt: now,
      updatedAt: now,
    });
  }

  const variants = await ctx.db
    .query("articleContextCaches")
    .withIndex("by_page_revision_extractor", (index) =>
      index
        .eq("wikiPageId", args.wikiPageId)
        .eq("revisionId", args.revisionId)
        .eq("extractorVersion", args.extractorVersion),
    )
    .collect();
  const obsolete = variants
    .filter((variant) => variant._id !== cacheId)
    .sort((left, right) => right.updatedAt - left.updatedAt)
    .slice(MAX_CACHE_VARIANTS_PER_REVISION - 1);
  for (const variant of obsolete) {
    await ctx.db.delete(variant._id);
  }

  return {
    cacheId,
    created,
    byteLength: normalized.byteLength,
    blockCount: normalized.blockCount,
  };
};

export const removeArticleContextCacheForCtx = async (
  ctx: WriteCtx,
  key: ArticleContextCacheKey,
) => {
  assertValidCacheKey(key);
  const existing = await ctx.db
    .query("articleContextCaches")
    .withIndex("by_cache_key", (index) =>
      index
        .eq("wikiPageId", key.wikiPageId)
        .eq("revisionId", key.revisionId)
        .eq("extractorVersion", key.extractorVersion)
        .eq("sourceHash", key.sourceHash),
    )
    .unique();
  if (!existing) return false;
  await ctx.db.delete(existing._id);
  return true;
};

export const submitArticleContextReportForCtx = async (
  ctx: WriteCtx,
  args: ArticleContextBlockKey & {
    reporterKey: string;
    reason: ArticleContextReportReason;
    details?: string;
    now?: number;
  },
) => {
  assertValidBlockKey(args);
  assertBoundedKeyPart("reporterKey", args.reporterKey, 128);
  const details = normalizeOptionalText("details", args.details, 4_000);
  if (args.reason === "other" && !details) {
    throw new Error("Reports with reason 'other' require details");
  }
  const now = args.now ?? Date.now();

  const existing = await ctx.db
    .query("articleContextReports")
    .withIndex("by_context_block_reporter", (index) =>
      index
        .eq("wikiPageId", args.wikiPageId)
        .eq("revisionId", args.revisionId)
        .eq("blockId", args.blockId)
        .eq("sourceHash", args.sourceHash)
        .eq("reporterKey", args.reporterKey),
    )
    .unique();

  const reportsForBlock = await ctx.db
    .query("articleContextReports")
    .withIndex("by_context_block", (index) =>
      index
        .eq("wikiPageId", args.wikiPageId)
        .eq("revisionId", args.revisionId)
        .eq("blockId", args.blockId)
        .eq("sourceHash", args.sourceHash),
    )
    .collect();
  const activeReportCount = reportsForBlock.filter(
    (report) => report.status === "open" || report.status === "reviewing",
  ).length;

  if (existing) {
    const reopensClosedReport =
      existing.status === "resolved" || existing.status === "dismissed";
    if (
      reopensClosedReport &&
      activeReportCount >= MAX_REPORTERS_PER_CONTEXT_BLOCK
    ) {
      throw new Error("This context block has reached its report intake limit");
    }
    await ctx.db.patch(existing._id, {
      reason: args.reason,
      details,
      status: "open",
      occurrences: Math.min(Number.MAX_SAFE_INTEGER, existing.occurrences + 1),
      resolutionNote: undefined,
      updatedAt: now,
    });
    return { reportId: existing._id, created: false };
  }

  if (activeReportCount >= MAX_REPORTERS_PER_CONTEXT_BLOCK) {
    throw new Error("This context block has reached its report intake limit");
  }

  const reportId = await ctx.db.insert("articleContextReports", {
    wikiPageId: args.wikiPageId,
    revisionId: args.revisionId,
    blockId: args.blockId,
    sourceHash: args.sourceHash,
    reporterKey: args.reporterKey,
    reason: args.reason,
    details,
    status: "open",
    occurrences: 1,
    createdAt: now,
    updatedAt: now,
  });
  return { reportId, created: true };
};

export const updateArticleContextReportStatusForCtx = async (
  ctx: WriteCtx,
  args: {
    reportId: Id<"articleContextReports">;
    status: ArticleContextReportStatus;
    resolutionNote?: string;
    now?: number;
  },
) => {
  const report = await ctx.db.get(args.reportId);
  if (!report) throw new Error("Article context report not found");
  const resolutionNote = normalizeOptionalText(
    "resolutionNote",
    args.resolutionNote,
    4_000,
  );
  await ctx.db.patch(report._id, {
    status: args.status,
    resolutionNote,
    updatedAt: args.now ?? Date.now(),
  });
  return true;
};

export const getArticleContextModerationForCtx = async (
  ctx: ReadCtx,
  key: ArticleContextBlockKey,
) => {
  assertValidBlockKey(key);
  const record = await ctx.db
    .query("articleContextModerations")
    .withIndex("by_context_block", (index) =>
      index
        .eq("wikiPageId", key.wikiPageId)
        .eq("revisionId", key.revisionId)
        .eq("blockId", key.blockId)
        .eq("sourceHash", key.sourceHash),
    )
    .unique();

  if (!record || record.status !== "active") return null;
  const storedOverride = record.override;
  const override = storedOverride
    ? {
        title: storedOverride.title,
        caption: storedOverride.caption ?? storedOverride.takeaway,
        longDescription: storedOverride.longDescription,
      }
    : undefined;
  return {
    mode: record.mode,
    ...(override && Object.values(override).some((value) => value !== undefined)
      ? { override }
      : {}),
    updatedAt: record.updatedAt,
  };
};

export const setArticleContextModerationForCtx = async (
  ctx: WriteCtx,
  args: ArticleContextBlockKey & {
    mode: "suppress" | "override";
    override?: ArticleContextTextOverride;
    note?: string;
    now?: number;
  },
) => {
  assertValidBlockKey(args);
  const override =
    args.mode === "override" ? validateTextOverride(args.override) : undefined;
  if (args.mode === "suppress" && args.override !== undefined) {
    throw new Error("Suppression records cannot include a text override");
  }
  const note = normalizeOptionalText("note", args.note, 4_000);
  const now = args.now ?? Date.now();
  const existing = await ctx.db
    .query("articleContextModerations")
    .withIndex("by_context_block", (index) =>
      index
        .eq("wikiPageId", args.wikiPageId)
        .eq("revisionId", args.revisionId)
        .eq("blockId", args.blockId)
        .eq("sourceHash", args.sourceHash),
    )
    .unique();

  if (existing) {
    await ctx.db.patch(existing._id, {
      mode: args.mode,
      status: "active",
      override,
      note,
      updatedAt: now,
    });
    return { moderationId: existing._id, created: false };
  }

  const moderationId = await ctx.db.insert("articleContextModerations", {
    wikiPageId: args.wikiPageId,
    revisionId: args.revisionId,
    blockId: args.blockId,
    sourceHash: args.sourceHash,
    mode: args.mode,
    status: "active",
    override,
    note,
    createdAt: now,
    updatedAt: now,
  });
  return { moderationId, created: true };
};

export const clearArticleContextModerationForCtx = async (
  ctx: WriteCtx,
  args: ArticleContextBlockKey & { note?: string; now?: number },
) => {
  assertValidBlockKey(args);
  const existing = await ctx.db
    .query("articleContextModerations")
    .withIndex("by_context_block", (index) =>
      index
        .eq("wikiPageId", args.wikiPageId)
        .eq("revisionId", args.revisionId)
        .eq("blockId", args.blockId)
        .eq("sourceHash", args.sourceHash),
    )
    .unique();
  if (!existing) return false;

  await ctx.db.patch(existing._id, {
    status: "cleared",
    note:
      normalizeOptionalText("note", args.note, 4_000) ?? existing.note,
    updatedAt: args.now ?? Date.now(),
  });
  return true;
};

const cacheKeyArgs = {
  wikiPageId: v.string(),
  revisionId: v.string(),
  extractorVersion: v.string(),
  sourceHash: v.string(),
};

const blockKeyArgs = {
  wikiPageId: v.string(),
  revisionId: v.string(),
  blockId: v.string(),
  sourceHash: v.string(),
};

export const getArticleContextCache = query({
  args: cacheKeyArgs,
  handler: getArticleContextCacheForCtx,
});

export const getLatestArticleContextCache = query({
  args: {
    wikiPageId: v.string(),
    revisionId: v.string(),
    extractorVersion: v.string(),
  },
  handler: getLatestArticleContextCacheForCtx,
});

export const getArticleContextModeration = query({
  args: blockKeyArgs,
  handler: getArticleContextModerationForCtx,
});

export const saveArticleContextCache = action({
  args: {
    adminSecret: v.string(),
    ...cacheKeyArgs,
    manifestJson: v.string(),
  },
  handler: async (ctx, args) => {
    assertArticleContextWriteAuthorized(args.adminSecret);
    return ctx.runMutation(
      anyApi.articleContexts.upsertArticleContextCacheInternal,
      {
        wikiPageId: args.wikiPageId,
        revisionId: args.revisionId,
        extractorVersion: args.extractorVersion,
        sourceHash: args.sourceHash,
        manifestJson: args.manifestJson,
      },
    );
  },
});

export const removeArticleContextCache = action({
  args: { adminSecret: v.string(), ...cacheKeyArgs },
  handler: async (ctx, args) => {
    assertArticleContextWriteAuthorized(args.adminSecret);
    return ctx.runMutation(
      anyApi.articleContexts.removeArticleContextCacheInternal,
      {
        wikiPageId: args.wikiPageId,
        revisionId: args.revisionId,
        extractorVersion: args.extractorVersion,
        sourceHash: args.sourceHash,
      },
    );
  },
});

export const submitArticleContextReport = action({
  args: {
    adminSecret: v.string(),
    ...blockKeyArgs,
    reporterKey: v.string(),
    reason: reportReasonValidator,
    details: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    assertArticleContextWriteAuthorized(args.adminSecret);
    return ctx.runMutation(
      anyApi.articleContexts.submitArticleContextReportInternal,
      {
        wikiPageId: args.wikiPageId,
        revisionId: args.revisionId,
        blockId: args.blockId,
        sourceHash: args.sourceHash,
        reporterKey: args.reporterKey,
        reason: args.reason,
        details: args.details,
      },
    );
  },
});

export const setArticleContextModeration = action({
  args: {
    adminSecret: v.string(),
    ...blockKeyArgs,
    mode: moderationModeValidator,
    override: v.optional(contextTextOverrideValidator),
    note: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    assertArticleContextWriteAuthorized(args.adminSecret);
    return ctx.runMutation(
      anyApi.articleContexts.setArticleContextModerationInternal,
      {
        wikiPageId: args.wikiPageId,
        revisionId: args.revisionId,
        blockId: args.blockId,
        sourceHash: args.sourceHash,
        mode: args.mode,
        override: args.override,
        note: args.note,
      },
    );
  },
});

export const clearArticleContextModeration = action({
  args: {
    adminSecret: v.string(),
    ...blockKeyArgs,
    note: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    assertArticleContextWriteAuthorized(args.adminSecret);
    return ctx.runMutation(
      anyApi.articleContexts.clearArticleContextModerationInternal,
      {
        wikiPageId: args.wikiPageId,
        revisionId: args.revisionId,
        blockId: args.blockId,
        sourceHash: args.sourceHash,
        note: args.note,
      },
    );
  },
});

export const listArticleContextReports = action({
  args: {
    adminSecret: v.string(),
    status: v.optional(reportStatusValidator),
    limit: v.optional(v.number()),
  },
  handler: async (ctx, args) => {
    assertArticleContextWriteAuthorized(args.adminSecret);
    return ctx.runQuery(anyApi.articleContexts.listArticleContextReportsInternal, {
      status: args.status,
      limit: args.limit,
    });
  },
});

export const updateArticleContextReportStatus = action({
  args: {
    adminSecret: v.string(),
    reportId: v.id("articleContextReports"),
    status: reportStatusValidator,
    resolutionNote: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    assertArticleContextWriteAuthorized(args.adminSecret);
    return ctx.runMutation(
      anyApi.articleContexts.updateArticleContextReportStatusInternal,
      {
        reportId: args.reportId,
        status: args.status,
        resolutionNote: args.resolutionNote,
      },
    );
  },
});

export const upsertArticleContextCacheInternal = internalMutation({
  args: { ...cacheKeyArgs, manifestJson: v.string() },
  handler: upsertArticleContextCacheForCtx,
});

export const removeArticleContextCacheInternal = internalMutation({
  args: cacheKeyArgs,
  handler: removeArticleContextCacheForCtx,
});

export const submitArticleContextReportInternal = internalMutation({
  args: {
    ...blockKeyArgs,
    reporterKey: v.string(),
    reason: reportReasonValidator,
    details: v.optional(v.string()),
  },
  handler: submitArticleContextReportForCtx,
});

export const setArticleContextModerationInternal = internalMutation({
  args: {
    ...blockKeyArgs,
    mode: moderationModeValidator,
    override: v.optional(contextTextOverrideValidator),
    note: v.optional(v.string()),
  },
  handler: setArticleContextModerationForCtx,
});

export const clearArticleContextModerationInternal = internalMutation({
  args: { ...blockKeyArgs, note: v.optional(v.string()) },
  handler: clearArticleContextModerationForCtx,
});

export const updateArticleContextReportStatusInternal = internalMutation({
  args: {
    reportId: v.id("articleContextReports"),
    status: reportStatusValidator,
    resolutionNote: v.optional(v.string()),
  },
  handler: updateArticleContextReportStatusForCtx,
});

export const listArticleContextReportsInternal = internalQuery({
  args: {
    status: v.optional(reportStatusValidator),
    limit: v.optional(v.number()),
  },
  handler: async (ctx, args) => {
    const limit = Math.max(1, Math.min(100, Math.floor(args.limit ?? 50)));
    if (args.status) {
      return ctx.db
        .query("articleContextReports")
        .withIndex("by_status", (index) => index.eq("status", args.status!))
        .order("desc")
        .take(limit);
    }
    return ctx.db.query("articleContextReports").order("desc").take(limit);
  },
});
