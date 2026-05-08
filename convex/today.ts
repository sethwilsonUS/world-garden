import { mutation, query } from "./_generated/server";
import { v } from "convex/values";

export const getTodaySnapshotByDate = query({
  args: {
    feedDate: v.string(),
  },
  async handler(ctx, args) {
    return await ctx.db
      .query("todaySnapshots")
      .withIndex("by_feedDate", (q) => q.eq("feedDate", args.feedDate))
      .first();
  },
});

export const getLatestTodaySnapshot = query({
  args: {},
  async handler(ctx) {
    return await ctx.db
      .query("todaySnapshots")
      .withIndex("by_updatedAt")
      .order("desc")
      .first();
  },
});

export const saveTodaySnapshot = mutation({
  args: {
    feedDate: v.string(),
    data: v.any(),
    generatedAt: v.number(),
  },
  async handler(ctx, args) {
    const existing = await ctx.db
      .query("todaySnapshots")
      .withIndex("by_feedDate", (q) => q.eq("feedDate", args.feedDate))
      .first();

    const now = Date.now();

    if (existing) {
      await ctx.db.patch(existing._id, {
        data: args.data,
        generatedAt: args.generatedAt,
        updatedAt: now,
      });
      return existing._id;
    }

    return await ctx.db.insert("todaySnapshots", {
      feedDate: args.feedDate,
      data: args.data,
      generatedAt: args.generatedAt,
      createdAt: now,
      updatedAt: now,
    });
  },
});
