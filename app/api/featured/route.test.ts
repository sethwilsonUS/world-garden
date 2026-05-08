import { NextRequest } from "next/server";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const fetchWikipediaFeaturedSnapshot = vi.fn();
const filterSafeTitles = vi.fn();
const syncPictureOfDayAudio = vi.fn();
const getPodcastSiteUrl = vi.fn();

vi.mock("@/lib/featured-article", () => ({
  fetchWikipediaFeaturedSnapshot,
}));

vi.mock("@/lib/nsfw-filter", () => ({
  filterSafeTitles,
}));

vi.mock("@/lib/picture-of-day-audio", () => ({
  syncPictureOfDayAudio,
}));

vi.mock("@/lib/podcast-feed", () => ({
  getPodcastSiteUrl,
}));

const snapshot = {
  tfa: null,
  trendingCandidates: [],
  didYouKnow: [],
  inTheNews: [],
  onThisDay: [],
  pictureOfDay: {
    title: "File:Hoverfly May 2008-8.jpg",
    pictureKey: "File:Hoverfly May 2008-8.jpg",
    altText: "A Marmelade fly on flight.",
    description: "A Marmelade fly on flight.",
  },
  trendingDate: null,
  trendingSource: null,
  trendingSourceType: null,
  trendingIsStale: false,
  feedDate: "2026/05/08",
  feedDateIso: "2026-05-08",
};

const originalLocalMode = process.env.NEXT_PUBLIC_LOCAL_MODE;
const originalConvexUrl = process.env.NEXT_PUBLIC_CONVEX_URL;

describe("GET /api/featured", () => {
  beforeEach(() => {
    vi.resetModules();
    vi.clearAllMocks();
    process.env.NEXT_PUBLIC_LOCAL_MODE = "false";
    process.env.NEXT_PUBLIC_CONVEX_URL = "https://example.convex.cloud";
    fetchWikipediaFeaturedSnapshot.mockResolvedValue(snapshot);
    filterSafeTitles.mockResolvedValue(new Set<string>());
    getPodcastSiteUrl.mockImplementation((origin?: string) => origin ?? "");
  });

  afterEach(() => {
    if (originalLocalMode === undefined) {
      delete process.env.NEXT_PUBLIC_LOCAL_MODE;
    } else {
      process.env.NEXT_PUBLIC_LOCAL_MODE = originalLocalMode;
    }

    if (originalConvexUrl === undefined) {
      delete process.env.NEXT_PUBLIC_CONVEX_URL;
    } else {
      process.env.NEXT_PUBLIC_CONVEX_URL = originalConvexUrl;
    }
  });

  it("syncs picture audio and includes the cached URL when ready", async () => {
    syncPictureOfDayAudio.mockResolvedValue({
      status: "created",
      feedDate: "2026-05-08",
      title: "Picture of the Day: May 8, 2026",
      audio: {
        audioUrl: "https://cdn.example.com/picture.mp3",
        durationSeconds: 42,
      },
    });

    const { GET } = await import("./route");
    const response = await GET(
      new NextRequest("https://curiogarden.org/api/featured"),
    );
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(syncPictureOfDayAudio).toHaveBeenCalledWith({
      baseUrl: "https://curiogarden.org",
      feedDateIso: "2026-05-08",
      picture: snapshot.pictureOfDay,
    });
    expect(body.pictureOfDay.audio).toMatchObject({
      status: "ready",
      audioUrl: "https://cdn.example.com/picture.mp3",
      durationSeconds: 42,
    });
    expect(response.headers.get("cache-control")).toContain("s-maxage=900");
  });

  it("uses no-store caching while picture audio is pending", async () => {
    syncPictureOfDayAudio.mockResolvedValue({
      status: "pending",
      feedDate: "2026-05-08",
      title: "Picture of the Day: May 8, 2026",
      audio: null,
    });

    const { GET } = await import("./route");
    const response = await GET(
      new NextRequest("https://curiogarden.org/api/featured"),
    );
    const body = await response.json();

    expect(body.pictureOfDay.audio).toMatchObject({
      status: "pending",
      audioUrl: null,
    });
    expect(response.headers.get("cache-control")).toBe("no-store");
  });

  it("skips picture audio sync in local mode", async () => {
    process.env.NEXT_PUBLIC_LOCAL_MODE = "true";

    const { GET } = await import("./route");
    const response = await GET(
      new NextRequest("https://curiogarden.org/api/featured"),
    );
    const body = await response.json();

    expect(syncPictureOfDayAudio).not.toHaveBeenCalled();
    expect(body.pictureOfDay.audio).toBeUndefined();
    expect(response.headers.get("cache-control")).toBe("no-store");
  });
});
