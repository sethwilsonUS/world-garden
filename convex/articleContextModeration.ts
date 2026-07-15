import type { MutationCtx, QueryCtx } from "./_generated/server";
import {
  assertValidBlockKey,
  normalizeOptionalText,
  validateTextOverride,
  type ArticleContextBlockKey,
  type ArticleContextTextOverride,
} from "./articleContextValidation";

type ReadCtx = Pick<QueryCtx, "db">;
type WriteCtx = Pick<MutationCtx, "db">;

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
    note: normalizeOptionalText("note", args.note, 4_000) ?? existing.note,
    updatedAt: args.now ?? Date.now(),
  });
  return true;
};
