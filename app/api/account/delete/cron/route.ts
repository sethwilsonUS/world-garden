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
        attempted: pendingDeletions.length,
        deleted: 0,
        pending: pendingDeletions.length,
      },
      { status: 503, headers: RETRY_HEADERS },
    );
  }

  let deletedCount = 0;
  let pendingCount = 0;

  for (const deletion of pendingDeletions) {
    let outcome: AccountDeletionClerkOutcome = "deleted";
    try {
      await client.users.deleteUser(deletion.clerkUserId);
    } catch (error) {
      if (!isClerkNotFoundError(error)) {
        outcome = "retry";
        console.error(
          "[/api/account/delete/cron] Clerk deletion remains pending",
          safeErrorKind(error),
        );
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
      attempted: pendingDeletions.length,
      deleted: deletedCount,
      pending: pendingCount,
    },
    {
      status: hasPending ? 503 : 200,
      headers: hasPending ? RETRY_HEADERS : NO_STORE_HEADERS,
    },
  );
};
