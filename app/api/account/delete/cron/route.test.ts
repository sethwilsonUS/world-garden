import { NextRequest } from "next/server";
import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  clerkClient: vi.fn(),
  deleteUser: vi.fn(),
  fetchMutation: vi.fn(),
  getPodcastAdminAuthError: vi.fn(),
  createListPendingClerkDeletionsAttestation: vi.fn(),
  createMarkClerkDeletionAttestation: vi.fn(),
}));

vi.mock("server-only", () => ({}));
vi.mock("@clerk/nextjs/server", () => ({
  clerkClient: mocks.clerkClient,
}));
vi.mock("convex/nextjs", () => ({
  fetchMutation: mocks.fetchMutation,
}));
vi.mock("@/lib/podcast-admin-auth", () => ({
  getPodcastAdminAuthError: mocks.getPodcastAdminAuthError,
}));
vi.mock("@/lib/account-deletion-attestation", () => ({
  createListPendingClerkDeletionsAttestation:
    mocks.createListPendingClerkDeletionsAttestation,
  createMarkClerkDeletionAttestation: mocks.createMarkClerkDeletionAttestation,
}));

import { api } from "@/convex/_generated/api";
import { GET } from "./route";

const request = (authorization = "Bearer cron-secret") =>
  new NextRequest("https://curiogarden.org/api/account/delete/cron", {
    headers: { Authorization: authorization },
  });

const pendingRequest = (suffix: string) => ({
  requestId: `request_${suffix}`,
  clerkUserId: `user_${suffix}`,
  createdAt: 100,
  cleanupCompletedAt: 200,
  clerkDeletionAttemptCount: 0,
  lastClerkAttemptAt: null,
});

describe("GET /api/account/delete/cron", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.getPodcastAdminAuthError.mockReturnValue(null);
    mocks.clerkClient.mockResolvedValue({
      users: { deleteUser: mocks.deleteUser },
    });
    mocks.deleteUser.mockResolvedValue({ deleted: true });
    mocks.createListPendingClerkDeletionsAttestation.mockResolvedValue({
      signature: "signed-list",
    });
    mocks.createMarkClerkDeletionAttestation.mockImplementation(
      async ({ outcome }: { outcome: string }) => ({
        signature: `signed-${outcome}`,
      }),
    );
    mocks.fetchMutation
      .mockResolvedValueOnce([pendingRequest("one"), pendingRequest("two")])
      .mockResolvedValue({
        marked: true,
        status: "clerk_deleted",
        purgeAfter: 300,
      });
  });

  it("rejects unauthorized retries before consulting Convex or Clerk", async () => {
    mocks.getPodcastAdminAuthError.mockReturnValue("Unauthorized");

    const response = await GET(request("Bearer nope"));

    expect(response.status).toBe(401);
    expect(response.headers.get("Cache-Control")).toBe("no-store");
    expect(mocks.fetchMutation).not.toHaveBeenCalled();
    expect(mocks.clerkClient).not.toHaveBeenCalled();
  });

  it("reports a missing cron secret as server configuration failure", async () => {
    mocks.getPodcastAdminAuthError.mockReturnValue(
      "CRON_SECRET is not configured",
    );

    const response = await GET(request());

    expect(response.status).toBe(500);
    expect(mocks.fetchMutation).not.toHaveBeenCalled();
  });

  it("deletes each bounded pending account and durably marks completion", async () => {
    const response = await GET(request());

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual({
      status: "complete",
      attempted: 2,
      deleted: 2,
      pending: 0,
    });
    expect(
      mocks.createListPendingClerkDeletionsAttestation,
    ).toHaveBeenCalledWith({ limit: 25 });
    expect(mocks.fetchMutation).toHaveBeenNthCalledWith(
      1,
      api.accountDeletion.listPendingClerkDeletions,
      {
        limit: 25,
        attestation: { signature: "signed-list" },
      },
    );
    expect(mocks.deleteUser).toHaveBeenCalledTimes(2);
    expect(mocks.createMarkClerkDeletionAttestation).toHaveBeenCalledTimes(2);
    expect(mocks.createMarkClerkDeletionAttestation).toHaveBeenNthCalledWith(
      1,
      {
        requestId: "request_one",
        clerkUserId: "user_one",
        outcome: "deleted",
      },
    );
  });

  it("treats Clerk 404 as successful deletion", async () => {
    mocks.fetchMutation
      .mockReset()
      .mockResolvedValueOnce([pendingRequest("gone")])
      .mockResolvedValueOnce({
        marked: true,
        status: "clerk_deleted",
        purgeAfter: 300,
      });
    mocks.deleteUser.mockRejectedValue({ status: 404, clerkError: true });

    const response = await GET(request());

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toMatchObject({
      status: "complete",
      deleted: 1,
      pending: 0,
    });
    expect(mocks.createMarkClerkDeletionAttestation).toHaveBeenCalledWith(
      expect.objectContaining({ outcome: "deleted" }),
    );
  });

  it("keeps transient Clerk failures pending and returns a retryable failure", async () => {
    mocks.fetchMutation
      .mockReset()
      .mockResolvedValueOnce([pendingRequest("later")])
      .mockResolvedValueOnce({
        marked: true,
        status: "pending_clerk",
        purgeAfter: null,
      });
    mocks.deleteUser.mockRejectedValue(new Error("Clerk unavailable"));

    const response = await GET(request());

    expect(response.status).toBe(503);
    expect(response.headers.get("Retry-After")).toBe("60");
    await expect(response.json()).resolves.toEqual({
      status: "pending",
      attempted: 1,
      deleted: 0,
      pending: 1,
    });
    expect(mocks.createMarkClerkDeletionAttestation).toHaveBeenCalledWith({
      requestId: "request_later",
      clerkUserId: "user_later",
      outcome: "retry",
    });
  });

  it("fails safely when listing durable requests is unavailable", async () => {
    mocks.fetchMutation
      .mockReset()
      .mockRejectedValue(new Error("Convex unavailable"));
    const consoleError = vi
      .spyOn(console, "error")
      .mockImplementation(() => undefined);

    const response = await GET(request());

    expect(response.status).toBe(503);
    await expect(response.json()).resolves.toEqual({
      error: "Account deletion retry is temporarily unavailable.",
    });
    expect(mocks.deleteUser).not.toHaveBeenCalled();
    expect(consoleError).toHaveBeenCalled();
  });

  it("leaves the request pending when completion marking fails", async () => {
    mocks.fetchMutation
      .mockReset()
      .mockResolvedValueOnce([pendingRequest("mark")])
      .mockRejectedValueOnce(new Error("mark failed"));
    const consoleError = vi
      .spyOn(console, "error")
      .mockImplementation(() => undefined);

    const response = await GET(request());

    expect(response.status).toBe(503);
    await expect(response.json()).resolves.toMatchObject({
      status: "pending",
      deleted: 0,
      pending: 1,
    });
    expect(consoleError).toHaveBeenCalled();
  });
});
