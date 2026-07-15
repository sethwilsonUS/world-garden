import type { Id } from "./_generated/dataModel";
import type { MutationCtx, QueryCtx } from "./_generated/server";
import {
  assertBoundedKeyPart,
  assertValidCacheKey,
  validateAndNormalizeManifestJson,
  type ArticleContextCacheKey,
} from "./articleContextValidation";

export const MAX_CACHE_VARIANTS_PER_REVISION = 4;

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
