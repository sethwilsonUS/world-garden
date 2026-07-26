import { mutation } from "./_generated/server";
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
      process.env.TTS_QUOTA_BYPASS_SECRET?.trim() || undefined,
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
