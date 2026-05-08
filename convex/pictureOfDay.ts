import { mutation, query } from "./_generated/server";
import { Id } from "./_generated/dataModel";
import { v } from "convex/values";

const pictureOfDayAudioStatus = v.union(
  v.literal("pending"),
  v.literal("ready"),
  v.literal("failed"),
);

const withStorageUrl = async <
  T extends {
    storageId?: Id<"_storage">;
  },
>(
  ctx: {
    storage: {
      getUrl(storageId: Id<"_storage">): Promise<string | null>;
    };
  },
  record: T,
) => {
  const audioUrl = record.storageId
    ? await ctx.storage.getUrl(record.storageId)
    : null;
  return { ...record, audioUrl };
};

export const getPictureOfDayAudio = query({
  args: {
    feedDate: v.string(),
    pictureKey: v.string(),
    scriptVersion: v.number(),
  },
  async handler(ctx, args) {
    const record = await ctx.db
      .query("pictureOfDayAudio")
      .withIndex("by_feedDate_picture_script", (q) =>
        q
          .eq("feedDate", args.feedDate)
          .eq("pictureKey", args.pictureKey)
          .eq("scriptVersion", args.scriptVersion),
      )
      .first();

    return record ? await withStorageUrl(ctx, record) : null;
  },
});

export const generateUploadUrl = mutation({
  async handler(ctx) {
    return await ctx.storage.generateUploadUrl();
  },
});

export const claimPictureOfDayAudioJob = mutation({
  args: {
    feedDate: v.string(),
    pictureKey: v.string(),
    scriptVersion: v.number(),
    owner: v.string(),
    leaseMs: v.number(),
  },
  async handler(ctx, args) {
    const existing = await ctx.db
      .query("pictureOfDayAudioJobs")
      .withIndex("by_feedDate_picture_script", (q) =>
        q
          .eq("feedDate", args.feedDate)
          .eq("pictureKey", args.pictureKey)
          .eq("scriptVersion", args.scriptVersion),
      )
      .first();

    const now = Date.now();
    const leaseExpiresAt = now + Math.max(args.leaseMs, 1);

    if (
      existing &&
      existing.status === "running" &&
      existing.leaseOwner &&
      existing.leaseOwner !== args.owner &&
      (existing.leaseExpiresAt ?? 0) > now
    ) {
      return { claimed: false, attempts: existing.attempts };
    }

    const attempts = (existing?.attempts ?? 0) + 1;

    if (existing) {
      await ctx.db.patch(existing._id, {
        status: "running",
        attempts,
        lastError: undefined,
        leaseOwner: args.owner,
        leaseExpiresAt,
        updatedAt: now,
      });
      return { claimed: true, attempts };
    }

    await ctx.db.insert("pictureOfDayAudioJobs", {
      feedDate: args.feedDate,
      pictureKey: args.pictureKey,
      scriptVersion: args.scriptVersion,
      status: "running",
      attempts,
      lastError: undefined,
      leaseOwner: args.owner,
      leaseExpiresAt,
      createdAt: now,
      updatedAt: now,
    });

    return { claimed: true, attempts };
  },
});

export const savePictureOfDayAudio = mutation({
  args: {
    feedDate: v.string(),
    pictureKey: v.string(),
    scriptVersion: v.number(),
    status: pictureOfDayAudioStatus,
    title: v.optional(v.string()),
    spokenText: v.optional(v.string()),
    storageId: v.optional(v.id("_storage")),
    durationSeconds: v.optional(v.number()),
    byteLength: v.optional(v.number()),
    voiceId: v.optional(v.string()),
    lastError: v.optional(v.string()),
  },
  async handler(ctx, args) {
    const existing = await ctx.db
      .query("pictureOfDayAudio")
      .withIndex("by_feedDate_picture_script", (q) =>
        q
          .eq("feedDate", args.feedDate)
          .eq("pictureKey", args.pictureKey)
          .eq("scriptVersion", args.scriptVersion),
      )
      .first();

    const now = Date.now();
    const data = {
      status: args.status,
      title: args.title,
      spokenText: args.spokenText,
      storageId: args.storageId,
      durationSeconds: args.durationSeconds,
      byteLength: args.byteLength,
      voiceId: args.voiceId,
      lastError: args.lastError,
      updatedAt: now,
    };

    if (existing) {
      await ctx.db.patch(existing._id, data);
      return existing._id;
    }

    return await ctx.db.insert("pictureOfDayAudio", {
      feedDate: args.feedDate,
      pictureKey: args.pictureKey,
      scriptVersion: args.scriptVersion,
      ...data,
      createdAt: now,
    });
  },
});

export const finalizePictureOfDayAudioJob = mutation({
  args: {
    feedDate: v.string(),
    pictureKey: v.string(),
    scriptVersion: v.number(),
    owner: v.string(),
    status: v.union(v.literal("ready"), v.literal("failed")),
    lastError: v.optional(v.string()),
  },
  async handler(ctx, args) {
    const existing = await ctx.db
      .query("pictureOfDayAudioJobs")
      .withIndex("by_feedDate_picture_script", (q) =>
        q
          .eq("feedDate", args.feedDate)
          .eq("pictureKey", args.pictureKey)
          .eq("scriptVersion", args.scriptVersion),
      )
      .first();

    if (!existing || existing.leaseOwner !== args.owner) {
      return { updated: false };
    }

    await ctx.db.patch(existing._id, {
      status: args.status,
      lastError: args.lastError,
      leaseOwner: undefined,
      leaseExpiresAt: undefined,
      updatedAt: Date.now(),
    });

    return { updated: true };
  },
});
