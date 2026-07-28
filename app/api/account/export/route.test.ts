import { NextRequest } from "next/server";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  auth: vi.fn(),
  currentUser: vi.fn(),
  getToken: vi.fn(),
}));

vi.mock("server-only", () => ({}));
vi.mock("@clerk/nextjs/server", () => ({
  auth: mocks.auth,
  currentUser: mocks.currentUser,
}));

import { POST } from "./route";

const requestFetch = vi.fn();

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

const convexSuccess = (value: unknown) =>
  new Response(JSON.stringify({ status: "success", value, logLines: [] }), {
    status: 200,
    headers: { "Content-Type": "application/json" },
  });

const request = (origin = "https://curiogarden.org") =>
  new NextRequest("https://curiogarden.org/api/account/export", {
    method: "POST",
    headers: origin ? { Origin: origin } : undefined,
  });

const installEmptyAccountDataBackend = () => {
  requestFetch.mockImplementation(
    async (_input: RequestInfo | URL, init?: RequestInit) => {
      const body = JSON.parse(String(init?.body)) as { path: string };
      return body.path.endsWith("getViewerAccountDataOverview")
        ? convexSuccess({ feed: null, quotas: [] })
        : convexSuccess({ page: [], continueCursor: "done", isDone: true });
    },
  );
};

describe("POST /api/account/export", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-07-27T12:34:56.789Z"));
    vi.stubEnv(
      "NEXT_PUBLIC_CONVEX_URL",
      "https://curio-garden-test.convex.cloud",
    );
    vi.stubGlobal("fetch", requestFetch);
    mocks.auth.mockResolvedValue({
      isAuthenticated: true,
      userId: "user_123",
      getToken: mocks.getToken,
    });
    mocks.getToken.mockResolvedValue("convex-jwt");
    mocks.currentUser.mockResolvedValue(clerkUser);
    installEmptyAccountDataBackend();
  });

  afterEach(() => {
    vi.restoreAllMocks();
    vi.useRealTimers();
    vi.unstubAllEnvs();
    vi.unstubAllGlobals();
  });

  it("returns one complete private JSON attachment for the active account", async () => {
    const response = await POST(request());

    expect(response.status).toBe(200);
    expect(response.headers.get("Cache-Control")).toBe("private, no-store");
    expect(response.headers.get("Pragma")).toBe("no-cache");
    expect(response.headers.get("Expires")).toBe("0");
    expect(response.headers.get("X-Content-Type-Options")).toBe("nosniff");
    expect(response.headers.get("Cross-Origin-Resource-Policy")).toBe(
      "same-origin",
    );
    expect(response.headers.get("Content-Type")).toBe(
      "application/json; charset=utf-8",
    );
    expect(response.headers.get("Content-Disposition")).toBe(
      'attachment; filename="curio-garden-account-data-2026-07-27.json"',
    );

    const manifest = await response.json();
    expect(manifest).toMatchObject({
      format: "curio-garden-account-export",
      version: 1,
      exportedAt: "2026-07-27T12:34:56.789Z",
      account: { id: "user_123" },
      scope: {
        serverSideDataOnly: true,
        audioBinariesIncluded: false,
      },
    });
    expect(mocks.auth).toHaveBeenCalledOnce();
    expect(mocks.getToken).toHaveBeenCalledOnce();
    expect(mocks.getToken).toHaveBeenCalledWith({ template: "convex" });
    expect(mocks.currentUser).toHaveBeenCalledOnce();
    expect(requestFetch).toHaveBeenCalledTimes(6);
    for (const [, init] of requestFetch.mock.calls as Array<
      [string, RequestInit]
    >) {
      expect(new Headers(init.headers).get("Authorization")).toBe(
        "Bearer convex-jwt",
      );
    }
    expect(vi.getTimerCount()).toBe(0);
  });

  it("rejects a cross-origin POST before consulting the session", async () => {
    const response = await POST(request("https://mordor.example"));

    expect(response.status).toBe(403);
    expect(response.headers.get("Cache-Control")).toBe("private, no-store");
    expect(response.headers.get("Content-Disposition")).toBeNull();
    await expect(response.json()).resolves.toEqual({
      error: "Request not allowed",
    });
    expect(mocks.auth).not.toHaveBeenCalled();
    expect(mocks.currentUser).not.toHaveBeenCalled();
    expect(requestFetch).not.toHaveBeenCalled();
  });

  it.each(["cross-site", "same-site", "none"])(
    "rejects missing-Origin requests marked %s by fetch metadata",
    async (fetchSite) => {
      const response = await POST(
        new NextRequest("https://curiogarden.org/api/account/export", {
          method: "POST",
          headers: { "Sec-Fetch-Site": fetchSite },
        }),
      );

      expect(response.status).toBe(403);
      expect(response.headers.get("Cache-Control")).toBe("private, no-store");
      expect(mocks.auth).not.toHaveBeenCalled();
      expect(requestFetch).not.toHaveBeenCalled();
    },
  );

  it("requires a signed-in account before resolving private data", async () => {
    mocks.auth.mockResolvedValue({
      isAuthenticated: false,
      userId: null,
      getToken: mocks.getToken,
    });

    const response = await POST(request());

    expect(response.status).toBe(401);
    expect(response.headers.get("Cache-Control")).toBe("private, no-store");
    await expect(response.json()).resolves.toEqual({
      error: "Authentication required",
    });
    expect(mocks.getToken).not.toHaveBeenCalled();
    expect(mocks.currentUser).not.toHaveBeenCalled();
    expect(requestFetch).not.toHaveBeenCalled();
  });

  it("rejects a POST with no affirmative browser provenance", async () => {
    const response = await POST(request(""));

    expect(response.status).toBe(403);
    expect(response.headers.get("Content-Disposition")).toBeNull();
    expect(mocks.auth).not.toHaveBeenCalled();
    expect(requestFetch).not.toHaveBeenCalled();
  });

  it("accepts same-origin fetch metadata when Origin is unavailable", async () => {
    const response = await POST(
      new NextRequest("https://curiogarden.org/api/account/export", {
        method: "POST",
        headers: { "Sec-Fetch-Site": "same-origin" },
      }),
    );

    expect(response.status).toBe(200);
    expect(response.headers.get("Content-Disposition")).toContain(
      "curio-garden-account-data-2026-07-27.json",
    );
  });

  it("fails closed when the active session cannot supply its Convex JWT", async () => {
    mocks.getToken.mockResolvedValue(null);

    const response = await POST(request());

    expect(response.status).toBe(503);
    expect(response.headers.get("Cache-Control")).toBe("private, no-store");
    await expect(response.json()).resolves.toEqual({
      error: "Account data export is temporarily unavailable.",
    });
    expect(mocks.getToken).toHaveBeenCalledOnce();
    expect(mocks.currentUser).toHaveBeenCalledOnce();
    expect(requestFetch).not.toHaveBeenCalled();
  });

  it("stops awaiting auth when the incoming request is aborted", async () => {
    mocks.auth.mockImplementation(
      () =>
        new Promise((resolve) => {
          setTimeout(
            () =>
              resolve({
                isAuthenticated: true,
                userId: "user_123",
                getToken: mocks.getToken,
              }),
            11_000,
          );
        }),
    );
    const consoleError = vi
      .spyOn(console, "error")
      .mockImplementation(() => undefined);
    const controller = new AbortController();
    let settled = false;
    const exportRequest = POST(
      new NextRequest("https://curiogarden.org/api/account/export", {
        method: "POST",
        headers: { Origin: "https://curiogarden.org" },
        signal: controller.signal,
      }),
    ).finally(() => {
      settled = true;
    });

    await vi.advanceTimersByTimeAsync(0);
    controller.abort(new Error("Reader left the account page"));
    await vi.advanceTimersByTimeAsync(0);
    const settledAtAbort = settled;
    await vi.advanceTimersByTimeAsync(11_000);
    const response = await exportRequest;

    expect(settledAtAbort).toBe(true);
    expect(response.status).toBe(503);
    await expect(response.json()).resolves.toEqual({
      error: "Account data export is temporarily unavailable.",
    });
    expect(mocks.currentUser).not.toHaveBeenCalled();
    expect(mocks.getToken).not.toHaveBeenCalled();
    expect(consoleError).toHaveBeenCalledWith(
      "[/api/account/export] Account export failed",
    );
    expect(vi.getTimerCount()).toBe(0);
  });

  it("caps Clerk token and profile resolution at ten seconds", async () => {
    mocks.getToken.mockImplementation(
      () =>
        new Promise((resolve) => {
          setTimeout(() => resolve("late-convex-jwt"), 11_000);
        }),
    );
    mocks.currentUser.mockImplementation(
      () =>
        new Promise((resolve) => {
          setTimeout(() => resolve(clerkUser), 11_000);
        }),
    );
    const consoleError = vi
      .spyOn(console, "error")
      .mockImplementation(() => undefined);
    let settled = false;
    const exportRequest = POST(request()).finally(() => {
      settled = true;
    });

    await vi.advanceTimersByTimeAsync(10_000);
    const settledAtAuthDeadline = settled;
    await vi.advanceTimersByTimeAsync(1_000);
    const response = await exportRequest;

    expect(settledAtAuthDeadline).toBe(true);
    expect(response.status).toBe(503);
    await expect(response.json()).resolves.toEqual({
      error: "Account data export is temporarily unavailable.",
    });
    expect(requestFetch).not.toHaveBeenCalled();
    expect(consoleError).toHaveBeenCalledWith(
      "[/api/account/export] Account export failed",
    );
    expect(vi.getTimerCount()).toBe(0);
  });

  it("fails closed when Clerk profile identity differs from the session", async () => {
    mocks.currentUser.mockResolvedValue({ ...clerkUser, id: "user_other" });

    const response = await POST(request());

    expect(response.status).toBe(503);
    await expect(response.json()).resolves.toEqual({
      error: "Account data export is temporarily unavailable.",
    });
    expect(mocks.currentUser).toHaveBeenCalledOnce();
    expect(requestFetch).not.toHaveBeenCalled();
  });

  it("cancels every Convex request when the account export request is aborted", async () => {
    const requestSignals: AbortSignal[] = [];
    requestFetch.mockImplementation(
      (_input: RequestInfo | URL, init?: RequestInit) => {
        const signal = init?.signal as AbortSignal;
        requestSignals.push(signal);
        return new Promise<Response>((_resolve, reject) => {
          signal.addEventListener("abort", () => reject(signal.reason), {
            once: true,
          });
        });
      },
    );
    const consoleError = vi
      .spyOn(console, "error")
      .mockImplementation(() => undefined);
    const controller = new AbortController();
    const exportRequest = POST(
      new NextRequest("https://curiogarden.org/api/account/export", {
        method: "POST",
        headers: { Origin: "https://curiogarden.org" },
        signal: controller.signal,
      }),
    );

    await vi.advanceTimersByTimeAsync(0);
    controller.abort(new Error("Reader left the account page"));
    await vi.advanceTimersByTimeAsync(0);
    const response = await exportRequest;

    expect(response.status).toBe(503);
    await expect(response.json()).resolves.toEqual({
      error: "Account data export is temporarily unavailable.",
    });
    expect(requestSignals).toHaveLength(6);
    expect(requestSignals.every((signal) => signal.aborted)).toBe(true);
    expect(vi.getTimerCount()).toBe(0);
    expect(consoleError).toHaveBeenCalledWith(
      "[/api/account/export] Account export failed",
    );
  });

  it("returns no partial archive or backend details when any page fails", async () => {
    let bookmarkPage = 0;
    requestFetch.mockImplementation(
      async (_input: RequestInfo | URL, init?: RequestInit) => {
        const body = JSON.parse(String(init?.body)) as {
          path: string;
          args: [{ collection?: string }];
        };
        if (body.path.endsWith("getViewerAccountDataOverview")) {
          return convexSuccess({ feed: null, quotas: [] });
        }
        if (body.args[0].collection === "bookmarks") {
          bookmarkPage += 1;
          if (bookmarkPage === 2) {
            throw new Error("Secret Convex deployment details");
          }
          return convexSuccess({
            page: [
              {
                slug: "The_Shire",
                title: "The Shire",
                savedAt: 1,
                updatedAt: 2,
              },
            ],
            continueCursor: "bookmark-next",
            isDone: false,
          });
        }
        return convexSuccess({
          page: [],
          continueCursor: "done",
          isDone: true,
        });
      },
    );
    const consoleError = vi
      .spyOn(console, "error")
      .mockImplementation(() => undefined);

    const response = await POST(request());
    const responseText = await response.text();

    expect(response.status).toBe(503);
    expect(response.headers.get("Cache-Control")).toBe("private, no-store");
    expect(response.headers.get("Content-Disposition")).toBeNull();
    expect(JSON.parse(responseText)).toEqual({
      error: "Account data export is temporarily unavailable.",
    });
    expect(responseText).not.toMatch(
      /Secret Convex deployment details|The Shire|curio-garden-account-export/u,
    );
    expect(consoleError).toHaveBeenCalledWith(
      "[/api/account/export] Account export failed",
    );
  });
});
