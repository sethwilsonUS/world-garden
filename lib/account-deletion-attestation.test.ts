import { afterEach, describe, expect, it, vi } from "vitest";
import {
  ACCOUNT_DELETION_LIST_PENDING_SCOPE,
  ACCOUNT_DELETION_MARK_CLERK_SCOPE,
  ACCOUNT_DELETION_RECONCILE_CLERK_SCOPE,
  buildListPendingClerkDeletionsAttestationPayload,
  buildMarkClerkDeletionAttestationPayload,
  buildReconcileClerkDeletionAttestationPayload,
  createListPendingClerkDeletionsAttestation,
  createMarkClerkDeletionAttestation,
  createReconcileClerkDeletionAttestation,
  verifyListPendingClerkDeletionsAttestation,
  verifyMarkClerkDeletionAttestation,
  verifyReconcileClerkDeletionAttestation,
} from "./account-deletion-attestation";
import { verifyServerAttestation } from "./server-attestation";

describe("account deletion Clerk handoff attestations", () => {
  const secret = "account-deletion-test-secret";

  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it("creates a scope-bound pending-list attestation", async () => {
    vi.stubEnv("TTS_QUOTA_BYPASS_SECRET", secret);
    const args = { limit: 25 };
    const attestation = await createListPendingClerkDeletionsAttestation(args);

    await expect(
      verifyListPendingClerkDeletionsAttestation({
        ...args,
        attestation,
        secret,
      }),
    ).resolves.toBe(true);
    await expect(
      verifyServerAttestation({
        attestation,
        scope: ACCOUNT_DELETION_LIST_PENDING_SCOPE,
        payload: buildListPendingClerkDeletionsAttestationPayload(args),
        secret,
      }),
    ).resolves.toBe(true);
  });

  it("binds mark attestations to request, Clerk user, and outcome", async () => {
    vi.stubEnv("TTS_QUOTA_BYPASS_SECRET", secret);
    const args = {
      requestId: "request-1",
      clerkUserId: "user_1",
      outcome: "deleted" as const,
    };
    const attestation = await createMarkClerkDeletionAttestation(args);

    await expect(
      verifyMarkClerkDeletionAttestation({ ...args, attestation, secret }),
    ).resolves.toBe(true);
    await expect(
      verifyMarkClerkDeletionAttestation({
        ...args,
        outcome: "retry",
        attestation,
        secret,
      }),
    ).resolves.toBe(false);
    expect(buildMarkClerkDeletionAttestationPayload(args)).toEqual([
      "request-1",
      "user_1",
      "deleted",
    ]);
    expect(ACCOUNT_DELETION_MARK_CLERK_SCOPE).not.toBe(
      ACCOUNT_DELETION_LIST_PENDING_SCOPE,
    );
  });

  it("supports a Clerk-user-only reconciliation attestation for webhooks", async () => {
    vi.stubEnv("TTS_QUOTA_BYPASS_SECRET", secret);
    const args = { clerkUserId: "user_1", clerkUserExists: false };
    const attestation = await createReconcileClerkDeletionAttestation(args);

    await expect(
      verifyReconcileClerkDeletionAttestation({
        ...args,
        attestation,
        secret,
      }),
    ).resolves.toBe(true);
    await expect(
      verifyReconcileClerkDeletionAttestation({
        clerkUserId: "user_2",
        clerkUserExists: false,
        attestation,
        secret,
      }),
    ).resolves.toBe(false);
    expect(buildReconcileClerkDeletionAttestationPayload(args)).toEqual([
      "user_1",
      false,
    ]);
    expect(ACCOUNT_DELETION_RECONCILE_CLERK_SCOPE).not.toBe(
      ACCOUNT_DELETION_MARK_CLERK_SCOPE,
    );
  });

  it("fails closed without the shared secret", async () => {
    vi.stubEnv("TTS_QUOTA_BYPASS_SECRET", secret);
    const args = { limit: 10 };
    const attestation = await createListPendingClerkDeletionsAttestation(args);

    await expect(
      verifyListPendingClerkDeletionsAttestation({
        ...args,
        attestation,
        secret: undefined,
      }),
    ).resolves.toBe(false);
  });
});
