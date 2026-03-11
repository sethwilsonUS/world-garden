import { NextRequest } from "next/server";
import { beforeEach, describe, expect, it, vi } from "vitest";

const fetchQuery = vi.fn();

vi.mock("convex/nextjs", () => ({
  fetchQuery,
}));

describe("GET /api/podcast/featured.xml", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("uses episode updatedAt for item pubDate so same-day corrections republish cleanly", async () => {
    fetchQuery.mockResolvedValue([
      {
        _id: "episode-1",
        slug: "example-article",
        title: "Example Article",
        description: "Example summary.",
        imageUrl: "https://images.example.com/article.jpg",
        artworkUrl: "https://cdn.example.com/featured-episode.png",
        audioUrl: "https://cdn.example.com/episode.mp3",
        status: "ready",
        publishedAt: Date.UTC(2026, 2, 11, 0, 0, 0),
        updatedAt: Date.UTC(2026, 2, 11, 6, 45, 0),
        durationSeconds: 95,
        byteLength: 12345,
      },
    ]);

    const { GET } = await import("./route");
    const response = await GET(
      new NextRequest("https://curiogarden.org/api/podcast/featured.xml"),
    );
    const xml = await response.text();

    expect(response.status).toBe(200);
    expect(xml).toContain("<pubDate>Wed, 11 Mar 2026 06:45:00 GMT</pubDate>");
    expect(xml).not.toContain("<pubDate>Wed, 11 Mar 2026 00:00:00 GMT</pubDate>");
    expect(xml).toContain(
      '<itunes:image href="https://cdn.example.com/featured-episode.png" />',
    );
  });
});
