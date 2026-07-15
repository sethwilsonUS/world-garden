import type { Id } from "./_generated/dataModel";
import type { MutationCtx, QueryCtx } from "./_generated/server";
import {
  assertBoundedKeyPart,
  assertValidBlockKey,
  normalizeOptionalText,
  type ArticleContextBlockKey,
  type ArticleContextReportReason,
  type ArticleContextReportStatus,
} from "./articleContextValidation";

export const MAX_REPORTERS_PER_CONTEXT_BLOCK = 50;

type ReadCtx = Pick<QueryCtx, "db">;
type WriteCtx = Pick<MutationCtx, "db">;

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

export const listArticleContextReportsForCtx = async (
  ctx: ReadCtx,
  args: { status?: ArticleContextReportStatus; limit?: number },
) => {
  const limit = Math.max(1, Math.min(100, Math.floor(args.limit ?? 50)));
  const status = args.status;
  if (status) {
    return ctx.db
      .query("articleContextReports")
      .withIndex("by_status", (index) => index.eq("status", status))
      .order("desc")
      .take(limit);
  }
  return ctx.db.query("articleContextReports").order("desc").take(limit);
};
