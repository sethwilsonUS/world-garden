import { NextRequest } from "next/server";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  auth: vi.fn(),
  clerkClient: vi.fn(),
  deleteUser: vi.fn(),
  fetchMutation: vi.fn(),
  getToken: vi.fn(),
  has: vi.fn(),
  createMarkClerkDeletionAttestation: vi.fn(),
}));

vi.mock("server-only", () => ({}));
vi.mock("@clerk/nextjs/server", () => ({
  auth: mocks.auth,
  clerkClient: mocks.clerkClient,
  reverificationErrorResponse: (reverification: string) =>
    Response.json(
      {
        clerk_error: {
          type: "forbidden",
          reason: "reverification-error",
          metadata: { reverification },
        },
      },
      { status: 403 },
    ),
}));
vi.mock("convex/nextjs", () => ({
  fetchMutation: mocks.fetchMutation,
}));
vi.mock("@/lib/account-deletion-attestation", () => ({
  createMarkClerkDeletionAttestation: mocks.createMarkClerkDeletionAttestation,
}));

import { api } from "@/convex/_generated/api";
import { POST } from "./route";

const request = (
  body: unknown = { confirmation: "DELETE" },
  options: { origin?: string | null; contentType?: string } = {},
) => {
  const headers = new Headers({
    "Content-Type": options.contentType ?? "application/json",
  });
  if (options.origin !== null) {
    headers.set("Origin", options.origin ?? "https://curiogarden.org");
  }
  return new NextRequest("https://curiogarden.org/api/account/delete", {
    method: "POST",
    headers,
    body: typeof body === "string" ? body : JSON.stringify(body),
  });
};

describe("POST /api/account/delete", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.stubEnv("TTS_QUOTA_BYPASS_SECRET", "account-deletion-secret");
    mocks.has.mockReturnValue(true);
    mocks.getToken.mockResolvedValue("convex-jwt");
    mocks.auth.mockResolvedValue({
      isAuthenticated: true,
      userId: "user_123",
      getToken: mocks.getToken,
      has: mocks.has,
    });
    mocks.clerkClient.mockResolvedValue({
      users: { deleteUser: mocks.deleteUser },
    });
    mocks.deleteUser.mockResolvedValue({ id: "user_123", deleted: true });
    mocks.createMarkClerkDeletionAttestation.mockResolvedValue({
      issuedAt: 100,
      expiresAt: 200,
      nonce: "mark-nonce",
      signature: "signed-mark",
    });
    mocks.fetchMutation
      .mockResolvedValueOnce({
        requestId: "request_123",
        status: "pending_clerk",
        created: true,
      })
      .mockResolvedValueOnce({
        marked: true,
        status: "clerk_deleted",
        purgeAfter: 300,
      });
  });

  afterEach(() => {
    vi.restoreAllMocks();
    vi.unstubAllEnvs();
  });

  it("durably initiates deletion before deleting the reverifed Clerk account", async () => {
    const response = await POST(request());

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual({ status: "deleted" });
    expect(response.headers.get("Cache-Control")).toBe("private, no-store");
    expect(response.headers.get("Pragma")).toBe("no-cache");
    expect(response.headers.get("Expires")).toBe("0");
    expect(response.headers.get("X-Content-Type-Options")).toBe("nosniff");
    expect(response.headers.get("Cross-Origin-Resource-Policy")).toBe(
      "same-origin",
    );
    expect(mocks.has).toHaveBeenCalledWith({ reverification: "strict" });
    expect(mocks.getToken).toHaveBeenCalledWith({ template: "convex" });
    expect(mocks.fetchMutation).toHaveBeenNthCalledWith(
      1,
      api.accountDeletion.initiateAccountDeletion,
      { clerkUserId: "user_123" },
      { token: "convex-jwt" },
    );
    expect(mocks.deleteUser).toHaveBeenCalledWith("user_123");
    expect(mocks.createMarkClerkDeletionAttestation).toHaveBeenCalledWith({
      requestId: "request_123",
      clerkUserId: "user_123",
      outcome: "deleted",
    });
    expect(mocks.fetchMutation).toHaveBeenNthCalledWith(
      2,
      api.accountDeletion.markClerkDeletion,
      {
        requestId: "request_123",
        clerkUserId: "user_123",
        outcome: "deleted",
        attestation: expect.objectContaining({ signature: "signed-mark" }),
      },
    );
    expect(mocks.fetchMutation.mock.invocationCallOrder[0]).toBeLessThan(
      mocks.deleteUser.mock.invocationCallOrder[0]!,
    );
  });

  it("does not contact Clerk while durable initiation is still unresolved", async () => {
    let resolveInitiation!: (value: {
      requestId: string;
      status: string;
      created: boolean;
    }) => void;
    mocks.fetchMutation
      .mockReset()
      .mockImplementationOnce(
        () =>
          new Promise((resolve) => {
            resolveInitiation = resolve;
          }),
      )
      .mockResolvedValueOnce({
        marked: true,
        status: "clerk_deleted",
        purgeAfter: 300,
      });

    const responsePromise = POST(request());
    await vi.waitFor(() => expect(mocks.fetchMutation).toHaveBeenCalledOnce());

    expect(mocks.clerkClient).not.toHaveBeenCalled();
    expect(mocks.deleteUser).not.toHaveBeenCalled();

    resolveInitiation({
      requestId: "request_123",
      status: "cleaning",
      created: true,
    });
    const response = await responsePromise;

    expect(response.status).toBe(200);
    expect(mocks.deleteUser).toHaveBeenCalledOnce();
  });

  it("rejects cross-origin requests before consulting Clerk", async () => {
    const response = await POST(
      request(undefined, { origin: "https://mordor.example" }),
    );

    expect(response.status).toBe(403);
    await expect(response.json()).resolves.toEqual({
      error: "Request not allowed",
    });
    expect(mocks.auth).not.toHaveBeenCalled();
    expect(mocks.fetchMutation).not.toHaveBeenCalled();
    expect(mocks.deleteUser).not.toHaveBeenCalled();
  });

  it("accepts same-origin fetch metadata when Origin is unavailable", async () => {
    const deletionRequest = request(undefined, { origin: null });
    deletionRequest.headers.set("Sec-Fetch-Site", "same-origin");

    const response = await POST(deletionRequest);

    expect(response.status).toBe(200);
  });

  it("rejects requests without affirmative browser provenance", async () => {
    const response = await POST(request(undefined, { origin: null }));

    expect(response.status).toBe(403);
    expect(mocks.auth).not.toHaveBeenCalled();
  });

  it.each([
    ["wrong confirmation", { confirmation: "delete" }],
    ["an extra property", { confirmation: "DELETE", surprise: true }],
    ["a missing confirmation", {}],
    ["an array", ["DELETE"]],
    ["malformed JSON", "{"],
  ])("rejects %s without starting deletion", async (_label, body) => {
    const response = await POST(request(body));

    expect(response.status).toBe(400);
    await expect(response.json()).resolves.toEqual({
      error: 'Type "DELETE" exactly to confirm account deletion.',
    });
    expect(mocks.auth).not.toHaveBeenCalled();
    expect(mocks.fetchMutation).not.toHaveBeenCalled();
    expect(mocks.deleteUser).not.toHaveBeenCalled();
  });

  it("requires a JSON request body", async () => {
    const response = await POST(
      request("confirmation=DELETE", {
        contentType: "application/x-www-form-urlencoded",
      }),
    );

    expect(response.status).toBe(400);
    expect(mocks.auth).not.toHaveBeenCalled();
  });

  it("requires a signed-in account", async () => {
    mocks.auth.mockResolvedValue({
      isAuthenticated: false,
      userId: null,
      getToken: mocks.getToken,
      has: mocks.has,
    });

    const response = await POST(request());

    expect(response.status).toBe(401);
    await expect(response.json()).resolves.toEqual({
      error: "Authentication required",
    });
    expect(mocks.has).not.toHaveBeenCalled();
    expect(mocks.getToken).not.toHaveBeenCalled();
    expect(mocks.deleteUser).not.toHaveBeenCalled();
  });

  it("fails closed with private headers when Clerk auth is unavailable", async () => {
    mocks.auth.mockRejectedValue(new Error("Clerk unavailable"));
    const consoleError = vi
      .spyOn(console, "error")
      .mockImplementation(() => undefined);

    const response = await POST(request());

    expect(response.status).toBe(503);
    expect(response.headers.get("Cache-Control")).toBe("private, no-store");
    await expect(response.json()).resolves.toEqual({
      error: "Account deletion is temporarily unavailable.",
    });
    expect(mocks.fetchMutation).not.toHaveBeenCalled();
    expect(mocks.deleteUser).not.toHaveBeenCalled();
    expect(consoleError).toHaveBeenCalled();
  });

  it("returns Clerk's strict reverification challenge before doing destructive work", async () => {
    mocks.has.mockReturnValue(false);

    const response = await POST(request());

    expect(response.status).toBe(403);
    expect(response.headers.get("Cache-Control")).toBe("private, no-store");
    await expect(response.json()).resolves.toEqual({
      clerk_error: {
        type: "forbidden",
        reason: "reverification-error",
        metadata: { reverification: "strict" },
      },
    });
    expect(mocks.getToken).not.toHaveBeenCalled();
    expect(mocks.fetchMutation).not.toHaveBeenCalled();
    expect(mocks.deleteUser).not.toHaveBeenCalled();
  });

  it("never deletes Clerk when the durable Convex initiation fails", async () => {
    mocks.fetchMutation.mockReset().mockRejectedValue(new Error("offline"));
    const consoleError = vi
      .spyOn(console, "error")
      .mockImplementation(() => undefined);

    const response = await POST(request());

    expect(response.status).toBe(503);
    await expect(response.json()).resolves.toEqual({
      error: "Account deletion is temporarily unavailable.",
      outcome: "uncertain",
    });
    expect(mocks.deleteUser).not.toHaveBeenCalled();
    expect(mocks.createMarkClerkDeletionAttestation).not.toHaveBeenCalled();
    expect(consoleError).toHaveBeenCalled();
  });

  it("never deletes Clerk when the session cannot supply a Convex token", async () => {
    mocks.getToken.mockResolvedValue(null);

    const response = await POST(request());

    expect(response.status).toBe(503);
    await expect(response.json()).resolves.toEqual({
      error: "Account deletion is temporarily unavailable.",
    });
    expect(mocks.fetchMutation).not.toHaveBeenCalled();
    expect(mocks.deleteUser).not.toHaveBeenCalled();
  });

  it("fails before durable initiation when server attestation is not configured", async () => {
    vi.stubEnv("TTS_QUOTA_BYPASS_SECRET", "");

    const response = await POST(request());

    expect(response.status).toBe(503);
    expect(mocks.fetchMutation).not.toHaveBeenCalled();
    expect(mocks.deleteUser).not.toHaveBeenCalled();
  });

  it("returns pending and records a retry after an ambiguous Clerk failure", async () => {
    mocks.deleteUser.mockRejectedValue(new Error("network unavailable"));

    const response = await POST(request());

    expect(response.status).toBe(202);
    await expect(response.json()).resolves.toEqual({ status: "pending" });
    expect(mocks.createMarkClerkDeletionAttestation).toHaveBeenCalledWith({
      requestId: "request_123",
      clerkUserId: "user_123",
      outcome: "retry",
    });
    expect(mocks.fetchMutation).toHaveBeenNthCalledWith(
      2,
      api.accountDeletion.markClerkDeletion,
      expect.objectContaining({ outcome: "retry" }),
    );
  });

  it("treats an already-missing Clerk user as deleted", async () => {
    mocks.deleteUser.mockRejectedValue({ status: 404, clerkError: true });

    const response = await POST(request());

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual({ status: "deleted" });
    expect(mocks.createMarkClerkDeletionAttestation).toHaveBeenCalledWith(
      expect.objectContaining({ outcome: "deleted" }),
    );
  });

  it("reports deletion as complete when Clerk succeeded but confirmation persistence must retry", async () => {
    mocks.fetchMutation
      .mockReset()
      .mockResolvedValueOnce({
        requestId: "request_123",
        status: "pending_clerk",
        created: true,
      })
      .mockRejectedValueOnce(new Error("Convex unavailable"));
    const consoleError = vi
      .spyOn(console, "error")
      .mockImplementation(() => undefined);

    const response = await POST(request());

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual({ status: "deleted" });
    expect(consoleError).toHaveBeenCalled();
  });
});
