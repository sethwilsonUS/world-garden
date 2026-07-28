import { v } from "convex/values";
import type { Doc, Id } from "./_generated/dataModel";
import { internal } from "./_generated/api";
import {
  internalMutation,
  internalQuery,
  mutation,
  type MutationCtx,
  type QueryCtx,
} from "./_generated/server";
import {
  accountDeletionAttestationValidator,
  verifyListPendingClerkDeletionsAttestation,
  verifyMarkClerkDeletionAttestation,
  verifyReconcileClerkDeletionAttestation,
  MAX_PENDING_CLERK_DELETION_LIMIT,
  type AccountDeletionClerkOutcome,
} from "../lib/account-deletion-attestation";
import { createPersonalFeedToken } from "../lib/personal-feed-token";
import { assertViewerAccountActiveForCtx } from "./lib/accountDeletionState";
import {
  accountOwnedStorageKindValidator,
  deleteAccountOwnedStorageForCtx,
  registerAccountOwnedStorageForCtx,
} from "./lib/accountOwnedStorage";
import {
  getArticleAudioExportQuotaKey,
  getPersonalPlaylistOpenAiQuotaKey,
} from "./lib/accountQuotaKeys";
import {
  ACCOUNT_OWNED_AUDIO_MAX_LATE_ACTION_MS,
  ACCOUNT_OWNED_AUDIO_SWEEP_KEY,
} from "../lib/account-owned-audio-storage";

export const ACCOUNT_DELETION_BATCH_SIZE = 25;
export const ACCOUNT_DELETION_TOMBSTONE_GRACE_MS = 24 * 60 * 60 * 1_000;
export const ACCOUNT_DELETION_PURGE_SWEEP_RETRY_MS = 60 * 60 * 1_000;
export const ACCOUNT_DELETION_PURGE_SWEEP_ATTENTION_THRESHOLD = 12;
// Keep retrying safely, but cap backoff state and emit one durable operator
// signal after a sustained run of failures.
export const ACCOUNT_DELETION_CLEANUP_ATTENTION_THRESHOLD = 12;
const ACCOUNT_DELETION_RETRY_BASE_MS = 60_000;
const ACCOUNT_DELETION_RETRY_MAX_MS = 60 * 60 * 1_000;
const MAX_IDENTITY_LENGTH = 512;
const MAX_STORED_ERROR_LENGTH = 500;
const ACCOUNT_DELETION_PURGE_SWEEP_WAIT_ERROR =
  "Account-owned audio sweep coverage is behind the deletion tombstone.";

type AccountDeletionStatus = Doc<"accountDeletionRequests">["status"];
type AccountDeletionPhase = Doc<"accountDeletionRequests">["phase"];
type DeletionRequest = Doc<"accountDeletionRequests">;
type AccountDeletionQueryCtx = Pick<QueryCtx, "db">;

type InitiationResult = {
  requestId: Id<"accountDeletionRequests">;
  status: AccountDeletionStatus;
  created: boolean;
};

type CleanupBatchResult = {
  found: boolean;
  status: AccountDeletionStatus | null;
  phase: AccountDeletionPhase | null;
  processed: number;
};

type ClerkTransitionResult = {
  marked: boolean;
  status: AccountDeletionStatus | null;
  purgeAfter: number | null;
};

type ClerkReconciliationResult = {
  reconciled: boolean;
  created: boolean;
  status: AccountDeletionStatus | null;
  purgeAfter: number | null;
};

const cleanupPhaseSequence = [
  "revoke_feeds",
  "playlist_episodes",
  "article_audio_exports",
  "owned_storage",
  "bookmarks",
  "listening_progress",
  "badge_credits",
  "account_quotas",
  "feeds",
] as const satisfies readonly AccountDeletionPhase[];

const isBoundedIdentity = (value: string): boolean =>
  value.length > 0 &&
  value.length <= MAX_IDENTITY_LENGTH &&
  value.trim() === value;

const getNextCleanupPhase = (
  phase: (typeof cleanupPhaseSequence)[number],
): AccountDeletionPhase => {
  const index = cleanupPhaseSequence.indexOf(phase);
  return cleanupPhaseSequence[index + 1] ?? "pending_clerk";
};

const scheduleCleanup = async (
  ctx: Pick<MutationCtx, "scheduler">,
  requestId: Id<"accountDeletionRequests">,
  delay = 0,
): Promise<void> => {
  await ctx.scheduler.runAfter(
    delay,
    internal.accountDeletion.runAccountDeletionCleanupBatch,
    { requestId },
  );
};

const schedulePurge = async (
  ctx: Pick<MutationCtx, "scheduler">,
  requestId: Id<"accountDeletionRequests">,
  delay: number,
): Promise<void> => {
  await ctx.scheduler.runAfter(
    Math.max(0, delay),
    internal.accountDeletion.purgeAccountDeletionRequest,
    { requestId },
  );
};

const resumeDeletionRequest = async (
  ctx: Pick<MutationCtx, "scheduler">,
  request: DeletionRequest,
  now: number,
): Promise<void> => {
  if (request.status === "cleaning") {
    await scheduleCleanup(ctx, request._id);
    return;
  }
  if (request.status !== "clerk_deleted") return;
  if (request.phase === "grace_period" && request.purgeAfter != null) {
    await schedulePurge(ctx, request._id, request.purgeAfter - now);
    return;
  }
  await scheduleCleanup(ctx, request._id);
};

export const getViewerTokenIdentifierForClerkUser = (
  clerkUserId: string,
  environment: Record<string, string | undefined> = process.env,
): string => {
  if (!isBoundedIdentity(clerkUserId)) {
    throw new Error("Invalid Clerk user id.");
  }
  const issuer = environment.CLERK_JWT_ISSUER_DOMAIN?.trim().replace(
    /\/+$/,
    "",
  );
  if (!issuer) {
    throw new Error(
      "CLERK_JWT_ISSUER_DOMAIN is required to reconcile Clerk-native account deletion.",
    );
  }
  return `${issuer}|${clerkUserId}`;
};

export const initiateAccountDeletionForCtx = async (
  ctx: Pick<MutationCtx, "auth" | "db" | "scheduler">,
  args: { clerkUserId: string },
  now = Date.now(),
): Promise<InitiationResult> => {
  const identity = await ctx.auth.getUserIdentity();
  if (
    !identity ||
    !isBoundedIdentity(args.clerkUserId) ||
    identity.subject !== args.clerkUserId ||
    !isBoundedIdentity(identity.tokenIdentifier)
  ) {
    throw new Error("Unauthorized");
  }

  const existingForViewer = await ctx.db
    .query("accountDeletionRequests")
    .withIndex("by_viewerTokenIdentifier", (query) =>
      query.eq("viewerTokenIdentifier", identity.tokenIdentifier),
    )
    .first();
  if (existingForViewer) {
    if (existingForViewer.clerkUserId !== args.clerkUserId) {
      throw new Error("Account deletion identity conflict.");
    }
    await resumeDeletionRequest(ctx, existingForViewer, now);
    return {
      requestId: existingForViewer._id,
      status: existingForViewer.status,
      created: false,
    };
  }

  const existingForClerkUser = await ctx.db
    .query("accountDeletionRequests")
    .withIndex("by_clerkUserId", (query) =>
      query.eq("clerkUserId", args.clerkUserId),
    )
    .first();
  if (existingForClerkUser) {
    throw new Error("Account deletion identity conflict.");
  }

  const requestId = await ctx.db.insert("accountDeletionRequests", {
    viewerTokenIdentifier: identity.tokenIdentifier,
    clerkUserId: args.clerkUserId,
    status: "cleaning",
    phase: "revoke_feeds",
    cleanupAttemptCount: 0,
    clerkDeletionAttemptCount: 0,
    createdAt: now,
    updatedAt: now,
  });
  await scheduleCleanup(ctx, requestId);

  return { requestId, status: "cleaning", created: true };
};

export const initiateAccountDeletion = mutation({
  args: { clerkUserId: v.string() },
  handler: initiateAccountDeletionForCtx,
});

export const assertViewerAccountActiveInternal = internalQuery({
  args: { viewerTokenIdentifier: v.string() },
  async handler(ctx, args): Promise<{ active: true }> {
    await assertViewerAccountActiveForCtx(ctx, args.viewerTokenIdentifier);
    return { active: true };
  },
});

export const registerAccountOwnedStorage = internalMutation({
  args: {
    viewerTokenIdentifier: v.string(),
    storageId: v.id("_storage"),
    kind: accountOwnedStorageKindValidator,
    parentId: v.string(),
  },
  handler: registerAccountOwnedStorageForCtx,
});

export const deleteAccountOwnedStorage = internalMutation({
  args: {
    storageId: v.id("_storage"),
    expectedViewerTokenIdentifier: v.optional(v.string()),
  },
  async handler(ctx, args): Promise<{ deleted: true }> {
    return await deleteAccountOwnedStorageForCtx(
      ctx,
      args.storageId,
      args.expectedViewerTokenIdentifier,
    );
  },
});

const getPlaylistEpisodeStorageIds = (
  episode: Doc<"personalPlaylistEpisodes">,
): Id<"_storage">[] => {
  const storageIds = new Set<Id<"_storage">>();
  if (episode.storageId) storageIds.add(episode.storageId);
  for (const variant of episode.audioVariants ?? []) {
    storageIds.add(variant.storageId);
  }
  return [...storageIds];
};

const advanceCleanup = async (
  ctx: Pick<MutationCtx, "db" | "scheduler">,
  request: DeletionRequest,
  phase: (typeof cleanupPhaseSequence)[number],
  processed: number,
  now: number,
): Promise<CleanupBatchResult> => {
  if (processed === ACCOUNT_DELETION_BATCH_SIZE) {
    await ctx.db.patch(request._id, {
      cleanupAttemptCount: 0,
      needsAttentionAt: undefined,
      lastError: undefined,
      updatedAt: now,
    });
    await scheduleCleanup(ctx, request._id);
    return { found: true, status: request.status, phase, processed };
  }

  const nextPhase = getNextCleanupPhase(phase);
  if (nextPhase !== "pending_clerk") {
    await ctx.db.patch(request._id, {
      phase: nextPhase,
      cleanupAttemptCount: 0,
      needsAttentionAt: undefined,
      lastError: undefined,
      updatedAt: now,
    });
    await scheduleCleanup(ctx, request._id);
    return {
      found: true,
      status: request.status,
      phase: nextPhase,
      processed,
    };
  }

  if (request.status === "cleaning") {
    await ctx.db.patch(request._id, {
      status: "pending_clerk",
      phase: "pending_clerk",
      cleanupCompletedAt: now,
      cleanupAttemptCount: 0,
      needsAttentionAt: undefined,
      lastError: undefined,
      updatedAt: now,
    });
    return {
      found: true,
      status: "pending_clerk",
      phase: "pending_clerk",
      processed,
    };
  }

  const purgeAfter = now + ACCOUNT_DELETION_TOMBSTONE_GRACE_MS;
  await ctx.db.patch(request._id, {
    phase: "grace_period",
    cleanupCompletedAt: now,
    cleanupAttemptCount: 0,
    purgeSweepRetryCount: 0,
    lastPurgeSweepRetryAt: undefined,
    needsAttentionAt: undefined,
    purgeAfter,
    lastError: undefined,
    updatedAt: now,
  });
  await schedulePurge(ctx, request._id, ACCOUNT_DELETION_TOMBSTONE_GRACE_MS);
  return {
    found: true,
    status: "clerk_deleted",
    phase: "grace_period",
    processed,
  };
};

const deleteOwnerRows = async (
  ctx: Pick<MutationCtx, "db">,
  tableName:
    | "bookmarks"
    | "viewerArticleListenProgress"
    | "badgeArticleCredits"
    | "personalPodcastFeeds",
  viewerTokenIdentifier: string,
): Promise<number> => {
  switch (tableName) {
    case "bookmarks": {
      const rows = await ctx.db
        .query("bookmarks")
        .withIndex("by_viewerTokenIdentifier", (query) =>
          query.eq("viewerTokenIdentifier", viewerTokenIdentifier),
        )
        .take(ACCOUNT_DELETION_BATCH_SIZE);
      for (const row of rows) await ctx.db.delete(row._id);
      return rows.length;
    }
    case "viewerArticleListenProgress": {
      const rows = await ctx.db
        .query("viewerArticleListenProgress")
        .withIndex("by_viewerTokenIdentifier", (query) =>
          query.eq("viewerTokenIdentifier", viewerTokenIdentifier),
        )
        .take(ACCOUNT_DELETION_BATCH_SIZE);
      for (const row of rows) await ctx.db.delete(row._id);
      return rows.length;
    }
    case "badgeArticleCredits": {
      const rows = await ctx.db
        .query("badgeArticleCredits")
        .withIndex("by_viewerTokenIdentifier", (query) =>
          query.eq("viewerTokenIdentifier", viewerTokenIdentifier),
        )
        .take(ACCOUNT_DELETION_BATCH_SIZE);
      for (const row of rows) await ctx.db.delete(row._id);
      return rows.length;
    }
    case "personalPodcastFeeds": {
      const rows = await ctx.db
        .query("personalPodcastFeeds")
        .withIndex("by_viewerTokenIdentifier", (query) =>
          query.eq("viewerTokenIdentifier", viewerTokenIdentifier),
        )
        .take(ACCOUNT_DELETION_BATCH_SIZE);
      for (const row of rows) await ctx.db.delete(row._id);
      return rows.length;
    }
  }
};

const deleteAccountQuotaRows = async (
  ctx: Pick<MutationCtx, "db">,
  viewerTokenIdentifier: string,
): Promise<number> => {
  const keys = [
    getPersonalPlaylistOpenAiQuotaKey(viewerTokenIdentifier),
    getArticleAudioExportQuotaKey(viewerTokenIdentifier),
  ];
  let deleted = 0;
  for (const key of keys) {
    const remaining = ACCOUNT_DELETION_BATCH_SIZE - deleted;
    if (remaining <= 0) break;
    const rows = await ctx.db
      .query("routeQuotas")
      .withIndex("by_key", (query) => query.eq("key", key))
      .take(remaining);
    for (const row of rows) await ctx.db.delete(row._id);
    deleted += rows.length;
  }
  return deleted;
};

export const runAccountDeletionCleanupBatchForCtx = async (
  ctx: Pick<MutationCtx, "db" | "scheduler" | "storage">,
  args: { requestId: Id<"accountDeletionRequests"> },
  now = Date.now(),
): Promise<CleanupBatchResult> => {
  const request = await ctx.db.get(args.requestId);
  if (!request) {
    return { found: false, status: null, phase: null, processed: 0 };
  }
  if (
    request.status === "pending_clerk" ||
    request.phase === "pending_clerk" ||
    request.phase === "grace_period"
  ) {
    return {
      found: true,
      status: request.status,
      phase: request.phase,
      processed: 0,
    };
  }

  await ctx.db.patch(request._id, {
    cleanupAttemptCount: request.cleanupAttemptCount + 1,
    lastCleanupAttemptAt: now,
    updatedAt: now,
  });

  switch (request.phase) {
    case "revoke_feeds": {
      const feeds = await ctx.db
        .query("personalPodcastFeeds")
        .withIndex("by_viewerTokenIdentifier", (query) =>
          query.eq("viewerTokenIdentifier", request.viewerTokenIdentifier),
        )
        .filter((query) => query.eq(query.field("revokedAt"), undefined))
        .take(ACCOUNT_DELETION_BATCH_SIZE);
      for (const feed of feeds) {
        await ctx.db.patch(feed._id, {
          feedToken: createPersonalFeedToken(),
          revokedAt: now,
          updatedAt: now,
        });
      }
      return await advanceCleanup(
        ctx,
        request,
        request.phase,
        feeds.length,
        now,
      );
    }
    case "playlist_episodes": {
      const episodes = await ctx.db
        .query("personalPlaylistEpisodes")
        .withIndex("by_viewerTokenIdentifier", (query) =>
          query.eq("viewerTokenIdentifier", request.viewerTokenIdentifier),
        )
        .take(ACCOUNT_DELETION_BATCH_SIZE);
      for (const episode of episodes) {
        for (const storageId of getPlaylistEpisodeStorageIds(episode)) {
          await deleteAccountOwnedStorageForCtx(
            ctx,
            storageId,
            request.viewerTokenIdentifier,
          );
        }
        await ctx.db.delete(episode._id);
      }
      return await advanceCleanup(
        ctx,
        request,
        request.phase,
        episodes.length,
        now,
      );
    }
    case "article_audio_exports": {
      const exports = await ctx.db
        .query("articleAudioExports")
        .withIndex("by_ownerTokenIdentifier", (query) =>
          query.eq("ownerTokenIdentifier", request.viewerTokenIdentifier),
        )
        .take(ACCOUNT_DELETION_BATCH_SIZE);
      for (const audioExport of exports) {
        if (audioExport.storageId) {
          await deleteAccountOwnedStorageForCtx(
            ctx,
            audioExport.storageId,
            request.viewerTokenIdentifier,
          );
        }
        await ctx.db.delete(audioExport._id);
      }
      return await advanceCleanup(
        ctx,
        request,
        request.phase,
        exports.length,
        now,
      );
    }
    case "owned_storage": {
      const ledgers = await ctx.db
        .query("accountOwnedStorage")
        .withIndex("by_viewerTokenIdentifier", (query) =>
          query.eq("viewerTokenIdentifier", request.viewerTokenIdentifier),
        )
        .take(ACCOUNT_DELETION_BATCH_SIZE);
      const storageIds = new Set(ledgers.map((ledger) => ledger.storageId));
      for (const storageId of storageIds) {
        await deleteAccountOwnedStorageForCtx(
          ctx,
          storageId,
          request.viewerTokenIdentifier,
        );
      }
      return await advanceCleanup(
        ctx,
        request,
        request.phase,
        ledgers.length,
        now,
      );
    }
    case "bookmarks": {
      const deleted = await deleteOwnerRows(
        ctx,
        "bookmarks",
        request.viewerTokenIdentifier,
      );
      return await advanceCleanup(ctx, request, request.phase, deleted, now);
    }
    case "listening_progress": {
      const deleted = await deleteOwnerRows(
        ctx,
        "viewerArticleListenProgress",
        request.viewerTokenIdentifier,
      );
      return await advanceCleanup(ctx, request, request.phase, deleted, now);
    }
    case "badge_credits": {
      const deleted = await deleteOwnerRows(
        ctx,
        "badgeArticleCredits",
        request.viewerTokenIdentifier,
      );
      return await advanceCleanup(ctx, request, request.phase, deleted, now);
    }
    case "account_quotas": {
      const deleted = await deleteAccountQuotaRows(
        ctx,
        request.viewerTokenIdentifier,
      );
      return await advanceCleanup(ctx, request, request.phase, deleted, now);
    }
    case "feeds": {
      const deleted = await deleteOwnerRows(
        ctx,
        "personalPodcastFeeds",
        request.viewerTokenIdentifier,
      );
      return await advanceCleanup(ctx, request, request.phase, deleted, now);
    }
    default:
      return {
        found: true,
        status: request.status,
        phase: request.phase,
        processed: 0,
      };
  }
};

export const runAccountDeletionCleanupBatch = internalMutation({
  args: { requestId: v.id("accountDeletionRequests") },
  async handler(ctx, args): Promise<CleanupBatchResult> {
    try {
      return await runAccountDeletionCleanupBatchForCtx(ctx, args);
    } catch (error) {
      await recordCleanupFailureForCtx(
        ctx,
        {
          requestId: args.requestId,
          lastError: sanitizeCleanupError(error),
        },
        Date.now(),
        false,
      );
      const request = await ctx.db.get(args.requestId);
      return {
        found: request !== null,
        status: request?.status ?? null,
        phase: request?.phase ?? null,
        processed: 0,
      };
    }
  },
});

const sanitizeCleanupError = (error: unknown): string => {
  const message =
    error instanceof Error ? error.message : "Unknown cleanup error";
  return message.slice(0, MAX_STORED_ERROR_LENGTH);
};

const getCleanupRetryDelay = (attemptCount: number): number =>
  Math.min(
    ACCOUNT_DELETION_RETRY_MAX_MS,
    ACCOUNT_DELETION_RETRY_BASE_MS * 2 ** Math.min(6, attemptCount),
  );

const recordCleanupFailureForCtx = async (
  ctx: Pick<MutationCtx, "db" | "scheduler">,
  args: {
    requestId: Id<"accountDeletionRequests">;
    lastError: string;
  },
  now: number,
  incrementAttempt: boolean,
): Promise<{ recorded: boolean; needsAttention: boolean }> => {
  const request = await ctx.db.get(args.requestId);
  if (
    !request ||
    request.status === "pending_clerk" ||
    request.phase === "grace_period"
  ) {
    return { recorded: false, needsAttention: false };
  }
  const cleanupAttemptCount = Math.min(
    request.cleanupAttemptCount + (incrementAttempt ? 1 : 0),
    ACCOUNT_DELETION_CLEANUP_ATTENTION_THRESHOLD,
  );
  const needsAttention =
    cleanupAttemptCount >= ACCOUNT_DELETION_CLEANUP_ATTENTION_THRESHOLD;
  const newlyNeedsAttention =
    needsAttention && request.needsAttentionAt === undefined;
  await ctx.db.patch(request._id, {
    ...(newlyNeedsAttention
      ? {
          needsAttentionAt: now,
        }
      : {}),
    cleanupAttemptCount,
    lastCleanupAttemptAt: now,
    lastError: args.lastError.slice(0, MAX_STORED_ERROR_LENGTH),
    updatedAt: now,
  });
  if (newlyNeedsAttention) {
    console.error("[account-deletion] Cleanup needs operator attention", {
      requestId: request._id,
      phase: request.phase,
      cleanupAttemptCount,
    });
  }
  await scheduleCleanup(
    ctx,
    request._id,
    getCleanupRetryDelay(cleanupAttemptCount),
  );
  return { recorded: true, needsAttention };
};

export const recordAccountDeletionCleanupFailure = internalMutation({
  args: {
    requestId: v.id("accountDeletionRequests"),
    lastError: v.string(),
  },
  async handler(
    ctx,
    args,
  ): Promise<{ recorded: boolean; needsAttention: boolean }> {
    return await recordCleanupFailureForCtx(ctx, args, Date.now(), true);
  },
});

export const listPendingClerkDeletionsForCtx = async (
  ctx: AccountDeletionQueryCtx,
  args: { limit: number },
) => {
  const limit = Number.isFinite(args.limit)
    ? Math.min(
        MAX_PENDING_CLERK_DELETION_LIMIT,
        Math.max(1, Math.floor(args.limit)),
      )
    : MAX_PENDING_CLERK_DELETION_LIMIT;
  const requests = await ctx.db
    .query("accountDeletionRequests")
    .withIndex("by_status_updatedAt", (query) =>
      query.eq("status", "pending_clerk"),
    )
    .order("asc")
    .take(limit);
  return requests.map((request) => ({
    requestId: request._id,
    clerkUserId: request.clerkUserId,
    createdAt: request.createdAt,
    cleanupCompletedAt: request.cleanupCompletedAt ?? request.updatedAt,
    clerkDeletionAttemptCount: request.clerkDeletionAttemptCount,
    lastClerkAttemptAt: request.lastClerkAttemptAt ?? null,
  }));
};

export const listPendingClerkDeletions = mutation({
  args: {
    limit: v.number(),
    attestation: accountDeletionAttestationValidator,
  },
  async handler(ctx, args) {
    const valid = await verifyListPendingClerkDeletionsAttestation(args);
    if (!valid) {
      throw new Error("Invalid account deletion coordinator attestation.");
    }
    return await listPendingClerkDeletionsForCtx(ctx, { limit: args.limit });
  },
});

export const markClerkDeletionForCtx = async (
  ctx: Pick<MutationCtx, "db" | "scheduler">,
  args: {
    requestId: Id<"accountDeletionRequests">;
    clerkUserId: string;
    outcome: AccountDeletionClerkOutcome;
  },
  now = Date.now(),
): Promise<ClerkTransitionResult> => {
  const request = await ctx.db.get(args.requestId);
  if (!request) {
    return { marked: false, status: null, purgeAfter: null };
  }
  if (request.clerkUserId !== args.clerkUserId) {
    throw new Error("Account deletion identity conflict.");
  }

  // Clerk deletion is monotonic. A stale timeout or retry result must never
  // resurrect the cross-system handoff after a webhook confirmed deletion.
  if (request.status === "clerk_deleted") {
    await resumeDeletionRequest(ctx, request, now);
    return {
      marked: true,
      status: request.status,
      purgeAfter: request.purgeAfter ?? null,
    };
  }

  if (args.outcome === "retry") {
    const status = request.status === "cleaning" ? "cleaning" : "pending_clerk";
    const phase =
      request.status === "cleaning" ? request.phase : "pending_clerk";
    await ctx.db.patch(request._id, {
      status,
      phase,
      clerkDeletionAttemptCount: request.clerkDeletionAttemptCount + 1,
      lastClerkAttemptAt: now,
      clerkDeletedAt: undefined,
      purgeAfter: undefined,
      lastError: "Clerk account deletion needs retry.",
      updatedAt: now,
    });
    return { marked: true, status, purgeAfter: null };
  }

  await ctx.db.patch(request._id, {
    status: "clerk_deleted",
    phase: "revoke_feeds",
    clerkDeletionAttemptCount: request.clerkDeletionAttemptCount + 1,
    lastClerkAttemptAt: now,
    clerkDeletedAt: now,
    cleanupAttemptCount: 0,
    needsAttentionAt: undefined,
    purgeAfter: undefined,
    lastError: undefined,
    updatedAt: now,
  });
  await scheduleCleanup(ctx, request._id);
  return { marked: true, status: "clerk_deleted", purgeAfter: null };
};

export const markClerkDeletion = mutation({
  args: {
    requestId: v.id("accountDeletionRequests"),
    clerkUserId: v.string(),
    outcome: v.union(v.literal("deleted"), v.literal("retry")),
    attestation: accountDeletionAttestationValidator,
  },
  async handler(ctx, args) {
    const valid = await verifyMarkClerkDeletionAttestation({
      requestId: args.requestId,
      clerkUserId: args.clerkUserId,
      outcome: args.outcome,
      attestation: args.attestation,
    });
    if (!valid) {
      throw new Error("Invalid account deletion coordinator attestation.");
    }
    return await markClerkDeletionForCtx(ctx, args);
  },
});

export const reconcileClerkDeletionForCtx = async (
  ctx: Pick<MutationCtx, "db" | "scheduler">,
  args: { clerkUserId: string; clerkUserExists: boolean },
  now = Date.now(),
  environment: Record<string, string | undefined> = process.env,
): Promise<ClerkReconciliationResult> => {
  const request = await ctx.db
    .query("accountDeletionRequests")
    .withIndex("by_clerkUserId", (query) =>
      query.eq("clerkUserId", args.clerkUserId),
    )
    .first();

  if (!request) {
    if (args.clerkUserExists) {
      return {
        reconciled: false,
        created: false,
        status: null,
        purgeAfter: null,
      };
    }
    const viewerTokenIdentifier = getViewerTokenIdentifierForClerkUser(
      args.clerkUserId,
      environment,
    );
    const requestId = await ctx.db.insert("accountDeletionRequests", {
      viewerTokenIdentifier,
      clerkUserId: args.clerkUserId,
      status: "clerk_deleted",
      phase: "revoke_feeds",
      cleanupAttemptCount: 0,
      clerkDeletionAttemptCount: 1,
      lastClerkAttemptAt: now,
      clerkDeletedAt: now,
      createdAt: now,
      updatedAt: now,
    });
    await scheduleCleanup(ctx, requestId);
    return {
      reconciled: true,
      created: true,
      status: "clerk_deleted",
      purgeAfter: null,
    };
  }

  const result = await markClerkDeletionForCtx(
    ctx,
    {
      requestId: request._id,
      clerkUserId: args.clerkUserId,
      outcome: args.clerkUserExists ? "retry" : "deleted",
    },
    now,
  );
  return {
    reconciled: result.marked,
    created: false,
    status: result.status,
    purgeAfter: result.purgeAfter,
  };
};

export const reconcileClerkDeletion = mutation({
  args: {
    clerkUserId: v.string(),
    clerkUserExists: v.boolean(),
    attestation: accountDeletionAttestationValidator,
  },
  async handler(ctx, args) {
    const valid = await verifyReconcileClerkDeletionAttestation(args);
    if (!valid) {
      throw new Error("Invalid account deletion coordinator attestation.");
    }
    return await reconcileClerkDeletionForCtx(ctx, args);
  },
});

const hasRemainingAccountDataForCtx = async (
  ctx: Pick<MutationCtx, "db">,
  viewerTokenIdentifier: string,
): Promise<boolean> => {
  const [
    bookmark,
    feed,
    episode,
    progress,
    badgeCredit,
    audioExport,
    ownedStorage,
    personalPlaylistQuota,
    articleAudioExportQuota,
  ] = await Promise.all([
    ctx.db
      .query("bookmarks")
      .withIndex("by_viewerTokenIdentifier", (query) =>
        query.eq("viewerTokenIdentifier", viewerTokenIdentifier),
      )
      .first(),
    ctx.db
      .query("personalPodcastFeeds")
      .withIndex("by_viewerTokenIdentifier", (query) =>
        query.eq("viewerTokenIdentifier", viewerTokenIdentifier),
      )
      .first(),
    ctx.db
      .query("personalPlaylistEpisodes")
      .withIndex("by_viewerTokenIdentifier", (query) =>
        query.eq("viewerTokenIdentifier", viewerTokenIdentifier),
      )
      .first(),
    ctx.db
      .query("viewerArticleListenProgress")
      .withIndex("by_viewerTokenIdentifier", (query) =>
        query.eq("viewerTokenIdentifier", viewerTokenIdentifier),
      )
      .first(),
    ctx.db
      .query("badgeArticleCredits")
      .withIndex("by_viewerTokenIdentifier", (query) =>
        query.eq("viewerTokenIdentifier", viewerTokenIdentifier),
      )
      .first(),
    ctx.db
      .query("articleAudioExports")
      .withIndex("by_ownerTokenIdentifier", (query) =>
        query.eq("ownerTokenIdentifier", viewerTokenIdentifier),
      )
      .first(),
    ctx.db
      .query("accountOwnedStorage")
      .withIndex("by_viewerTokenIdentifier", (query) =>
        query.eq("viewerTokenIdentifier", viewerTokenIdentifier),
      )
      .first(),
    ctx.db
      .query("routeQuotas")
      .withIndex("by_key", (query) =>
        query.eq(
          "key",
          getPersonalPlaylistOpenAiQuotaKey(viewerTokenIdentifier),
        ),
      )
      .first(),
    ctx.db
      .query("routeQuotas")
      .withIndex("by_key", (query) =>
        query.eq("key", getArticleAudioExportQuotaKey(viewerTokenIdentifier)),
      )
      .first(),
  ]);
  return [
    bookmark,
    feed,
    episode,
    progress,
    badgeCredit,
    audioExport,
    ownedStorage,
    personalPlaylistQuota,
    articleAudioExportQuota,
  ].some(Boolean);
};

export const purgeAccountDeletionRequestForCtx = async (
  ctx: Pick<MutationCtx, "db" | "scheduler">,
  args: { requestId: Id<"accountDeletionRequests"> },
  now = Date.now(),
): Promise<{ purged: boolean; cleanupRestarted: boolean }> => {
  const request = await ctx.db.get(args.requestId);
  if (
    !request ||
    request.status !== "clerk_deleted" ||
    request.phase !== "grace_period" ||
    request.purgeAfter == null
  ) {
    return { purged: false, cleanupRestarted: false };
  }
  if (request.purgeAfter > now) {
    await schedulePurge(ctx, request._id, request.purgeAfter - now);
    return { purged: false, cleanupRestarted: false };
  }
  if (await hasRemainingAccountDataForCtx(ctx, request.viewerTokenIdentifier)) {
    await ctx.db.patch(request._id, {
      phase: "revoke_feeds",
      purgeAfter: undefined,
      purgeSweepRetryCount: 0,
      lastPurgeSweepRetryAt: undefined,
      needsAttentionAt: undefined,
      lastError: undefined,
      updatedAt: now,
    });
    await scheduleCleanup(ctx, request._id);
    return { purged: false, cleanupRestarted: true };
  }
  const sweepState = await ctx.db
    .query("accountOwnedStorageSweepState")
    .withIndex("by_key", (query) =>
      query.eq("key", ACCOUNT_OWNED_AUDIO_SWEEP_KEY),
    )
    .first();
  const requiredSweepHighWater =
    request.createdAt + ACCOUNT_OWNED_AUDIO_MAX_LATE_ACTION_MS;
  if (!sweepState || sweepState.scannedThrough < requiredSweepHighWater) {
    const entersNewRetryWindow =
      request.lastPurgeSweepRetryAt === undefined ||
      now - request.lastPurgeSweepRetryAt >=
        ACCOUNT_DELETION_PURGE_SWEEP_RETRY_MS;
    const purgeSweepRetryCount = Math.min(
      (request.purgeSweepRetryCount ?? 0) + (entersNewRetryWindow ? 1 : 0),
      ACCOUNT_DELETION_PURGE_SWEEP_ATTENTION_THRESHOLD,
    );
    const shouldSignalAttention =
      purgeSweepRetryCount >=
        ACCOUNT_DELETION_PURGE_SWEEP_ATTENTION_THRESHOLD &&
      request.needsAttentionAt === undefined;
    await ctx.db.patch(request._id, {
      purgeSweepRetryCount,
      ...(entersNewRetryWindow ? { lastPurgeSweepRetryAt: now } : {}),
      ...(shouldSignalAttention ? { needsAttentionAt: now } : {}),
      lastError: ACCOUNT_DELETION_PURGE_SWEEP_WAIT_ERROR,
      updatedAt: now,
    });
    if (shouldSignalAttention) {
      console.error(
        "[account-deletion] Storage sweep needs operator attention",
        {
          requestId: request._id,
          viewerTokenIdentifier: request.viewerTokenIdentifier,
          purgeSweepRetryCount,
          scannedThrough: sweepState?.scannedThrough ?? null,
          requiredSweepHighWater,
        },
      );
    }
    await schedulePurge(
      ctx,
      request._id,
      ACCOUNT_DELETION_PURGE_SWEEP_RETRY_MS,
    );
    return { purged: false, cleanupRestarted: false };
  }
  await ctx.db.delete(request._id);
  return { purged: true, cleanupRestarted: false };
};

export const purgeAccountDeletionRequest = internalMutation({
  args: { requestId: v.id("accountDeletionRequests") },
  handler: purgeAccountDeletionRequestForCtx,
});
