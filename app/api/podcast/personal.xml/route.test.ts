import { NextRequest } from "next/server";
import { beforeEach, describe, expect, it, vi } from "vitest";

const fetchQuery = vi.fn();
const getOrCreatePodcastShowArtworkUrl = vi.fn();
const VALID_FEED_TOKEN = "c".repeat(64);
const ROTATED_FEED_TOKEN = "d".repeat(64);

const expectPrivateFeedHeaders = (response: Response) => {
  expect(response.headers.get("Cache-Control")).toContain("private");
  expect(response.headers.get("Cache-Control")).toContain("no-store");
  expect(response.headers.get("Referrer-Policy")).toBe("no-referrer");
  expect(response.headers.get("X-Robots-Tag")).toBe(
    "noindex, nofollow, noarchive",
  );
};

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
      new NextRequest(
        "https://curiogarden.org/api/podcast/personal.xml?token=bad-token",
      ),
    );

    expect(response.status).toBe(404);
    expect(await response.json()).toEqual({ error: "Podcast feed not found" });
    expectPrivateFeedHeaders(response);
    expect(fetchQuery).not.toHaveBeenCalled();
    expect(getOrCreatePodcastShowArtworkUrl).not.toHaveBeenCalled();
  });

  it("does not trim whitespace around a bearer token", async () => {
    const { GET } = await import("./route");
    const response = await GET(
      new NextRequest(
        `https://curiogarden.org/api/podcast/personal.xml?token=%20${VALID_FEED_TOKEN}%20`,
      ),
    );

    expect(response.status).toBe(404);
    expect(await response.json()).toEqual({ error: "Podcast feed not found" });
    expectPrivateFeedHeaders(response);
    expect(fetchQuery).not.toHaveBeenCalled();
    expect(getOrCreatePodcastShowArtworkUrl).not.toHaveBeenCalled();
  });

  it("does not render artwork for a well-shaped token that has no feed", async () => {
    fetchQuery.mockResolvedValue(null);

    const { GET } = await import("./route");
    const response = await GET(
      new NextRequest(
        `https://curiogarden.org/api/podcast/personal.xml?token=${VALID_FEED_TOKEN}`,
      ),
    );

    expect(response.status).toBe(404);
    expect(await response.json()).toEqual({ error: "Podcast feed not found" });
    expectPrivateFeedHeaders(response);
    expect(fetchQuery).toHaveBeenCalledTimes(1);
    expect(getOrCreatePodcastShowArtworkUrl).not.toHaveBeenCalled();
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
      new NextRequest(
        `https://curiogarden.org/api/podcast/personal.xml?token=${VALID_FEED_TOKEN}`,
      ),
    );
    const xml = await response.text();

    expect(response.status).toBe(200);
    expectPrivateFeedHeaders(response);
    expect(xml).toContain("<itunes:block>yes</itunes:block>");
    expect(xml).toContain(
      "<url>https://cdn.example.com/personal-show.png</url>",
    );
    expect(xml).toContain(
      `url="https://curiogarden.org/api/podcast/media/personal/episode-1?token=${VALID_FEED_TOKEN}"`,
    );
    expect(xml).toContain(
      '<guid isPermaLink="false">urn:curio-garden:personal:episode-1</guid>',
    );
    expect(
      xml.match(/<guid isPermaLink="false">[^<]+<\/guid>/g)?.join("\n"),
    ).not.toContain(VALID_FEED_TOKEN);
    expect(xml.indexOf("<title>Mars</title>")).toBeLessThan(
      xml.indexOf("<title>Venus</title>"),
    );
    expect(xml).toContain(
      '<itunes:image href="https://images.example.com/mars.jpg" />',
    );
  });

  it("keeps episode GUIDs stable when the private feed token rotates", async () => {
    fetchQuery.mockResolvedValue({
      feed: { updatedAt: Date.UTC(2026, 2, 16, 18, 0, 0) },
      episodes: [
        {
          _id: "episode-1",
          slug: "mars",
          title: "Mars",
          description: "First in queue.",
          wikiPageId: "698",
          publishedAt: Date.UTC(2026, 2, 16, 18, 0, 0),
          updatedAt: Date.UTC(2026, 2, 16, 18, 1, 0),
          durationSeconds: 120,
          byteLength: 12345,
        },
      ],
    });

    const { GET } = await import("./route");
    const firstResponse = await GET(
      new NextRequest(
        `https://curiogarden.org/api/podcast/personal.xml?token=${VALID_FEED_TOKEN}`,
      ),
    );
    const rotatedResponse = await GET(
      new NextRequest(
        `https://curiogarden.org/api/podcast/personal.xml?token=${ROTATED_FEED_TOKEN}`,
      ),
    );
    const guidPattern = /<guid isPermaLink="false">([^<]+)<\/guid>/;
    const firstGuid = (await firstResponse.text()).match(guidPattern)?.[1];
    const rotatedGuid = (await rotatedResponse.text()).match(guidPattern)?.[1];

    expect(firstResponse.status).toBe(200);
    expect(rotatedResponse.status).toBe(200);
    expect(firstGuid).toBe("urn:curio-garden:personal:episode-1");
    expect(rotatedGuid).toBe(firstGuid);
    expect(firstGuid).not.toContain(VALID_FEED_TOKEN);
    expect(rotatedGuid).not.toContain(ROTATED_FEED_TOKEN);
  });

  it("does not expose backend error details", async () => {
    fetchQuery.mockRejectedValue(
      new Error("Convex deployment and internal table details"),
    );

    const { GET } = await import("./route");
    const response = await GET(
      new NextRequest(
        `https://curiogarden.org/api/podcast/personal.xml?token=${VALID_FEED_TOKEN}`,
      ),
    );
    const body = await response.text();

    expect(response.status).toBe(500);
    expect(body).toContain("Personal podcast feed is unavailable");
    expect(body).not.toContain("Convex deployment");
    expectPrivateFeedHeaders(response);
  });
});
