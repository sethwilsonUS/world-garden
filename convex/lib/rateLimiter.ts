import { MutationCtx } from "../_generated/server";

type LimitConfig = {
  key: string;
  max: number;
  windowMs: number;
};

export const assertWithinRateLimit = async (
  ctx: MutationCtx,
  { key, max, windowMs }: LimitConfig,
) => {
  const now = Date.now();
  const existing = await ctx.db
    .query("rateLimits")
    .withIndex("by_key", (q) => q.eq("key", key))
    .first();

  if (!existing) {
    await ctx.db.insert("rateLimits", {
      key,
      windowStart: now,
      count: 1,
    });
    return;
  }

  const windowEnd = existing.windowStart + windowMs;
  if (now > windowEnd) {
    await ctx.db.patch(existing._id, {
      windowStart: now,
      count: 1,
    });
    return;
  }

  if (existing.count >= max) {
    throw new Error("Rate limit exceeded");
  }

  await ctx.db.patch(existing._id, {
    count: existing.count + 1,
  });
};
