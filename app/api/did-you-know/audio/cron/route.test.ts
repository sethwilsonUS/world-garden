import { NextRequest } from "next/server";
import { beforeEach, describe, expect, it, vi } from "vitest";

const syncDidYouKnowAudio = vi.fn();
const resolveDidYouKnowFeedDateIso = vi.fn();
const getPodcastAdminAuthError = vi.fn();
const getPodcastSiteUrl = vi.fn();
const enforceRouteQuota = vi.fn();
const revalidatePath = vi.fn();

vi.mock("next/cache", () => ({
  revalidatePath,
}));

vi.mock("@/lib/did-you-know-audio", () => ({
  resolveDidYouKnowFeedDateIso,
  syncDidYouKnowAudio,
}));

vi.mock("@/lib/podcast-admin-auth", () => ({
  getPodcastAdminAuthError,
}));

vi.mock("@/lib/podcast-feed", () => ({
  getPodcastSiteUrl,
}));

vi.mock("@/lib/route-rate-limit", () => ({
  enforceRouteQuota,
}));

describe("GET /api/did-you-know/audio/cron", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    getPodcastAdminAuthError.mockReturnValue(null);
    getPodcastSiteUrl.mockImplementation((origin?: string) => origin ?? "");
    enforceRouteQuota.mockResolvedValue(null);
    resolveDidYouKnowFeedDateIso.mockReturnValue("2026-03-16");
  });

  it("rejects missing or invalid authorization", async () => {
    getPodcastAdminAuthError.mockReturnValue("Unauthorized");

    const { GET } = await import("./route");
    const response = await GET(
      new NextRequest("https://curiogarden.org/api/did-you-know/audio/cron"),
    );

    expect(response.status).toBe(401);
    await expect(response.json()).resolves.toEqual({
      error: "Unauthorized",
    });
    expect(enforceRouteQuota).not.toHaveBeenCalled();
  });

  it("returns a config error when CRON_SECRET is unset", async () => {
    getPodcastAdminAuthError.mockReturnValue("CRON_SECRET is not configured");

    const { GET } = await import("./route");
    const response = await GET(
      new NextRequest("https://curiogarden.org/api/did-you-know/audio/cron", {
        headers: { authorization: "Bearer test-secret" },
      }),
    );

    expect(response.status).toBe(500);
    await expect(response.json()).resolves.toEqual({
      error: "CRON_SECRET is not configured",
    });
  });

  it("returns 201 and revalidates the page when today's audio is created", async () => {
    syncDidYouKnowAudio.mockResolvedValue({
      status: "created",
      audio: null,
      feedDate: "2026-03-16",
      title: "Did You Know? March 16, 2026",
    });

    const { GET } = await import("./route");
    const response = await GET(
      new NextRequest("https://curiogarden.org/api/did-you-know/audio/cron", {
        headers: { authorization: "Bearer test-secret" },
      }),
    );

    expect(response.status).toBe(201);
    expect(syncDidYouKnowAudio).toHaveBeenCalledWith({
      baseUrl: "https://curiogarden.org",
    });
    expect(revalidatePath).toHaveBeenCalledWith("/did-you-know");
  });

  it("returns 200 for an already-existing daily audio edition", async () => {
    syncDidYouKnowAudio.mockResolvedValue({
      status: "already_exists",
      audio: null,
      feedDate: "2026-03-16",
      title: "Did You Know? March 16, 2026",
    });

    const { GET } = await import("./route");
    const response = await GET(
      new NextRequest("https://curiogarden.org/api/did-you-know/audio/cron", {
        headers: { authorization: "Bearer test-secret" },
      }),
    );

    expect(response.status).toBe(200);
    expect(revalidatePath).toHaveBeenCalledWith("/did-you-know");
  });

  it("returns 202 without revalidating when generation is already in flight", async () => {
    syncDidYouKnowAudio.mockResolvedValue({
      status: "pending",
      audio: null,
      feedDate: "2026-03-16",
      title: "Did You Know? March 16, 2026",
    });

    const { GET } = await import("./route");
    const response = await GET(
      new NextRequest("https://curiogarden.org/api/did-you-know/audio/cron", {
        headers: { authorization: "Bearer test-secret" },
      }),
    );

    expect(response.status).toBe(202);
    expect(revalidatePath).not.toHaveBeenCalled();
  });

  it("does not revalidate when a non-current feed date is returned", async () => {
    syncDidYouKnowAudio.mockResolvedValue({
      status: "created",
      audio: null,
      feedDate: "2026-03-15",
      title: "Did You Know? March 15, 2026",
    });

    const { GET } = await import("./route");
    const response = await GET(
      new NextRequest("https://curiogarden.org/api/did-you-know/audio/cron", {
        headers: { authorization: "Bearer test-secret" },
      }),
    );

    expect(response.status).toBe(201);
    expect(revalidatePath).not.toHaveBeenCalled();
  });
});
