import { NextRequest } from "next/server";
import { beforeEach, describe, expect, it, vi } from "vitest";

const fetchQuery = vi.fn();

vi.mock("convex/nextjs", () => ({
  fetchQuery,
}));

describe("GET /api/podcast/media/personal/[episodeId]", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("returns 404 when the token does not match an accessible episode", async () => {
    fetchQuery.mockResolvedValue(null);

    const { GET } = await import("./route");
    const response = await GET(
      new NextRequest(
        "https://curiogarden.org/api/podcast/media/personal/episode-1?token=bad-token",
      ),
      { params: Promise.resolve({ episodeId: "episode-1" }) },
    );

    expect(response.status).toBe(404);
  });

  it("redirects to the stored audio for ready episodes", async () => {
    fetchQuery.mockResolvedValue({
      _id: "episode-1",
      title: "Mars",
      status: "ready",
      audioUrl: "https://cdn.example.com/mars.mp3",
    });

    const { GET } = await import("./route");
    const response = await GET(
      new NextRequest(
        "https://curiogarden.org/api/podcast/media/personal/episode-1?token=opaque-token",
      ),
      { params: Promise.resolve({ episodeId: "episode-1" }) },
    );

    expect(response.status).toBe(307);
    expect(response.headers.get("location")).toBe(
      "https://cdn.example.com/mars.mp3",
    );
  });
});
