import { NextRequest } from "next/server";
import { beforeEach, describe, expect, it, vi } from "vitest";

const getTodayWikipediaData = vi.fn();
const fetchWikipediaFeaturedSnapshot = vi.fn();

vi.mock("@/lib/today-snapshot", () => ({
  getTodayWikipediaData,
}));

vi.mock("@/lib/featured-article", () => ({
  fetchWikipediaFeaturedSnapshot,
}));

describe("GET /api/featured", () => {
  beforeEach(() => {
    vi.resetModules();
    vi.clearAllMocks();
  });

  it("returns the cached Today snapshot without fetching Wikipedia in production", async () => {
    getTodayWikipediaData.mockResolvedValue({
      tfa: null,
      trending: [],
      didYouKnow: [],
      inTheNews: [],
      pictureOfDay: null,
      onThisDay: [],
      trendingDate: null,
      trendingSource: null,
      trendingSourceType: null,
      trendingIsStale: false,
      feedDate: "2026-05-07",
      snapshotFeedDate: "2026-05-07",
      snapshotGeneratedAt: 1_778_200_000_000,
      snapshotIsStale: true,
    });

    const { GET } = await import("./route");
    const response = await GET(
      new NextRequest("https://curiogarden.org/api/featured"),
    );
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body.snapshotIsStale).toBe(true);
    expect(body.snapshotFeedDate).toBe("2026-05-07");
    expect(getTodayWikipediaData).toHaveBeenCalledWith({
      allowLiveFallback: true,
    });
    expect(fetchWikipediaFeaturedSnapshot).not.toHaveBeenCalled();
  });

  it("returns a no-store 503 when production has no cached snapshot", async () => {
    getTodayWikipediaData.mockResolvedValue(null);

    const { GET } = await import("./route");
    const response = await GET(
      new NextRequest("https://curiogarden.org/api/featured"),
    );
    const body = await response.json();

    expect(response.status).toBe(503);
    expect(response.headers.get("cache-control")).toBe("no-store");
    expect(body.error).toContain("No Today on Wikipedia snapshot");
  });
});
