import { beforeEach, describe, expect, it, vi } from "vitest";

const getTodayWikipediaData = vi.fn();
const fetchWikipediaFeaturedSnapshot = vi.fn();
const getPictureOfDayAudioState = vi.fn();

vi.mock("@/lib/today-snapshot", () => ({
  getTodayWikipediaData,
}));

vi.mock("@/lib/featured-article", () => ({
  fetchWikipediaFeaturedSnapshot,
}));

vi.mock("@/lib/picture-of-day-audio", () => ({
  getPictureOfDayAudioState,
}));

describe("GET /api/featured", () => {
  beforeEach(() => {
    vi.resetModules();
    vi.clearAllMocks();
    getPictureOfDayAudioState.mockResolvedValue(null);
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
    const response = await GET();
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
    const response = await GET();
    const body = await response.json();

    expect(response.status).toBe(503);
    expect(response.headers.get("cache-control")).toBe("no-store");
    expect(body.error).toContain("No Today on Wikipedia snapshot");
  });

  it("does not include Did You Know audio state with the featured payload", async () => {
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
      snapshotIsStale: false,
      didYouKnowAudio: {
        feedDate: "2026-05-07",
        title: "Legacy Did You Know? audio",
        status: "ready",
        audioUrl: "https://cdn.example.com/legacy-dyk.mp3",
      },
    });
    const { GET } = await import("./route");
    const response = await GET();
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(response.headers.get("cache-control")).toBe(
      "public, max-age=900, s-maxage=900, stale-while-revalidate=3600",
    );
    expect(body.didYouKnowAudio).toBeUndefined();
  });

  it("logs details but returns a generic public error on unexpected failures", async () => {
    const consoleError = vi
      .spyOn(console, "error")
      .mockImplementation(() => undefined);
    getTodayWikipediaData.mockRejectedValue(
      new Error("upstream token leaked in message"),
    );

    const { GET } = await import("./route");
    const response = await GET();
    const body = await response.json();

    expect(response.status).toBe(502);
    expect(body.error).toBe("Unable to load Today on Wikipedia right now.");
    expect(body.error).not.toContain("upstream token");
    expect(consoleError).toHaveBeenCalled();
  });
});
