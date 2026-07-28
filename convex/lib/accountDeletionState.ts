import type { MutationCtx, QueryCtx } from "../_generated/server";

type AccountDeletionStateCtx = Pick<QueryCtx, "db"> | Pick<MutationCtx, "db">;

export const ACCOUNT_DELETION_IN_PROGRESS =
  "ACCOUNT_DELETION_IN_PROGRESS" as const;

export const isViewerAccountDeletionActiveForCtx = async (
  ctx: AccountDeletionStateCtx,
  viewerTokenIdentifier: string,
): Promise<boolean> => {
  const request = await ctx.db
    .query("accountDeletionRequests")
    .withIndex("by_viewerTokenIdentifier", (query) =>
      query.eq("viewerTokenIdentifier", viewerTokenIdentifier),
    )
    .first();

  return request !== null;
};

export const assertViewerAccountActiveForCtx = async (
  ctx: AccountDeletionStateCtx,
  viewerTokenIdentifier: string,
): Promise<void> => {
  if (await isViewerAccountDeletionActiveForCtx(ctx, viewerTokenIdentifier)) {
    throw new Error(ACCOUNT_DELETION_IN_PROGRESS);
  }
};
