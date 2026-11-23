import { v } from "convex/values";
import { mutation, query } from "./_generated/server";
import { assertPublicAudioWriteAttestation } from "../lib/public-audio-write-attestation";

const serverAttestationValidator = v.object({
  issuedAt: v.number(),
  expiresAt: v.number(),
  nonce: v.string(),
  signature: v.string(),
});

export const getDaySnapshot = query({
  args: { monthDay: v.string() },
  async handler(ctx, args) {
    const [dayRecord, stateRecord] = await Promise.all([
      ctx.db
        .query("onThisDayDays")
        .withIndex("by_monthDay", (q) => q.eq("monthDay", args.monthDay))
        .first(),
      ctx.db
        .query("onThisDayRefreshState")
        .withIndex("by_monthDay", (q) => q.eq("monthDay", args.monthDay))
        .first(),
    ]);

    if (!dayRecord) return null;

    return {
      monthDay: dayRecord.monthDay,
      schemaVersion: dayRecord.schemaVersion,
      contentHash: dayRecord.contentHash,
      data: dayRecord.data,
      state: stateRecord
        ? {
            monthDay: stateRecord.monthDay,
            schemaVersion: stateRecord.schemaVersion,
            degraded: stateRecord.degraded,
            checkedAt: stateRecord.checkedAt,
            changedAt: stateRecord.changedAt,
            imagesCheckedAt: stateRecord.imagesCheckedAt,
            lastAttemptAt: stateRecord.lastAttemptAt,
            lastError: stateRecord.lastError,
            suspiciousStreak: stateRecord.suspiciousStreak,
            refreshLeaseUntil: stateRecord.refreshLeaseUntil,
          }
        : null,
    };
  },
});

export const listRefreshStates = query({
  args: {},
  async handler(ctx) {
    const rows = await ctx.db
      .query("onThisDayRefreshState")
      .withIndex("by_checkedAt")
      .collect();

    return rows.map((row) => ({
      monthDay: row.monthDay,
      schemaVersion: row.schemaVersion,
      degraded: row.degraded,
      checkedAt: row.checkedAt,
      changedAt: row.changedAt,
      imagesCheckedAt: row.imagesCheckedAt,
      lastAttemptAt: row.lastAttemptAt,
      lastError: row.lastError,
      suspiciousStreak: row.suspiciousStreak,
      refreshLeaseUntil: row.refreshLeaseUntil,
    }));
  },
});

export const saveDaySnapshot = mutation({
  args: {
    monthDay: v.string(),
    schemaVersion: v.number(),
    data: v.any(),
    contentHash: v.string(),
    degraded: v.boolean(),
    checkedAt: v.number(),
    changedAt: v.number(),
    imagesCheckedAt: v.number(),
    lastAttemptAt: v.number(),
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

    const now = Date.now();
    const [existingDay, existingState] = await Promise.all([
      ctx.db
        .query("onThisDayDays")
        .withIndex("by_monthDay", (q) => q.eq("monthDay", args.monthDay))
        .first(),
      ctx.db
        .query("onThisDayRefreshState")
        .withIndex("by_monthDay", (q) => q.eq("monthDay", args.monthDay))
        .first(),
    ]);

    let dayId;
    if (existingDay) {
      await ctx.db.patch(existingDay._id, {
        schemaVersion: args.schemaVersion,
        data: args.data,
        contentHash: args.contentHash,
        updatedAt: now,
      });
      dayId = existingDay._id;
    } else {
      dayId = await ctx.db.insert("onThisDayDays", {
        monthDay: args.monthDay,
        schemaVersion: args.schemaVersion,
        data: args.data,
        contentHash: args.contentHash,
        createdAt: now,
        updatedAt: now,
      });
    }

    const statePatch = {
      schemaVersion: args.schemaVersion,
      degraded: args.degraded,
      checkedAt: args.checkedAt,
      changedAt: args.changedAt,
      imagesCheckedAt: args.imagesCheckedAt,
      lastAttemptAt: args.lastAttemptAt,
      lastError: undefined,
      suspiciousStreak: 0,
      refreshLeaseUntil: undefined,
      updatedAt: now,
    };

    if (existingState) {
      await ctx.db.patch(existingState._id, statePatch);
    } else {
      await ctx.db.insert("onThisDayRefreshState", {
        monthDay: args.monthDay,
        ...statePatch,
        createdAt: now,
      });
    }

    return dayId;
  },
});

export const markDayCheckedUnchanged = mutation({
  args: {
    monthDay: v.string(),
    schemaVersion: v.number(),
    checkedAt: v.number(),
    imagesCheckedAt: v.number(),
    lastAttemptAt: v.number(),
    attestation: serverAttestationValidator,
  },
  async handler(ctx, args) {
    const { attestation, ...writeArgs } = args;
    await assertPublicAudioWriteAttestation({
      pipeline: "on-this-day",
      operation: "finalize-job",
      args: writeArgs,
      attestation,
    });

    const existingState = await ctx.db
      .query("onThisDayRefreshState")
      .withIndex("by_monthDay", (q) => q.eq("monthDay", args.monthDay))
      .first();

    const now = Date.now();
    const patch = {
      schemaVersion: args.schemaVersion,
      degraded: false,
      checkedAt: args.checkedAt,
      imagesCheckedAt: args.imagesCheckedAt,
      lastAttemptAt: args.lastAttemptAt,
      lastError: undefined,
      suspiciousStreak: 0,
      refreshLeaseUntil: undefined,
      updatedAt: now,
    };

    if (existingState) {
      await ctx.db.patch(existingState._id, patch);
      return existingState._id;
    }

    return await ctx.db.insert("onThisDayRefreshState", {
      monthDay: args.monthDay,
      ...patch,
      changedAt: args.checkedAt,
      createdAt: now,
    });
  },
});

export const recordRefreshFailure = mutation({
  args: {
    monthDay: v.string(),
    lastAttemptAt: v.number(),
    lastError: v.string(),
    suspicious: v.boolean(),
    attestation: serverAttestationValidator,
  },
  async handler(ctx, args) {
    const { attestation, ...writeArgs } = args;
    await assertPublicAudioWriteAttestation({
      pipeline: "on-this-day",
      operation: "upsert-job",
      args: writeArgs,
      attestation,
    });

    const existingState = await ctx.db
      .query("onThisDayRefreshState")
      .withIndex("by_monthDay", (q) => q.eq("monthDay", args.monthDay))
      .first();

    const now = Date.now();
    const nextStreak = args.suspicious
      ? (existingState?.suspiciousStreak ?? 0) + 1
      : (existingState?.suspiciousStreak ?? 0);

    if (existingState) {
      await ctx.db.patch(existingState._id, {
        lastAttemptAt: args.lastAttemptAt,
        lastError: args.lastError,
        suspiciousStreak: nextStreak,
        refreshLeaseUntil: undefined,
        updatedAt: now,
      });
      return { id: existingState._id, suspiciousStreak: nextStreak };
    }

    const id = await ctx.db.insert("onThisDayRefreshState", {
      monthDay: args.monthDay,
      schemaVersion: 0,
      degraded: false,
      checkedAt: 0,
      changedAt: 0,
      imagesCheckedAt: 0,
      lastAttemptAt: args.lastAttemptAt,
      lastError: args.lastError,
      suspiciousStreak: nextStreak,
      refreshLeaseUntil: undefined,
      createdAt: now,
      updatedAt: now,
    });

    return { id, suspiciousStreak: nextStreak };
  },
});

export const claimRefreshLease = mutation({
  args: {
    monthDay: v.string(),
    now: v.number(),
    ttlMs: v.number(),
    attestation: serverAttestationValidator,
  },
  async handler(ctx, args) {
    const { attestation, ...writeArgs } = args;
    await assertPublicAudioWriteAttestation({
      pipeline: "on-this-day",
      operation: "claim-job",
      args: writeArgs,
      attestation,
    });

    const existingState = await ctx.db
      .query("onThisDayRefreshState")
      .withIndex("by_monthDay", (q) => q.eq("monthDay", args.monthDay))
      .first();

    if (
      existingState?.refreshLeaseUntil != null &&
      existingState.refreshLeaseUntil > args.now
    ) {
      return false;
    }

    const leaseUntil = args.now + args.ttlMs;
    const now = Date.now();
    if (existingState) {
      await ctx.db.patch(existingState._id, {
        refreshLeaseUntil: leaseUntil,
        updatedAt: now,
      });
    } else {
      await ctx.db.insert("onThisDayRefreshState", {
        monthDay: args.monthDay,
        schemaVersion: 0,
        degraded: false,
        checkedAt: 0,
        changedAt: 0,
        imagesCheckedAt: 0,
        suspiciousStreak: 0,
        refreshLeaseUntil: leaseUntil,
        createdAt: now,
        updatedAt: now,
      });
    }

    return true;
  },
});
