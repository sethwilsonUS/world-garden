import { mutation, query } from "./_generated/server";
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

export const upsertAnalyticsRollups = mutation({
  args: {
    rollups: v.array(analyticsRollupInput),
  },
  handler: async (ctx, args) => {
    const now = Date.now();
    let inserted = 0;
    let updated = 0;

    for (const rollup of args.rollups) {
      const existing = await ctx.db
        .query("analyticsRollups")
        .withIndex("by_key", (q) => q.eq("key", rollup.key))
        .unique();

      if (existing) {
        await ctx.db.patch(existing._id, {
          count: existing.count + rollup.count,
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

    return {
      inserted,
      updated,
      upserted: inserted + updated,
    };
  },
});

export const getAnalyticsRollups = query({
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
