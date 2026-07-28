import { v } from "convex/values";
import type { Id } from "../_generated/dataModel";
import type { MutationCtx } from "../_generated/server";
import { isAccountOwnedAudioStorageContentType } from "../../lib/account-owned-audio-storage";
import { isViewerAccountDeletionActiveForCtx } from "./accountDeletionState";

export const accountOwnedStorageKindValidator = v.union(
  v.literal("personal_playlist_episode"),
  v.literal("article_audio_export"),
);

export type AccountOwnedStorageKind =
  | "personal_playlist_episode"
  | "article_audio_export";

type AccountOwnedStorageCtx = Pick<MutationCtx, "db" | "storage">;

export type RegisterAccountOwnedStorageArgs = {
  viewerTokenIdentifier: string;
  storageId: Id<"_storage">;
  kind: AccountOwnedStorageKind;
  parentId: string;
};

const getStorageLedgers = async (
  ctx: AccountOwnedStorageCtx,
  storageId: Id<"_storage">,
) =>
  await ctx.db
    .query("accountOwnedStorage")
    .withIndex("by_storageId", (query) => query.eq("storageId", storageId))
    .collect();

export const hasAccountOwnedAudioStorageMarkerForCtx = async (
  ctx: AccountOwnedStorageCtx,
  storageId: Id<"_storage">,
): Promise<boolean> => {
  const metadata = await ctx.db.system.get("_storage", storageId);
  return isAccountOwnedAudioStorageContentType(metadata?.contentType);
};

export const deleteAccountOwnedStorageForCtx = async (
  ctx: AccountOwnedStorageCtx,
  storageId: Id<"_storage">,
  expectedViewerTokenIdentifier?: string,
): Promise<{ deleted: true }> => {
  const ledgers = await getStorageLedgers(ctx, storageId);
  if (ledgers.length > 0 && expectedViewerTokenIdentifier === undefined) {
    throw new Error("Storage ownership could not be verified");
  }
  if (
    expectedViewerTokenIdentifier !== undefined &&
    ledgers.some(
      (ledger) =>
        ledger.viewerTokenIdentifier !== expectedViewerTokenIdentifier,
    )
  ) {
    throw new Error("Storage is owned by another account");
  }

  await ctx.storage.delete(storageId);
  for (const ledger of ledgers) {
    await ctx.db.delete(ledger._id);
  }

  return { deleted: true };
};

export const registerAccountOwnedStorageForCtx = async (
  ctx: AccountOwnedStorageCtx,
  args: RegisterAccountOwnedStorageArgs,
  now = Date.now(),
): Promise<{ registered: boolean }> => {
  const existing = await getStorageLedgers(ctx, args.storageId);
  if (
    existing.some(
      (ledger) => ledger.viewerTokenIdentifier !== args.viewerTokenIdentifier,
    )
  ) {
    throw new Error("Storage is already owned by another account");
  }

  if (
    await isViewerAccountDeletionActiveForCtx(ctx, args.viewerTokenIdentifier)
  ) {
    await deleteAccountOwnedStorageForCtx(
      ctx,
      args.storageId,
      args.viewerTokenIdentifier,
    );
    return { registered: false };
  }

  if (existing.length > 0) {
    for (const ledger of existing) {
      await ctx.db.patch(ledger._id, {
        kind: args.kind,
        parentId: args.parentId,
        updatedAt: now,
      });
    }
    return { registered: true };
  }

  await ctx.db.insert("accountOwnedStorage", {
    ...args,
    createdAt: now,
    updatedAt: now,
  });
  return { registered: true };
};
