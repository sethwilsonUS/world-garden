import { mutation } from "./_generated/server";
import { v } from "convex/values";

export const consumeRouteQuota = mutation({
  args: {
    key: v.string(),
    limit: v.number(),
    windowMs: v.number(),
    now: v.optional(v.number()),
  },
  async handler(ctx, args) {
    const now = args.now ?? Date.now();
    const limit = Math.max(1, Math.floor(args.limit));
    const windowMs = Math.max(1, Math.floor(args.windowMs));
    const existing = await ctx.db
      .query("routeQuotas")
      .withIndex("by_key", (q) => q.eq("key", args.key))
      .first();

    if (!existing || existing.expiresAt <= now) {
      const payload = {
        key: args.key,
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
