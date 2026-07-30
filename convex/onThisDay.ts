import { v } from "convex/values";
import { mutation, query } from "./_generated/server";
import { assertPublicAudioWriteAttestation } from "../lib/public-audio-write-attestation";

const serverAttestationValidator = v.object({
  issuedAt: v.number(),
  expiresAt: v.number(),
  nonce: v.string(),
  signature: v.string(),
});

export const getOnThisDaySnapshotByDate = query({
  args: { feedDate: v.string() },
  async handler(ctx, args) {
    return await ctx.db
      .query("onThisDaySnapshots")
      .withIndex("by_feedDate", (q) => q.eq("feedDate", args.feedDate))
      .first();
  },
});

export const getLatestOnThisDaySnapshotForMonthDay = query({
  args: { monthDay: v.string() },
  async handler(ctx, args) {
    return await ctx.db
      .query("onThisDaySnapshots")
      .withIndex("by_monthDay_updatedAt", (q) =>
        q.eq("monthDay", args.monthDay),
      )
      .order("desc")
      .first();
  },
});

export const saveOnThisDaySnapshot = mutation({
  args: {
    feedDate: v.string(),
    monthDay: v.string(),
    data: v.any(),
    generatedAt: v.number(),
    attestation: serverAttestationValidator,
  },
  async handler(ctx, args) {
    const { attestation, ...writeArgs } = args;
    await assertPublicAudioWriteAttestation({
      pipeline: "on-this-day",
      operation: "save-record",
      args: writeArgs,
      attestation,
    });
    const existing = await ctx.db
      .query("onThisDaySnapshots")
      .withIndex("by_feedDate", (q) => q.eq("feedDate", args.feedDate))
      .first();
    const now = Date.now();

    if (existing) {
      await ctx.db.patch(existing._id, {
        monthDay: args.monthDay,
        data: args.data,
        generatedAt: args.generatedAt,
        updatedAt: now,
      });
      return existing._id;
    }

    return await ctx.db.insert("onThisDaySnapshots", {
      ...writeArgs,
      createdAt: now,
      updatedAt: now,
    });
  },
});
