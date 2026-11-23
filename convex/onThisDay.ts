import { v } from "convex/values";
import { mutation, query } from "./_generated/server";
import { assertPublicAudioWriteAttestation } from "../lib/public-audio-write-attestation";

const serverAttestationValidator = v.object({
  issuedAt: v.number(),
  expiresAt: v.number(),
  nonce: v.string(),
  signature: v.string(),
});

const shareCardPlateValidator = v.object({
  year: v.optional(v.number()),
  articleTitle: v.string(),
  imageUrl: v.string(),
  licenseName: v.optional(v.string()),
  creator: v.optional(v.string()),
  sourceUrl: v.optional(v.string()),
});

const serializeRefreshState = (row: {
  monthDay: string;
  schemaVersion: number;
  degraded: boolean;
  checkedAt: number;
  changedAt: number;
  imagesCheckedAt: number;
  pendingImageEnrichment?: boolean;
  lastAttemptAt?: number;
  lastError?: string;
  suspiciousStreak: number;
  refreshLeaseUntil?: number;
}) => ({
  monthDay: row.monthDay,
  schemaVersion: row.schemaVersion,
  degraded: row.degraded,
  checkedAt: row.checkedAt,
  changedAt: row.changedAt,
  imagesCheckedAt: row.imagesCheckedAt,
  pendingImageEnrichment: row.pendingImageEnrichment,
  lastAttemptAt: row.lastAttemptAt,
  lastError: row.lastError,
  suspiciousStreak: row.suspiciousStreak,
  refreshLeaseUntil: row.refreshLeaseUntil,
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
      state: stateRecord ? serializeRefreshState(stateRecord) : null,
    };
  },
});

/**
 * Read-only rollout fallback to the legacy `onThisDaySnapshots` table while
 * the initial backfill populates `onThisDayDays`.
 */
export const getLegacySnapshotForMonthDay = query({
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

export const listRefreshStates = query({
  args: {},
  async handler(ctx) {
    const rows = await ctx.db
      .query("onThisDayRefreshState")
      .withIndex("by_checkedAt")
      .collect();

    return rows.map(serializeRefreshState);
  },
});

export const claimRefreshLease = mutation({
  args: {
    monthDay: v.string(),
    now: v.number(),
    ttlMs: v.number(),
    leaseToken: v.string(),
    minRetryIntervalMs: v.optional(v.number()),
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

    if (
      args.minRetryIntervalMs != null &&
      existingState?.lastAttemptAt != null &&
      args.now - existingState.lastAttemptAt < args.minRetryIntervalMs
    ) {
      return false;
    }

    const leaseUntil = args.now + args.ttlMs;
    const now = Date.now();
    if (existingState) {
      await ctx.db.patch(existingState._id, {
        refreshLeaseUntil: leaseUntil,
        refreshLeaseToken: args.leaseToken,
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
        refreshLeaseToken: args.leaseToken,
        createdAt: now,
        updatedAt: now,
      });
    }

    return true;
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
    pendingImageEnrichment: v.optional(v.boolean()),
    lastAttemptAt: v.number(),
    leaseToken: v.string(),
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

    if (existingState?.refreshLeaseToken !== args.leaseToken) {
      return { applied: false as const, superseded: true as const };
    }

    const existingIsFullSnapshot =
      existingDay != null &&
      !(
        existingState.degraded ||
        existingDay.data?.provider === "featured-fallback"
      );
    if (args.degraded && existingIsFullSnapshot) {
      await ctx.db.patch(existingState._id, {
        refreshLeaseUntil: undefined,
        refreshLeaseToken: undefined,
        updatedAt: Date.now(),
      });
      return { applied: false as const, superseded: true as const };
    }

    const now = Date.now();
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

    await ctx.db.patch(existingState._id, {
      schemaVersion: args.schemaVersion,
      degraded: args.degraded,
      checkedAt: args.checkedAt,
      changedAt: args.changedAt,
      imagesCheckedAt: args.imagesCheckedAt,
      pendingImageEnrichment: args.pendingImageEnrichment ?? false,
      lastAttemptAt: args.lastAttemptAt,
      lastError: undefined,
      suspiciousStreak: 0,
      refreshLeaseUntil: undefined,
      refreshLeaseToken: undefined,
      updatedAt: now,
    });

    return { applied: true as const, superseded: false as const, id: dayId };
  },
});

export const insertDaySnapshotIfMissing = mutation({
  args: {
    monthDay: v.string(),
    schemaVersion: v.number(),
    data: v.any(),
    contentHash: v.string(),
    degraded: v.boolean(),
    checkedAt: v.number(),
    changedAt: v.number(),
    imagesCheckedAt: v.number(),
    pendingImageEnrichment: v.optional(v.boolean()),
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

    if (existingDay) {
      return {
        inserted: false as const,
        existing: {
          monthDay: existingDay.monthDay,
          schemaVersion: existingDay.schemaVersion,
          contentHash: existingDay.contentHash,
          data: existingDay.data,
          state: existingState ? serializeRefreshState(existingState) : null,
        },
      };
    }

    const now = Date.now();
    await ctx.db.insert("onThisDayDays", {
      monthDay: args.monthDay,
      schemaVersion: args.schemaVersion,
      data: args.data,
      contentHash: args.contentHash,
      createdAt: now,
      updatedAt: now,
    });

    const stateFields = {
      schemaVersion: args.schemaVersion,
      degraded: args.degraded,
      checkedAt: args.checkedAt,
      changedAt: args.changedAt,
      imagesCheckedAt: args.imagesCheckedAt,
      pendingImageEnrichment:
        args.pendingImageEnrichment ?? args.imagesCheckedAt <= 0,
      lastAttemptAt: args.lastAttemptAt,
      lastError: undefined,
      suspiciousStreak: 0,
      updatedAt: now,
    };

    if (existingState) {
      await ctx.db.patch(existingState._id, stateFields);
    } else {
      await ctx.db.insert("onThisDayRefreshState", {
        monthDay: args.monthDay,
        ...stateFields,
        createdAt: now,
      });
    }

    return { inserted: true as const };
  },
});

export const markDayCheckedUnchanged = mutation({
  args: {
    monthDay: v.string(),
    schemaVersion: v.number(),
    checkedAt: v.number(),
    imagesCheckedAt: v.number(),
    pendingImageEnrichment: v.optional(v.boolean()),
    lastAttemptAt: v.number(),
    leaseToken: v.string(),
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

    if (existingState?.refreshLeaseToken !== args.leaseToken) {
      return { applied: false as const, superseded: true as const };
    }

    const now = Date.now();
    await ctx.db.patch(existingState._id, {
      schemaVersion: args.schemaVersion,
      degraded: false,
      checkedAt: args.checkedAt,
      imagesCheckedAt: args.imagesCheckedAt,
      pendingImageEnrichment: args.pendingImageEnrichment ?? false,
      lastAttemptAt: args.lastAttemptAt,
      lastError: undefined,
      suspiciousStreak: 0,
      refreshLeaseUntil: undefined,
      refreshLeaseToken: undefined,
      updatedAt: now,
    });

    return {
      applied: true as const,
      superseded: false as const,
      id: existingState._id,
    };
  },
});

export const recordRefreshFailure = mutation({
  args: {
    monthDay: v.string(),
    lastAttemptAt: v.number(),
    lastError: v.string(),
    suspicious: v.boolean(),
    leaseToken: v.string(),
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

    if (existingState?.refreshLeaseToken !== args.leaseToken) {
      return {
        applied: false as const,
        superseded: true as const,
        suspiciousStreak: existingState?.suspiciousStreak ?? 0,
      };
    }

    const now = Date.now();
    const nextStreak = args.suspicious
      ? existingState.suspiciousStreak + 1
      : existingState.suspiciousStreak;

    await ctx.db.patch(existingState._id, {
      lastAttemptAt: args.lastAttemptAt,
      lastError: args.lastError,
      suspiciousStreak: nextStreak,
      refreshLeaseUntil: undefined,
      refreshLeaseToken: undefined,
      updatedAt: now,
    });

    return {
      applied: true as const,
      superseded: false as const,
      id: existingState._id,
      suspiciousStreak: nextStreak,
    };
  },
});

export const getShareCardByMonthDay = query({
  args: { monthDay: v.string() },
  async handler(ctx, args) {
    const row = await ctx.db
      .query("onThisDayShareCards")
      .withIndex("by_monthDay", (q) => q.eq("monthDay", args.monthDay))
      .first();

    if (!row) return null;

    const imageUrl = await ctx.storage.getUrl(row.storageId);
    return {
      monthDay: row.monthDay,
      version: row.version,
      storageId: row.storageId,
      mimeType: row.mimeType,
      width: row.width,
      height: row.height,
      byteSize: row.byteSize,
      generatedAt: row.generatedAt,
      snapshotCheckedAt: row.snapshotCheckedAt,
      plates: row.plates,
      imageUrl,
    };
  },
});

export const listShareCardStatuses = query({
  args: {},
  async handler(ctx) {
    const rows = await ctx.db
      .query("onThisDayShareCards")
      .withIndex("by_monthDay")
      .collect();

    return rows.map((row) => ({
      monthDay: row.monthDay,
      version: row.version,
      generatedAt: row.generatedAt,
      byteSize: row.byteSize,
      plateCount: row.plates.length,
    }));
  },
});

export const generateShareCardUploadUrl = mutation({
  args: { attestation: serverAttestationValidator },
  async handler(ctx, { attestation }) {
    await assertPublicAudioWriteAttestation({
      pipeline: "on-this-day",
      operation: "generate-upload-url",
      args: {},
      attestation,
    });
    return await ctx.storage.generateUploadUrl();
  },
});

export const saveShareCard = mutation({
  args: {
    monthDay: v.string(),
    version: v.number(),
    storageId: v.id("_storage"),
    mimeType: v.string(),
    width: v.number(),
    height: v.number(),
    byteSize: v.number(),
    generatedAt: v.number(),
    snapshotCheckedAt: v.optional(v.number()),
    plates: v.array(shareCardPlateValidator),
    attestation: serverAttestationValidator,
  },
  async handler(ctx, args) {
    const { attestation, ...writeArgs } = args;
    await assertPublicAudioWriteAttestation({
      pipeline: "on-this-day",
      operation: "save-show-asset",
      args: writeArgs,
      attestation,
    });

    const existing = await ctx.db
      .query("onThisDayShareCards")
      .withIndex("by_monthDay", (q) => q.eq("monthDay", args.monthDay))
      .first();

    const record = {
      monthDay: args.monthDay,
      version: args.version,
      storageId: args.storageId,
      mimeType: args.mimeType,
      width: args.width,
      height: args.height,
      byteSize: args.byteSize,
      generatedAt: args.generatedAt,
      snapshotCheckedAt: args.snapshotCheckedAt,
      plates: args.plates,
    };

    if (existing) {
      await ctx.db.patch(existing._id, record);
      if (existing.storageId !== args.storageId) {
        try {
          await ctx.storage.delete(existing.storageId);
        } catch (error) {
          console.warn(
            `[on-this-day] Failed to delete superseded share card blob ${existing.storageId} for ${args.monthDay}`,
            error,
          );
        }
      }
    } else {
      await ctx.db.insert("onThisDayShareCards", record);
    }

    return {
      monthDay: args.monthDay,
      version: args.version,
      storageId: args.storageId,
      replaced: Boolean(existing),
    };
  },
});
