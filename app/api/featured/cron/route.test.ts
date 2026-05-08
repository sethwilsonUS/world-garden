import { revalidatePath } from "next/cache";
import { NextRequest } from "next/server";
import { beforeEach, describe, expect, it, vi } from "vitest";

const getPodcastAdminAuthError = vi.fn();
const enforceRouteQuota = vi.fn();
const getPodcastSiteUrl = vi.fn();
const resolveTodayFeedDateIso = vi.fn();
const syncTodayWikipediaSnapshot = vi.fn();

vi.mock("next/cache", () => ({
  revalidatePath: vi.fn(),
}));

vi.mock("@/lib/podcast-admin-auth", () => ({
  getPodcastAdminAuthError,
}));

vi.mock("@/lib/route-rate-limit", () => ({
  enforceRouteQuota,
}));

vi.mock("@/lib/podcast-feed", () => ({
  getPodcastSiteUrl,
}));

vi.mock("@/lib/today-snapshot", () => ({
  resolveTodayFeedDateIso,
  syncTodayWikipediaSnapshot,
}));

describe("GET /api/featured/cron", () => {
  beforeEach(() => {
    vi.resetModules();
    vi.clearAllMocks();
    getPodcastAdminAuthError.mockReturnValue(null);
    enforceRouteQuota.mockResolvedValue(null);
    getPodcastSiteUrl.mockImplementation((origin?: string) => origin ?? "");
    resolveTodayFeedDateIso.mockReturnValue("2026-05-08");
    syncTodayWikipediaSnapshot.mockResolvedValue({
      feedDate: "2026-05-08",
      snapshotFeedDate: "2026-05-08",
      snapshotGeneratedAt: 1_778_286_400_000,
      snapshotIsStale: false,
    });
  });

  it("requires admin authorization", async () => {
    getPodcastAdminAuthError.mockReturnValue("Unauthorized");

    const { GET } = await import("./route");
    const response = await GET(
      new NextRequest("https://curiogarden.org/api/featured/cron"),
    );

    expect(response.status).toBe(401);
    expect(syncTodayWikipediaSnapshot).not.toHaveBeenCalled();
  });

  it("honors route quota responses", async () => {
    enforceRouteQuota.mockResolvedValue(
      Response.json({ error: "Too many requests" }, { status: 429 }),
    );

    const { GET } = await import("./route");
    const response = await GET(
      new NextRequest("https://curiogarden.org/api/featured/cron"),
    );

    expect(response.status).toBe(429);
    expect(syncTodayWikipediaSnapshot).not.toHaveBeenCalled();
  });

  it("syncs the snapshot and revalidates the home page", async () => {
    const { GET } = await import("./route");
    const response = await GET(
      new NextRequest("https://curiogarden.org/api/featured/cron"),
    );
    const body = await response.json();

    expect(response.status).toBe(201);
    expect(syncTodayWikipediaSnapshot).toHaveBeenCalledWith({
      baseUrl: "https://curiogarden.org",
    });
    expect(revalidatePath).toHaveBeenCalledWith("/");
    expect(body.feedDate).toBe("2026-05-08");
  });
});
