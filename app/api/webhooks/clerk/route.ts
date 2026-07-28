import { verifyWebhook } from "@clerk/nextjs/webhooks";
import { fetchMutation } from "convex/nextjs";
import { NextRequest, NextResponse } from "next/server";
import { api } from "@/convex/_generated/api";
import { createReconcileClerkDeletionAttestation } from "@/lib/account-deletion-attestation";

const NO_STORE_HEADERS = { "Cache-Control": "no-store" } as const;
const RETRY_HEADERS = {
  ...NO_STORE_HEADERS,
  "Retry-After": "60",
} as const;
const UNAVAILABLE_ERROR = "Webhook reconciliation is temporarily unavailable.";

export const dynamic = "force-dynamic";
export const revalidate = 0;
export const maxDuration = 15;

const unavailable = () =>
  NextResponse.json(
    { error: UNAVAILABLE_ERROR },
    { status: 503, headers: RETRY_HEADERS },
  );

export const POST = async (request: NextRequest) => {
  const signingSecret = process.env.CLERK_WEBHOOK_SIGNING_SECRET?.trim();
  if (!signingSecret) {
    console.error(
      "[/api/webhooks/clerk] Clerk webhook signing secret is not configured",
    );
    return unavailable();
  }

  let event: Awaited<ReturnType<typeof verifyWebhook>>;
  try {
    event = await verifyWebhook(request, { signingSecret });
  } catch {
    return NextResponse.json(
      { error: "Invalid webhook" },
      { status: 400, headers: NO_STORE_HEADERS },
    );
  }

  if (event.type !== "user.deleted") {
    return NextResponse.json(
      { received: true, reconciled: false },
      { status: 200, headers: NO_STORE_HEADERS },
    );
  }

  const clerkUserId = event.data.id?.trim();
  if (!clerkUserId) {
    return NextResponse.json(
      { error: "Invalid webhook payload" },
      { status: 400, headers: NO_STORE_HEADERS },
    );
  }

  try {
    const attestation = await createReconcileClerkDeletionAttestation({
      clerkUserId,
      clerkUserExists: false,
    });
    const result = await fetchMutation(
      api.accountDeletion.reconcileClerkDeletion,
      {
        clerkUserId,
        clerkUserExists: false,
        attestation,
      },
    );

    return NextResponse.json(
      { received: true, reconciled: result.reconciled },
      { status: 200, headers: NO_STORE_HEADERS },
    );
  } catch (error) {
    console.error(
      "[/api/webhooks/clerk] Durable reconciliation failed",
      error instanceof Error ? error.name : typeof error,
    );
    return unavailable();
  }
};
