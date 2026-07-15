import { anyApi } from "convex/server";
import { v } from "convex/values";
import {
  action,
  internalMutation,
  internalQuery,
  query,
} from "./_generated/server";
import {
  getArticleContextCacheForCtx,
  getLatestArticleContextCacheForCtx,
  removeArticleContextCacheForCtx,
  upsertArticleContextCacheForCtx,
} from "./articleContextCache";
import {
  clearArticleContextModerationForCtx,
  getArticleContextModerationForCtx,
  setArticleContextModerationForCtx,
} from "./articleContextModeration";
import {
  listArticleContextReportsForCtx,
  submitArticleContextReportForCtx,
  updateArticleContextReportStatusForCtx,
} from "./articleContextReports";
import { assertArticleContextWriteAuthorized } from "./articleContextValidation";

export {
  MAX_CACHE_VARIANTS_PER_REVISION,
  getArticleContextCacheForCtx,
  getLatestArticleContextCacheForCtx,
  removeArticleContextCacheForCtx,
  upsertArticleContextCacheForCtx,
} from "./articleContextCache";
export {
  clearArticleContextModerationForCtx,
  getArticleContextModerationForCtx,
  setArticleContextModerationForCtx,
} from "./articleContextModeration";
export {
  MAX_REPORTERS_PER_CONTEXT_BLOCK,
  listArticleContextReportsForCtx,
  submitArticleContextReportForCtx,
  updateArticleContextReportStatusForCtx,
} from "./articleContextReports";
export {
  ARTICLE_CONTEXT_SCHEMA_VERSION,
  MAX_ARTICLE_CONTEXT_BLOCKS,
  MAX_ARTICLE_CONTEXT_MANIFEST_BYTES,
  assertArticleContextWriteAuthorized,
  assertValidBlockKey,
  assertValidCacheKey,
  validateAndNormalizeManifestJson,
  validateTextOverride,
} from "./articleContextValidation";
export type {
  ArticleContextBlockKey,
  ArticleContextCacheKey,
  ArticleContextReportReason,
  ArticleContextReportStatus,
  ArticleContextTextOverride,
} from "./articleContextValidation";

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
  handler: listArticleContextReportsForCtx,
});
