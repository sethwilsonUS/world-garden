import { beforeEach, describe, expect, it, vi } from "vitest";

const getTodayWikipediaData = vi.fn();
const fetchWikipediaFeaturedSnapshot = vi.fn();
const getDidYouKnowAudioState = vi.fn();
const getPictureOfDayAudioState = vi.fn();

vi.mock("@/lib/today-snapshot", () => ({
  getTodayWikipediaData,
}));

vi.mock("@/lib/featured-article", () => ({
  fetchWikipediaFeaturedSnapshot,
}));

vi.mock("@/lib/did-you-know-audio", () => ({
  getDidYouKnowAudioState,
}));

vi.mock("@/lib/picture-of-day-audio", () => ({
  getPictureOfDayAudioState,
}));

describe("GET /api/featured", () => {
  beforeEach(() => {
    vi.resetModules();
    vi.clearAllMocks();
    getDidYouKnowAudioState.mockResolvedValue(null);
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

  it("does not cache per-request audio state with the featured payload", async () => {
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
    });
    getDidYouKnowAudioState.mockResolvedValue({
      feedDate: "2026-05-07",
      title: "Did You Know? May 7, 2026",
      status: "pending",
      audioUrl: null,
      audio: null,
    });

    const { GET } = await import("./route");
    const response = await GET();
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(response.headers.get("cache-control")).toBe("no-store");
    expect(body.didYouKnowAudio.status).toBe("pending");
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
