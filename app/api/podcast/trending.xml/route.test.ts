import { NextRequest } from "next/server";
import { beforeEach, describe, expect, it, vi } from "vitest";

const fetchQuery = vi.fn();
const getOrCreatePodcastShowArtworkUrl = vi.fn();

vi.mock("convex/nextjs", () => ({
  fetchQuery,
}));

vi.mock("@/lib/podcast-show-artwork-cache", () => ({
  getOrCreatePodcastShowArtworkUrl,
}));

describe("GET /api/podcast/trending.xml", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    getOrCreatePodcastShowArtworkUrl.mockResolvedValue(
      "https://cdn.example.com/trending-show.png",
    );
  });

  it("uses stored episode artwork urls for item images when available", async () => {
    fetchQuery.mockResolvedValue([
      {
        _id: "brief-1",
        trendingDate: "2026-03-10",
        headline: "Daily brief",
        podcastDescription: "Why these topics are trending.",
        artworkUrl: "https://cdn.example.com/trending-episode.png",
        imageUrls: ["https://images.example.com/legacy.png"],
        audioUrl: "https://cdn.example.com/brief.mp3",
        status: "ready",
        updatedAt: Date.UTC(2026, 2, 10, 5, 15, 0),
        durationSeconds: 90,
        byteLength: 12345,
      },
    ]);

    const { GET } = await import("./route");
    const response = await GET(
      new NextRequest("https://curiogarden.org/api/podcast/trending.xml"),
    );
    const xml = await response.text();

    expect(response.status).toBe(200);
    expect(xml).toContain('xmlns:content="http://purl.org/rss/1.0/modules/content/"');
    expect(xml).toContain("<itunes:block>yes</itunes:block>");
    expect(xml).toContain("<url>https://cdn.example.com/trending-show.png</url>");
    expect(xml).toContain(
      '<itunes:image href="https://cdn.example.com/trending-episode.png" />',
    );
  });
});
