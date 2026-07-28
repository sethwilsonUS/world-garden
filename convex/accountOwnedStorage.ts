import { v } from "convex/values";
import { internal } from "./_generated/api";
import { internalMutation, type MutationCtx } from "./_generated/server";
import {
  ACCOUNT_OWNED_AUDIO_ORPHAN_GRACE_MS,
  ACCOUNT_OWNED_AUDIO_SWEEP_KEY,
  isAccountOwnedAudioStorageContentType,
} from "../lib/account-owned-audio-storage";

export const ACCOUNT_OWNED_STORAGE_SWEEP_PAGE_SIZE = 64;

type AccountOwnedStorageSweepCtx = Pick<
  MutationCtx,
  "db" | "scheduler" | "storage"
>;

export const sweepAccountOwnedStorageOrphansForCtx = async (
  ctx: AccountOwnedStorageSweepCtx,
  args: { continuation: boolean },
  now = Date.now(),
) => {
  const state = await ctx.db
    .query("accountOwnedStorageSweepState")
    .withIndex("by_key", (query) =>
      query.eq("key", ACCOUNT_OWNED_AUDIO_SWEEP_KEY),
    )
    .first();

  if (args.continuation && state?.activeCutoff === undefined) {
    return {
      status: "stale" as const,
      scanned: 0,
      marked: 0,
      deleted: 0,
      preserved: 0,
      scannedThrough: state?.scannedThrough ?? 0,
    };
  }

  const scannedThrough = state?.scannedThrough ?? 0;
  const activeCutoff =
    state?.activeCutoff ?? now - ACCOUNT_OWNED_AUDIO_ORPHAN_GRACE_MS;

  if (activeCutoff <= scannedThrough) {
    return {
      status: "complete" as const,
      scanned: 0,
      marked: 0,
      deleted: 0,
      preserved: 0,
      scannedThrough,
    };
  }

  const result = await ctx.db.system
    .query("_storage")
    .withIndex("by_creation_time", (query) =>
      query
        .gt("_creationTime", scannedThrough)
        .lte("_creationTime", activeCutoff),
    )
    .order("asc")
    .paginate({
      cursor: state?.cursor ?? null,
      numItems: ACCOUNT_OWNED_STORAGE_SWEEP_PAGE_SIZE,
      maximumRowsRead: ACCOUNT_OWNED_STORAGE_SWEEP_PAGE_SIZE,
    });

  let marked = 0;
  let deleted = 0;
  let preserved = 0;
  for (const file of result.page) {
    if (!isAccountOwnedAudioStorageContentType(file.contentType)) continue;
    marked += 1;
    const ledger = await ctx.db
      .query("accountOwnedStorage")
      .withIndex("by_storageId", (query) => query.eq("storageId", file._id))
      .first();
    if (ledger) {
      preserved += 1;
      continue;
    }
    await ctx.storage.delete(file._id);
    deleted += 1;
  }

  if (!result.isDone) {
    const nextState = {
      key: ACCOUNT_OWNED_AUDIO_SWEEP_KEY,
      scannedThrough,
      activeCutoff,
      cursor: result.continueCursor,
      updatedAt: now,
    };
    if (state) {
      await ctx.db.patch(state._id, nextState);
    } else {
      await ctx.db.insert("accountOwnedStorageSweepState", {
        ...nextState,
        createdAt: now,
      });
    }
    await ctx.scheduler.runAfter(
      0,
      internal.accountOwnedStorage.sweepAccountOwnedStorageOrphans,
      { continuation: true },
    );
    return {
      status: "continued" as const,
      scanned: result.page.length,
      marked,
      deleted,
      preserved,
      scannedThrough,
    };
  }

  const completedState = {
    scannedThrough: activeCutoff,
    activeCutoff: undefined,
    cursor: undefined,
    updatedAt: now,
  };
  if (state) {
    await ctx.db.patch(state._id, completedState);
  } else {
    await ctx.db.insert("accountOwnedStorageSweepState", {
      key: ACCOUNT_OWNED_AUDIO_SWEEP_KEY,
      ...completedState,
      createdAt: now,
    });
  }
  return {
    status: "complete" as const,
    scanned: result.page.length,
    marked,
    deleted,
    preserved,
    scannedThrough: activeCutoff,
  };
};

export const sweepAccountOwnedStorageOrphans = internalMutation({
  args: { continuation: v.boolean() },
  handler: sweepAccountOwnedStorageOrphansForCtx,
});
