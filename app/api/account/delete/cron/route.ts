import { clerkClient } from "@clerk/nextjs/server";
import { fetchMutation } from "convex/nextjs";
import { NextRequest, NextResponse } from "next/server";
import { api } from "@/convex/_generated/api";
import type { Id } from "@/convex/_generated/dataModel";
import {
  createListPendingClerkDeletionsAttestation,
  createMarkClerkDeletionAttestation,
  type AccountDeletionClerkOutcome,
} from "@/lib/account-deletion-attestation";
import { getPodcastAdminAuthError } from "@/lib/podcast-admin-auth";

const NO_STORE_HEADERS = { "Cache-Control": "no-store" } as const;
const RETRY_HEADERS = {
  ...NO_STORE_HEADERS,
  "Retry-After": "60",
} as const;
const BATCH_LIMIT = 25;
const CLERK_DELETION_TIMEOUT_MS = 5_000;
const ROUTE_WORK_BUDGET_MS = 50_000;
const UNAVAILABLE_ERROR = "Account deletion retry is temporarily unavailable.";

export const dynamic = "force-dynamic";
export const revalidate = 0;
export const maxDuration = 60;

type PendingDeletion = {
  requestId: Id<"accountDeletionRequests">;
  clerkUserId: string;
  createdAt: number;
  cleanupCompletedAt: number;
  clerkDeletionAttemptCount: number;
  lastClerkAttemptAt: number | null;
};

class ClerkDeletionTimeoutError extends Error {
  constructor() {
    super("Clerk deletion timed out");
    this.name = "ClerkDeletionTimeoutError";
  }
}

const isClerkNotFoundError = (error: unknown): boolean =>
  typeof error === "object" &&
  error !== null &&
  "status" in error &&
  error.status === 404;

const safeErrorKind = (error: unknown): string => {
  if (typeof error !== "object" || error === null) return typeof error;
  if ("status" in error && typeof error.status === "number") {
    return `status-${error.status}`;
  }
  return error instanceof Error ? error.name : "object";
};

const deleteClerkUserWithTimeout = async (
  deleteUser: () => Promise<unknown>,
): Promise<void> => {
  let timeoutId: ReturnType<typeof setTimeout> | undefined;
  const timeout = new Promise<never>((_resolve, reject) => {
    timeoutId = setTimeout(
      () => reject(new ClerkDeletionTimeoutError()),
      CLERK_DELETION_TIMEOUT_MS,
    );
  });

  try {
    await Promise.race([Promise.resolve().then(deleteUser), timeout]);
  } finally {
    if (timeoutId) clearTimeout(timeoutId);
  }
};

const markDeletionOutcome = async (
  deletion: PendingDeletion,
  outcome: AccountDeletionClerkOutcome,
) => {
  const attestation = await createMarkClerkDeletionAttestation({
    requestId: deletion.requestId,
    clerkUserId: deletion.clerkUserId,
    outcome,
  });
  await fetchMutation(api.accountDeletion.markClerkDeletion, {
    requestId: deletion.requestId,
    clerkUserId: deletion.clerkUserId,
    outcome,
    attestation,
  });
};

export const GET = async (request: NextRequest) => {
  const workStartedAt = Date.now();
  // Vercel Cron can inject only the project-wide CRON_SECRET header. This
  // route can advance HMAC-attested tombstones, but it cannot create one.
  const authError = getPodcastAdminAuthError(
    request.headers.get("authorization"),
  );
  if (authError) {
    return NextResponse.json(
      { error: authError },
      {
        status: authError === "Unauthorized" ? 401 : 500,
        headers: NO_STORE_HEADERS,
      },
    );
  }

  let pendingDeletions: PendingDeletion[];
  try {
    const attestation = await createListPendingClerkDeletionsAttestation({
      limit: BATCH_LIMIT,
    });
    const result = await fetchMutation(
      api.accountDeletion.listPendingClerkDeletions,
      { limit: BATCH_LIMIT, attestation },
    );
    if (!Array.isArray(result)) {
      throw new Error("Pending deletion list was not an array");
    }
    pendingDeletions = result;
  } catch (error) {
    console.error(
      "[/api/account/delete/cron] Pending request lookup failed",
      safeErrorKind(error),
    );
    return NextResponse.json(
      { error: UNAVAILABLE_ERROR },
      { status: 503, headers: RETRY_HEADERS },
    );
  }

  if (pendingDeletions.length === 0) {
    return NextResponse.json(
      { status: "complete", attempted: 0, deleted: 0, pending: 0 },
      { status: 200, headers: NO_STORE_HEADERS },
    );
  }

  let client: Awaited<ReturnType<typeof clerkClient>>;
  try {
    client = await clerkClient();
  } catch (error) {
    console.error(
      "[/api/account/delete/cron] Clerk client unavailable",
      safeErrorKind(error),
    );
    return NextResponse.json(
      {
        status: "pending",
        attempted: 0,
        deleted: 0,
        pending: pendingDeletions.length,
      },
      { status: 503, headers: RETRY_HEADERS },
    );
  }

  let deletedCount = 0;
  let pendingCount = 0;
  let attemptedCount = 0;

  for (const [index, deletion] of pendingDeletions.entries()) {
    if (Date.now() - workStartedAt >= ROUTE_WORK_BUDGET_MS) {
      pendingCount += pendingDeletions.length - index;
      console.error(
        "[/api/account/delete/cron] Route work budget exhausted; remaining deletions stay pending",
      );
      break;
    }

    attemptedCount += 1;
    let outcome: AccountDeletionClerkOutcome = "deleted";
    try {
      await deleteClerkUserWithTimeout(async () =>
        client.users.deleteUser(deletion.clerkUserId),
      );
    } catch (error) {
      if (!isClerkNotFoundError(error)) {
        outcome = "retry";
        if (error instanceof ClerkDeletionTimeoutError) {
          console.error("[/api/account/delete/cron] Clerk deletion timed out");
        } else {
          console.error(
            "[/api/account/delete/cron] Clerk deletion remains pending",
            safeErrorKind(error),
          );
        }
      }
    }

    try {
      await markDeletionOutcome(deletion, outcome);
      if (outcome === "deleted") {
        deletedCount += 1;
      } else {
        pendingCount += 1;
      }
    } catch (error) {
      pendingCount += 1;
      console.error(
        "[/api/account/delete/cron] Outcome persistence failed",
        safeErrorKind(error),
      );
    }
  }

  const hasPending = pendingCount > 0;
  return NextResponse.json(
    {
      status: hasPending ? "pending" : "complete",
      attempted: attemptedCount,
      deleted: deletedCount,
      pending: pendingCount,
    },
    {
      status: hasPending ? 503 : 200,
      headers: hasPending ? RETRY_HEADERS : NO_STORE_HEADERS,
    },
  );
};
