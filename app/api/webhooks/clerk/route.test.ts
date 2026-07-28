import { NextRequest } from "next/server";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  verifyWebhook: vi.fn(),
  fetchMutation: vi.fn(),
  createReconcileClerkDeletionAttestation: vi.fn(),
}));

vi.mock("server-only", () => ({}));
vi.mock("@clerk/nextjs/webhooks", () => ({
  verifyWebhook: mocks.verifyWebhook,
}));
vi.mock("convex/nextjs", () => ({
  fetchMutation: mocks.fetchMutation,
}));
vi.mock("@/lib/account-deletion-attestation", () => ({
  createReconcileClerkDeletionAttestation:
    mocks.createReconcileClerkDeletionAttestation,
}));

import { api } from "@/convex/_generated/api";
import { POST } from "./route";

const request = () =>
  new NextRequest("https://curiogarden.org/api/webhooks/clerk", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "svix-id": "message_123",
      "svix-timestamp": "1700000000",
      "svix-signature": "v1,signed",
    },
    body: JSON.stringify({ type: "user.deleted" }),
  });

describe("POST /api/webhooks/clerk", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.stubEnv("CLERK_WEBHOOK_SIGNING_SECRET", "whsec_test");
    mocks.verifyWebhook.mockResolvedValue({
      type: "user.deleted",
      data: { id: "user_123", deleted: true, object: "user" },
    });
    mocks.createReconcileClerkDeletionAttestation.mockResolvedValue({
      signature: "signed-reconcile",
    });
    mocks.fetchMutation.mockResolvedValue({
      reconciled: true,
      status: "clerk_deleted",
      purgeAfter: 300,
    });
  });

  afterEach(() => {
    vi.restoreAllMocks();
    vi.unstubAllEnvs();
  });

  it("returns a retryable configuration failure when no signing secret is set", async () => {
    vi.stubEnv("CLERK_WEBHOOK_SIGNING_SECRET", "");
    const consoleError = vi
      .spyOn(console, "error")
      .mockImplementation(() => undefined);

    const response = await POST(request());

    expect(response.status).toBe(503);
    expect(mocks.verifyWebhook).not.toHaveBeenCalled();
    expect(mocks.fetchMutation).not.toHaveBeenCalled();
    expect(consoleError).toHaveBeenCalled();
  });

  it("rejects a webhook whose Clerk signature cannot be verified", async () => {
    mocks.verifyWebhook.mockRejectedValue(new Error("invalid signature"));
    const webhookRequest = request();

    const response = await POST(webhookRequest);

    expect(response.status).toBe(400);
    expect(response.headers.get("Cache-Control")).toBe("no-store");
    await expect(response.json()).resolves.toEqual({
      error: "Invalid webhook",
    });
    expect(mocks.fetchMutation).not.toHaveBeenCalled();
    expect(mocks.verifyWebhook).toHaveBeenCalledWith(webhookRequest, {
      signingSecret: "whsec_test",
    });
  });

  it("acknowledges unrelated verified Clerk events without persistence", async () => {
    mocks.verifyWebhook.mockResolvedValue({
      type: "session.ended",
      data: { id: "session_123" },
    });

    const response = await POST(request());

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual({
      received: true,
      reconciled: false,
    });
    expect(
      mocks.createReconcileClerkDeletionAttestation,
    ).not.toHaveBeenCalled();
    expect(mocks.fetchMutation).not.toHaveBeenCalled();
  });

  it("reconciles a verified user.deleted event through a signed Convex call", async () => {
    const response = await POST(request());

    expect(response.status).toBe(200);
    expect(response.headers.get("Cache-Control")).toBe("no-store");
    await expect(response.json()).resolves.toEqual({
      received: true,
      reconciled: true,
    });
    expect(mocks.createReconcileClerkDeletionAttestation).toHaveBeenCalledWith({
      clerkUserId: "user_123",
      clerkUserExists: false,
    });
    expect(mocks.fetchMutation).toHaveBeenCalledWith(
      api.accountDeletion.reconcileClerkDeletion,
      {
        clerkUserId: "user_123",
        clerkUserExists: false,
        attestation: { signature: "signed-reconcile" },
      },
    );
  });

  it("reconciles a Clerk-native deletion that has no prior in-app request", async () => {
    mocks.fetchMutation.mockResolvedValue({
      reconciled: true,
      status: "clerk_deleted",
      purgeAfter: 300,
    });

    const response = await POST(request());

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual({
      received: true,
      reconciled: true,
    });
  });

  it("rejects a verified deletion event without a Clerk user ID", async () => {
    mocks.verifyWebhook.mockResolvedValue({
      type: "user.deleted",
      data: { deleted: true, object: "user" },
    });

    const response = await POST(request());

    expect(response.status).toBe(400);
    expect(mocks.fetchMutation).not.toHaveBeenCalled();
  });

  it("returns a retryable failure when durable reconciliation is unavailable", async () => {
    mocks.fetchMutation.mockRejectedValue(new Error("Convex unavailable"));
    const consoleError = vi
      .spyOn(console, "error")
      .mockImplementation(() => undefined);

    const response = await POST(request());

    expect(response.status).toBe(503);
    expect(response.headers.get("Retry-After")).toBe("60");
    await expect(response.json()).resolves.toEqual({
      error: "Webhook reconciliation is temporarily unavailable.",
    });
    expect(consoleError).toHaveBeenCalled();
  });
});
