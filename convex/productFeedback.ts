import { v } from "convex/values";
import {
  assertProductFeedbackWriteAuthorized,
  normalizeProductFeedbackInput,
  type ProductFeedbackInput,
} from "../lib/product-feedback";
import {
  internalMutation,
  mutation,
  type MutationCtx,
} from "./_generated/server";
import { internal } from "./_generated/api";

export { assertProductFeedbackWriteAuthorized };

export const PRODUCT_FEEDBACK_CONTACT_RETENTION_MS = 180 * 24 * 60 * 60 * 1_000;
export const PRODUCT_FEEDBACK_CONTACT_CLEANUP_BATCH_SIZE = 100;

type WriteCtx = Pick<MutationCtx, "db">;
type ContactCleanupCtx = Pick<MutationCtx, "db">;

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
