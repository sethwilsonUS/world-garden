import { mutation, query } from "./_generated/server";
import { Id } from "./_generated/dataModel";
import { v } from "convex/values";

const didYouKnowAudioStatus = v.union(
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

export const getDidYouKnowAudioByDate = query({
  args: {
    feedDate: v.string(),
  },
  async handler(ctx, args) {
    const record = await ctx.db
      .query("didYouKnowAudio")
      .withIndex("by_feedDate", (q) => q.eq("feedDate", args.feedDate))
      .first();

    return record ? await withStorageUrl(ctx, record) : null;
  },
});

export const getDidYouKnowAudioJobByDate = query({
  args: {
    feedDate: v.string(),
  },
  async handler(ctx, args) {
    return await ctx.db
      .query("didYouKnowAudioJobs")
      .withIndex("by_feedDate", (q) => q.eq("feedDate", args.feedDate))
      .first();
  },
});

export const generateUploadUrl = mutation({
  async handler(ctx) {
    return await ctx.storage.generateUploadUrl();
  },
});

export const claimDidYouKnowAudioJob = mutation({
  args: {
    feedDate: v.string(),
    owner: v.string(),
    leaseMs: v.number(),
  },
  async handler(ctx, args) {
    const existing = await ctx.db
      .query("didYouKnowAudioJobs")
      .withIndex("by_feedDate", (q) => q.eq("feedDate", args.feedDate))
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

    await ctx.db.insert("didYouKnowAudioJobs", {
      feedDate: args.feedDate,
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

export const saveDidYouKnowAudio = mutation({
  args: {
    feedDate: v.string(),
    status: didYouKnowAudioStatus,
    title: v.optional(v.string()),
    spokenText: v.optional(v.string()),
    itemTexts: v.optional(v.array(v.string())),
    storageId: v.optional(v.id("_storage")),
    durationSeconds: v.optional(v.number()),
    byteLength: v.optional(v.number()),
    voiceId: v.optional(v.string()),
    lastError: v.optional(v.string()),
  },
  async handler(ctx, args) {
    const existing = await ctx.db
      .query("didYouKnowAudio")
      .withIndex("by_feedDate", (q) => q.eq("feedDate", args.feedDate))
      .first();

    const now = Date.now();

    if (existing) {
      await ctx.db.patch(existing._id, {
        status: args.status,
        title: args.title,
        spokenText: args.spokenText,
        itemTexts: args.itemTexts,
        storageId: args.storageId,
        durationSeconds: args.durationSeconds,
        byteLength: args.byteLength,
        voiceId: args.voiceId,
        lastError: args.lastError,
        updatedAt: now,
      });
      return existing._id;
    }

    return await ctx.db.insert("didYouKnowAudio", {
      feedDate: args.feedDate,
      status: args.status,
      title: args.title,
      spokenText: args.spokenText,
      itemTexts: args.itemTexts,
      storageId: args.storageId,
      durationSeconds: args.durationSeconds,
      byteLength: args.byteLength,
      voiceId: args.voiceId,
      lastError: args.lastError,
      createdAt: now,
      updatedAt: now,
    });
  },
});

export const finalizeDidYouKnowAudioJob = mutation({
  args: {
    feedDate: v.string(),
    owner: v.string(),
    status: v.union(v.literal("ready"), v.literal("failed")),
    lastError: v.optional(v.string()),
  },
  async handler(ctx, args) {
    const existing = await ctx.db
      .query("didYouKnowAudioJobs")
      .withIndex("by_feedDate", (q) => q.eq("feedDate", args.feedDate))
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
