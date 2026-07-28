import { v } from "convex/values";
import { paginationOptsValidator } from "convex/server";
import {
  assertProductFeedbackWriteAuthorized,
  normalizeProductFeedbackInput,
  type ProductFeedbackInput,
} from "../lib/product-feedback";
import {
  internalQuery,
  internalMutation,
  mutation,
  type MutationCtx,
  type QueryCtx,
} from "./_generated/server";
import { internal } from "./_generated/api";

export { assertProductFeedbackWriteAuthorized };

export const PRODUCT_FEEDBACK_CONTACT_RETENTION_MS = 180 * 24 * 60 * 60 * 1_000;
export const PRODUCT_FEEDBACK_CONTACT_CLEANUP_BATCH_SIZE = 100;

type WriteCtx = Pick<MutationCtx, "db">;
type ContactCleanupCtx = Pick<MutationCtx, "db">;
type OwnerReadCtx = Pick<QueryCtx, "db">;

const PRODUCT_FEEDBACK_OWNER_PAGE_SIZE = 100;

export const submitProductFeedbackForCtx = async (
  ctx: WriteCtx,
  args: ProductFeedbackInput & { now?: number },
) => {
  const feedback = normalizeProductFeedbackInput({
    kind: args.kind,
    message: args.message,
    environment: args.environment,
    contactEmail: args.contactEmail,
    researchOptIn: args.researchOptIn,
    articleTitle: args.articleTitle,
    articleSlug: args.articleSlug,
    articleRevisionId: args.articleRevisionId,
  });
  const now = args.now ?? Date.now();
  const feedbackId = await ctx.db.insert("productFeedback", {
    ...feedback,
    status: "open",
    ...(feedback.contactEmail
      ? {
          contactExpiresAt: now + PRODUCT_FEEDBACK_CONTACT_RETENTION_MS,
        }
      : {}),
    createdAt: now,
    updatedAt: now,
  });

  return { feedbackId };
};

const feedbackKindValidator = v.union(
  v.literal("accessibility"),
  v.literal("product"),
  v.literal("technical"),
  v.literal("other"),
);

const feedbackStatusValidator = v.union(
  v.literal("open"),
  v.literal("reviewing"),
  v.literal("resolved"),
  v.literal("dismissed"),
);

type FeedbackStatus = "open" | "reviewing" | "resolved" | "dismissed";

export const listProductFeedbackForOwnerForCtx = async (
  ctx: OwnerReadCtx,
  args: {
    paginationOpts: { cursor: string | null; numItems: number };
    // Intentionally unused by the reader: a unique value per CLI run prevents
    // Convex from reusing a cached first page whose snapshot depends on Date.now().
    reportRunId: string;
    status?: FeedbackStatus;
    snapshotBefore?: number;
    includeContact: boolean;
    now?: number;
  },
) => {
  const now = args.now ?? Date.now();
  const snapshotBefore = args.snapshotBefore ?? now;
  const requestedPageSize = Number.isFinite(args.paginationOpts.numItems)
    ? Math.trunc(args.paginationOpts.numItems)
    : PRODUCT_FEEDBACK_OWNER_PAGE_SIZE;
  const paginationOpts = {
    cursor: args.paginationOpts.cursor,
    numItems: Math.max(
      1,
      Math.min(PRODUCT_FEEDBACK_OWNER_PAGE_SIZE, requestedPageSize),
    ),
    maximumRowsRead: PRODUCT_FEEDBACK_OWNER_PAGE_SIZE,
  };
  const query = args.status
    ? ctx.db
        .query("productFeedback")
        .withIndex("by_status", (range) =>
          range.eq("status", args.status!).lte("_creationTime", snapshotBefore),
        )
        .order("desc")
    : ctx.db
        .query("productFeedback")
        .withIndex("by_creation_time", (range) =>
          range.lte("_creationTime", snapshotBefore),
        )
        .order("desc");
  const result = await query.paginate(paginationOpts);

  return {
    ...result,
    snapshotBefore,
    page: result.page.map((feedback) => {
      const contactAvailable =
        typeof feedback.contactEmail === "string" &&
        typeof feedback.contactExpiresAt === "number" &&
        feedback.contactExpiresAt > now;

      return {
        id: feedback._id,
        kind: feedback.kind,
        message: feedback.message,
        ...(feedback.environment ? { environment: feedback.environment } : {}),
        researchOptIn: contactAvailable && feedback.researchOptIn,
        status: feedback.status,
        contactAvailable,
        ...(contactAvailable
          ? { contactExpiresAt: feedback.contactExpiresAt }
          : {}),
        ...(contactAvailable && args.includeContact
          ? { contactEmail: feedback.contactEmail }
          : {}),
        ...(feedback.articleTitle
          ? { articleTitle: feedback.articleTitle }
          : {}),
        ...(feedback.articleSlug ? { articleSlug: feedback.articleSlug } : {}),
        ...(feedback.articleRevisionId
          ? { articleRevisionId: feedback.articleRevisionId }
          : {}),
        createdAt: feedback.createdAt,
        updatedAt: feedback.updatedAt,
      };
    }),
  };
};

export const listProductFeedbackForOwner = internalQuery({
  args: {
    paginationOpts: paginationOptsValidator,
    status: v.optional(feedbackStatusValidator),
    snapshotBefore: v.optional(v.number()),
    includeContact: v.boolean(),
    reportRunId: v.string(),
  },
  handler: async (ctx, args) =>
    await listProductFeedbackForOwnerForCtx(ctx, args),
});

export const submitProductFeedback = mutation({
  args: {
    adminSecret: v.string(),
    kind: feedbackKindValidator,
    message: v.string(),
    environment: v.optional(v.string()),
    contactEmail: v.optional(v.string()),
    researchOptIn: v.boolean(),
    articleTitle: v.optional(v.string()),
    articleSlug: v.optional(v.string()),
    articleRevisionId: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    assertProductFeedbackWriteAuthorized(args.adminSecret);
    return await submitProductFeedbackForCtx(ctx, {
      kind: args.kind,
      message: args.message,
      environment: args.environment,
      contactEmail: args.contactEmail,
      researchOptIn: args.researchOptIn,
      articleTitle: args.articleTitle,
      articleSlug: args.articleSlug,
      articleRevisionId: args.articleRevisionId,
    });
  },
});

export const scrubExpiredProductFeedbackContactsForCtx = async (
  ctx: ContactCleanupCtx,
  args: { now: number; limit: number },
) => {
  const expiredFeedback = await ctx.db
    .query("productFeedback")
    .withIndex("by_contactExpiresAt", (query) =>
      query.gte("contactExpiresAt", 0).lte("contactExpiresAt", args.now),
    )
    .take(args.limit);

  await Promise.all(
    expiredFeedback.map((feedback) =>
      ctx.db.patch(feedback._id, {
        contactEmail: undefined,
        contactExpiresAt: undefined,
        researchOptIn: false,
      }),
    ),
  );

  return { scrubbed: expiredFeedback.length };
};

export const shouldContinueProductFeedbackContactCleanup = ({
  scrubbed,
  limit,
}: {
  scrubbed: number;
  limit: number;
}): boolean => scrubbed === limit;

export const scrubExpiredProductFeedbackContacts = internalMutation({
  args: {},
  handler: async (ctx) => {
    const result = await scrubExpiredProductFeedbackContactsForCtx(ctx, {
      now: Date.now(),
      limit: PRODUCT_FEEDBACK_CONTACT_CLEANUP_BATCH_SIZE,
    });
    if (
      shouldContinueProductFeedbackContactCleanup({
        scrubbed: result.scrubbed,
        limit: PRODUCT_FEEDBACK_CONTACT_CLEANUP_BATCH_SIZE,
      })
    ) {
      await ctx.scheduler.runAfter(
        0,
        internal.productFeedback.scrubExpiredProductFeedbackContacts,
        {},
      );
    }
    return result;
  },
});
