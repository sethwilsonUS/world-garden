import { mutation, query } from "./_generated/server";
import { Id } from "./_generated/dataModel";
import { v } from "convex/values";
import { upsertTtsAudioVariant } from "./lib/ttsAudioVariants";
import { assertPublicAudioWriteAttestation } from "../lib/public-audio-write-attestation";
import {
  assertExactCurrentEdgeAudioMetadata,
  hasPublicAudioMetadata,
} from "../lib/public-edge-audio-metadata";

export const MAX_PICTURE_OF_DAY_AUDIO_JOB_LEASE_MS = 15 * 60 * 1000;

const serverAttestationValidator = v.object({
  issuedAt: v.number(),
  expiresAt: v.number(),
  nonce: v.string(),
  signature: v.string(),
});

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
  args: { attestation: serverAttestationValidator },
  async handler(ctx, { attestation }) {
    await assertPublicAudioWriteAttestation({
      pipeline: "picture-of-day",
      operation: "generate-upload-url",
      args: {},
      attestation,
    });
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
    attestation: serverAttestationValidator,
  },
  async handler(ctx, args) {
    const { attestation, ...writeArgs } = args;
    await assertPublicAudioWriteAttestation({
      pipeline: "picture-of-day",
      operation: "claim-job",
      args: writeArgs,
      attestation,
    });
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
    const leaseExpiresAt =
      now +
      Math.min(
        Math.max(args.leaseMs, 1),
        MAX_PICTURE_OF_DAY_AUDIO_JOB_LEASE_MS,
      );

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
    owner: v.string(),
    status: pictureOfDayAudioStatus,
    title: v.optional(v.string()),
    spokenText: v.optional(v.string()),
    storageId: v.optional(v.id("_storage")),
    durationSeconds: v.optional(v.number()),
    byteLength: v.optional(v.number()),
    voiceId: v.optional(v.string()),
    ttsCacheKey: v.optional(v.string()),
    provider: v.optional(v.string()),
    model: v.optional(v.string()),
    promptVersion: v.optional(v.string()),
    ttsNormVersion: v.optional(v.string()),
    lastError: v.optional(v.string()),
    attestation: serverAttestationValidator,
  },
  async handler(ctx, args) {
    const { attestation, ...writeArgs } = args;
    await assertPublicAudioWriteAttestation({
      pipeline: "picture-of-day",
      operation: "save-record",
      args: writeArgs,
      attestation,
    });
    const now = Date.now();
    const job = await ctx.db
      .query("pictureOfDayAudioJobs")
      .withIndex("by_feedDate_picture_script", (q) =>
        q
          .eq("feedDate", args.feedDate)
          .eq("pictureKey", args.pictureKey)
          .eq("scriptVersion", args.scriptVersion),
      )
      .first();
    if (
      !job ||
      job.status !== "running" ||
      job.leaseOwner !== args.owner ||
      (job.leaseExpiresAt ?? 0) <= now
    ) {
      throw new Error(
        "The Picture of the Day audio publication lease was lost.",
      );
    }
    const audioMetadata = {
      provider: args.provider,
      model: args.model,
      voiceId: args.voiceId,
      promptVersion: args.promptVersion,
      ttsNormVersion: args.ttsNormVersion,
      ttsCacheKey: args.ttsCacheKey,
    };
    if (args.status === "ready" || hasPublicAudioMetadata(audioMetadata)) {
      assertExactCurrentEdgeAudioMetadata(audioMetadata);
    }
    if (args.status === "ready" && !args.storageId) {
      throw new Error(
        "Ready Picture of the Day audio requires a stored audio asset.",
      );
    }
    const existing = await ctx.db
      .query("pictureOfDayAudio")
      .withIndex("by_feedDate_picture_script", (q) =>
        q
          .eq("feedDate", args.feedDate)
          .eq("pictureKey", args.pictureKey)
          .eq("scriptVersion", args.scriptVersion),
      )
      .first();

    const audioVariants = upsertTtsAudioVariant(
      existing?.audioVariants,
      {
        storageId: args.storageId,
        durationSeconds: args.durationSeconds,
        byteLength: args.byteLength,
        ttsCacheKey: args.ttsCacheKey,
        provider: args.provider,
        model: args.model,
        voiceId: args.voiceId,
        promptVersion: args.promptVersion,
        ttsNormVersion: args.ttsNormVersion,
      },
      now,
    );
    const data = {
      status: args.status,
      title: args.title,
      spokenText: args.spokenText,
      storageId: args.storageId,
      durationSeconds: args.durationSeconds,
      byteLength: args.byteLength,
      voiceId: args.voiceId,
      ttsCacheKey: args.ttsCacheKey,
      provider: args.provider,
      model: args.model,
      promptVersion: args.promptVersion,
      ttsNormVersion: args.ttsNormVersion,
      audioVariants,
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
    attestation: serverAttestationValidator,
  },
  async handler(ctx, args) {
    const { attestation, ...writeArgs } = args;
    await assertPublicAudioWriteAttestation({
      pipeline: "picture-of-day",
      operation: "finalize-job",
      args: writeArgs,
      attestation,
    });
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
