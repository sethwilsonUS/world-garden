import { describe, expect, it, vi, beforeEach } from "vitest";

const getDailyTrendingBriefState = vi.fn();

vi.mock("@/lib/trending-brief", () => ({
  getDailyTrendingBriefState,
}));

describe("GET /api/trending/brief", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("returns a ready brief without invoking generation logic", async () => {
    getDailyTrendingBriefState.mockResolvedValue({
      enabled: true,
      status: "ready",
      trendingDate: "2026-03-11",
      articleTitles: ["One", "Two"],
      brief: {
        headline: "Daily brief",
        audioUrl: "https://cdn.example.com/brief.mp3",
      },
    });

    const { GET } = await import("./route");
    const response = await GET(new Request("https://curiogarden.org/api/trending/brief"));

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual({
      enabled: true,
      status: "ready",
      trendingDate: "2026-03-11",
      articleTitles: ["One", "Two"],
      brief: {
        headline: "Daily brief",
        audioUrl: "https://cdn.example.com/brief.mp3",
      },
    });
    expect(getDailyTrendingBriefState).toHaveBeenCalledTimes(1);
  });

  it("returns a pending state when today has not been published yet", async () => {
    getDailyTrendingBriefState.mockResolvedValue({
      enabled: true,
      status: "pending",
      trendingDate: "2026-03-11",
      articleTitles: ["One", "Two"],
      brief: null,
      lastError: "Still generating",
    });

    const { GET } = await import("./route");
    const response = await GET(new Request("https://curiogarden.org/api/trending/brief"));

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual({
      enabled: true,
      status: "pending",
      trendingDate: "2026-03-11",
      articleTitles: ["One", "Two"],
      brief: null,
      lastError: "Still generating",
    });
  });
});
