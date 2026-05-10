import { anyApi } from "convex/server";
import { action, internalMutation, internalQuery } from "./_generated/server";
import { v } from "convex/values";

const analyticsRollupInput = v.object({
  key: v.string(),
  bucketStart: v.number(),
  source: v.string(),
  eventType: v.string(),
  eventName: v.optional(v.string()),
  path: v.optional(v.string()),
  dimensionsJson: v.string(),
  count: v.number(),
});

const MAX_DELIVERY_TTL_MS = 7 * 24 * 60 * 60 * 1000;

export const assertValidRollupCount = (count: number) => {
  if (!Number.isSafeInteger(count) || count <= 0) {
    throw new Error("Rollup counts must be positive integers");
  }
};

export const addRollupCounts = (
  existingCount: number,
  incomingCount: number,
) => {
  const nextCount = existingCount + incomingCount;
  if (
    !Number.isSafeInteger(existingCount) ||
    existingCount < 0 ||
    !Number.isSafeInteger(nextCount)
  ) {
    throw new Error("Rollup count overflow");
  }
  return nextCount;
};

export const assertValidDeliveryExpiry = (
  deliveryExpiresAt: number,
  now = Date.now(),
) => {
  if (
    !Number.isSafeInteger(deliveryExpiresAt) ||
    deliveryExpiresAt <= now ||
    deliveryExpiresAt > now + MAX_DELIVERY_TTL_MS
  ) {
    throw new Error(
      "deliveryExpiresAt must be a future Unix ms timestamp within 7 days",
    );
  }
};

const requireAnalyticsSecret = (providedSecret: string) => {
  const expectedSecret = process.env.ANALYTICS_REPORT_SECRET?.trim();
  if (!expectedSecret) {
    throw new Error("ANALYTICS_REPORT_SECRET is not configured in Convex");
  }
  if (providedSecret !== expectedSecret) {
    throw new Error("Unauthorized");
  }
};

export const ingestAnalyticsRollups = action({
  args: {
    adminSecret: v.string(),
    deliveryKey: v.string(),
    deliveryExpiresAt: v.number(),
    rollups: v.array(analyticsRollupInput),
  },
  handler: async (ctx, args) => {
    requireAnalyticsSecret(args.adminSecret);
    return ctx.runMutation(anyApi.analyticsRollups.upsertAnalyticsRollups, {
      deliveryKey: args.deliveryKey,
      deliveryExpiresAt: args.deliveryExpiresAt,
      rollups: args.rollups,
    });
  },
});

export const readAnalyticsRollups = action({
  args: {
    adminSecret: v.string(),
    since: v.number(),
    until: v.number(),
  },
  handler: async (ctx, args) => {
    requireAnalyticsSecret(args.adminSecret);
    return ctx.runQuery(anyApi.analyticsRollups.getAnalyticsRollups, {
      since: args.since,
      until: args.until,
    });
  },
});

export const upsertAnalyticsRollups = internalMutation({
  args: {
    deliveryKey: v.string(),
    deliveryExpiresAt: v.number(),
    rollups: v.array(analyticsRollupInput),
  },
  handler: async (ctx, args) => {
    const now = Date.now();
    assertValidDeliveryExpiry(args.deliveryExpiresAt, now);

    let inserted = 0;
    let updated = 0;

    const existingDelivery = await ctx.db
      .query("analyticsDrainDeliveries")
      .withIndex("by_key", (q) => q.eq("key", args.deliveryKey))
      .unique();

    if (existingDelivery && existingDelivery.expiresAt > now) {
      return {
        duplicate: true,
        inserted,
        updated,
        upserted: 0,
      };
    }

    for (const rollup of args.rollups) {
      assertValidRollupCount(rollup.count);

      const existing = await ctx.db
        .query("analyticsRollups")
        .withIndex("by_key", (q) => q.eq("key", rollup.key))
        .unique();

      if (existing) {
        const nextCount = addRollupCounts(existing.count, rollup.count);

        await ctx.db.patch(existing._id, {
          count: nextCount,
          updatedAt: now,
        });
        updated += 1;
        continue;
      }

      await ctx.db.insert("analyticsRollups", {
        ...rollup,
        createdAt: now,
        updatedAt: now,
      });
      inserted += 1;
    }

    if (existingDelivery) {
      await ctx.db.patch(existingDelivery._id, {
        expiresAt: args.deliveryExpiresAt,
        updatedAt: now,
      });
    } else {
      await ctx.db.insert("analyticsDrainDeliveries", {
        key: args.deliveryKey,
        expiresAt: args.deliveryExpiresAt,
        createdAt: now,
        updatedAt: now,
      });
    }

    return {
      duplicate: false,
      inserted,
      updated,
      upserted: inserted + updated,
    };
  },
});

export const getAnalyticsRollups = internalQuery({
  args: {
    since: v.number(),
    until: v.number(),
  },
  handler: async (ctx, args) => {
    if (args.until <= args.since) {
      return [];
    }

    return ctx.db
      .query("analyticsRollups")
      .withIndex("by_bucketStart", (q) =>
        q.gte("bucketStart", args.since).lt("bucketStart", args.until),
      )
      .collect();
  },
});
