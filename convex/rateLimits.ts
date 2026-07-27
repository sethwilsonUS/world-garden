import {
  internalMutation,
  mutation,
  type MutationCtx,
} from "./_generated/server";
import { v } from "convex/values";
import {
  assertValidRouteQuotaParameters,
  getRouteQuotaAttestationPayload,
  ROUTE_QUOTA_ATTESTATION_SCOPE,
  type RouteQuotaParameters,
} from "../lib/route-quota-attestation";
import {
  type ServerAttestation,
  verifyServerAttestation,
} from "../lib/server-attestation";
import { internal } from "./_generated/api";

export const ROUTE_QUOTA_CLEANUP_BATCH_SIZE = 500;
const PRODUCT_FEEDBACK_QUOTA_PREFIX = "route-quota:product-feedback:";

type RouteQuotaCleanupCtx = Pick<MutationCtx, "db">;
type QuotaEnvironment = Record<string, string | undefined>;

export const getRouteQuotaAttestationSecret = (
  key: string,
  environment: QuotaEnvironment = process.env,
): string | undefined =>
  (key.startsWith(PRODUCT_FEEDBACK_QUOTA_PREFIX)
    ? environment.PRODUCT_FEEDBACK_WRITE_SECRET
    : environment.TTS_QUOTA_BYPASS_SECRET
  )?.trim() || undefined;

export const assertRouteQuotaAttestation = async (
  parameters: RouteQuotaParameters,
  attestation: ServerAttestation,
  secret: string | undefined,
  now = Date.now(),
): Promise<void> => {
  assertValidRouteQuotaParameters(parameters);
  const valid = await verifyServerAttestation({
    attestation,
    scope: ROUTE_QUOTA_ATTESTATION_SCOPE,
    payload: getRouteQuotaAttestationPayload(parameters),
    secret,
    now,
  });
  if (!valid) {
    throw new Error("Invalid or expired route quota attestation.");
  }
};

export const consumeRouteQuota = mutation({
  args: {
    key: v.string(),
    limit: v.number(),
    windowMs: v.number(),
    attestation: v.object({
      issuedAt: v.number(),
      expiresAt: v.number(),
      nonce: v.string(),
      signature: v.string(),
    }),
  },
  async handler(ctx, args) {
    const { key, limit, windowMs, attestation } = args;
    const now = Date.now();
    await assertRouteQuotaAttestation(
      { key, limit, windowMs },
      attestation,
      getRouteQuotaAttestationSecret(key),
      now,
    );
    const existing = await ctx.db
      .query("routeQuotas")
      .withIndex("by_key", (q) => q.eq("key", key))
      .first();

    if (!existing || existing.expiresAt <= now) {
      const payload = {
        key,
        count: 1,
        windowStart: now,
        expiresAt: now + windowMs,
        updatedAt: now,
      };

      if (existing) {
        await ctx.db.patch(existing._id, payload);
      } else {
        await ctx.db.insert("routeQuotas", {
          ...payload,
          createdAt: now,
        });
      }

      return {
        allowed: true,
        remaining: Math.max(0, limit - 1),
        resetAt: now + windowMs,
      };
    }

    if (existing.count >= limit) {
      return {
        allowed: false,
        remaining: 0,
        resetAt: existing.expiresAt,
      };
    }

    const nextCount = existing.count + 1;
    await ctx.db.patch(existing._id, {
      count: nextCount,
      updatedAt: now,
    });

    return {
      allowed: true,
      remaining: Math.max(0, limit - nextCount),
      resetAt: existing.expiresAt,
    };
  },
});

export const cleanupExpiredRouteQuotasForCtx = async (
  ctx: RouteQuotaCleanupCtx,
  args: { now: number; limit: number },
) => {
  const expiredQuotas = await ctx.db
    .query("routeQuotas")
    .withIndex("by_expiresAt", (query) => query.lte("expiresAt", args.now))
    .take(args.limit);

  await Promise.all(expiredQuotas.map((quota) => ctx.db.delete(quota._id)));

  return { deleted: expiredQuotas.length };
};

export const shouldContinueRouteQuotaCleanup = ({
  deleted,
  limit,
}: {
  deleted: number;
  limit: number;
}): boolean => deleted === limit;

export const cleanupExpiredRouteQuotas = internalMutation({
  args: {},
  handler: async (ctx) => {
    const result = await cleanupExpiredRouteQuotasForCtx(ctx, {
      now: Date.now(),
      limit: ROUTE_QUOTA_CLEANUP_BATCH_SIZE,
    });
    if (
      shouldContinueRouteQuotaCleanup({
        deleted: result.deleted,
        limit: ROUTE_QUOTA_CLEANUP_BATCH_SIZE,
      })
    ) {
      await ctx.scheduler.runAfter(
        0,
        internal.rateLimits.cleanupExpiredRouteQuotas,
        {},
      );
    }
    return result;
  },
});
