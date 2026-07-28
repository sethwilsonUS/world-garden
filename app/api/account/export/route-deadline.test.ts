import { NextRequest } from "next/server";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  assembleAccountDataExport: vi.fn(),
  auth: vi.fn(),
  currentUser: vi.fn(),
  getToken: vi.fn(),
}));

vi.mock("@/lib/account-data-export", () => ({
  assembleAccountDataExport: mocks.assembleAccountDataExport,
  getAccountDataExportFilename: vi.fn(
    () => "curio-garden-account-data-2026-07-27.json",
  ),
}));
vi.mock("@clerk/nextjs/server", () => ({
  auth: mocks.auth,
  currentUser: mocks.currentUser,
}));

import { POST } from "./route";

const clerkUser = {
  id: "user_123",
  firstName: "Samwise",
  lastName: "Gamgee",
  username: "gardener",
  imageUrl: "https://images.example.com/samwise.jpg",
  createdAt: 1_700_000_000_000,
  updatedAt: 1_710_000_000_000,
  lastSignInAt: 1_720_000_000_000,
  emailAddresses: [{ id: "email_1", emailAddress: "sam@example.com" }],
  phoneNumbers: [{ id: "phone_1", phoneNumber: "+15555550123" }],
};

describe("POST /api/account/export route deadline", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.useFakeTimers();
    mocks.auth.mockResolvedValue({
      isAuthenticated: true,
      userId: "user_123",
      getToken: mocks.getToken,
    });
    mocks.getToken.mockResolvedValue("convex-jwt");
    mocks.currentUser.mockResolvedValue(clerkUser);
  });

  afterEach(() => {
    vi.restoreAllMocks();
    vi.useRealTimers();
  });

  it("fails closed at 55 seconds when the assembler ignores cancellation", async () => {
    const exportSignals: AbortSignal[] = [];
    mocks.assembleAccountDataExport.mockImplementation(
      ({ signal }: { signal: AbortSignal }) => {
        exportSignals.push(signal);
        return new Promise(() => undefined);
      },
    );
    const consoleError = vi
      .spyOn(console, "error")
      .mockImplementation(() => undefined);
    let settled = false;
    const exportRequest = POST(
      new NextRequest("https://curiogarden.org/api/account/export", {
        method: "POST",
        headers: { Origin: "https://curiogarden.org" },
      }),
    );
    void exportRequest.then(
      () => {
        settled = true;
      },
      () => {
        settled = true;
      },
    );

    await vi.advanceTimersByTimeAsync(0);
    expect(mocks.assembleAccountDataExport).toHaveBeenCalledOnce();
    expect(settled).toBe(false);

    await vi.advanceTimersByTimeAsync(54_999);
    expect(settled).toBe(false);

    await vi.advanceTimersByTimeAsync(1);
    const response = await exportRequest;

    expect(response.status).toBe(503);
    expect(response.headers.get("Cache-Control")).toBe("private, no-store");
    expect(response.headers.get("Pragma")).toBe("no-cache");
    expect(response.headers.get("Expires")).toBe("0");
    expect(response.headers.get("Content-Disposition")).toBeNull();
    await expect(response.json()).resolves.toEqual({
      error: "Account data export is temporarily unavailable.",
    });
    expect(exportSignals).toHaveLength(1);
    expect(exportSignals.every((signal) => signal.aborted)).toBe(true);
    expect(consoleError).toHaveBeenCalledWith(
      "[/api/account/export] Account export failed",
      expect.objectContaining({ message: "Account export route timed out" }),
    );
    expect(vi.getTimerCount()).toBe(0);
  });
});
