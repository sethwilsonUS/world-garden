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

describe("GET /api/podcast/personal.xml", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    getOrCreatePodcastShowArtworkUrl.mockResolvedValue(
      "https://cdn.example.com/personal-show.png",
    );
  });

  it("returns 404 for a missing or invalid feed token", async () => {
    fetchQuery.mockResolvedValue(null);

    const { GET } = await import("./route");
    const response = await GET(
      new NextRequest("https://curiogarden.org/api/podcast/personal.xml?token=bad-token"),
    );

    expect(response.status).toBe(404);
  });

  it("renders ready queue items in queue order with tokenized enclosure urls", async () => {
    fetchQuery.mockResolvedValue({
      feed: {
        updatedAt: Date.UTC(2026, 2, 16, 18, 0, 0),
      },
      episodes: [
        {
          _id: "episode-1",
          slug: "mars",
          title: "Mars",
          description: "First in queue.",
          imageUrl: "https://images.example.com/mars.jpg",
          status: "ready",
          position: 0,
          publishedAt: Date.UTC(2026, 2, 16, 18, 0, 0),
          updatedAt: Date.UTC(2026, 2, 16, 18, 1, 0),
          durationSeconds: 120,
          byteLength: 12345,
        },
        {
          _id: "episode-2",
          slug: "venus",
          title: "Venus",
          description: "Second in queue.",
          status: "ready",
          position: 1,
          publishedAt: Date.UTC(2026, 2, 16, 17, 59, 0),
          updatedAt: Date.UTC(2026, 2, 16, 18, 2, 0),
          durationSeconds: 90,
          byteLength: 54321,
        },
      ],
    });

    const { GET } = await import("./route");
    const response = await GET(
      new NextRequest("https://curiogarden.org/api/podcast/personal.xml?token=opaque-token"),
    );
    const xml = await response.text();

    expect(response.status).toBe(200);
    expect(xml).toContain("<itunes:block>yes</itunes:block>");
    expect(xml).toContain("<url>https://cdn.example.com/personal-show.png</url>");
    expect(xml).toContain(
      'url="https://curiogarden.org/api/podcast/media/personal/episode-1?token=opaque-token"',
    );
    expect(xml.indexOf("<title>Mars</title>")).toBeLessThan(
      xml.indexOf("<title>Venus</title>"),
    );
    expect(xml).toContain(
      '<itunes:image href="https://images.example.com/mars.jpg" />',
    );
  });
});
