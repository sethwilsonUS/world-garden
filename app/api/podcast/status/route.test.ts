import { NextRequest } from "next/server";
import { beforeEach, describe, expect, it, vi } from "vitest";

const fetchQuery = vi.fn();
const fetchCurrentFeaturedArticle = vi.fn();
const getCurrentTrendingBriefSource = vi.fn();
const isTrendingBriefEnabled = vi.fn();
const getPodcastAdminAuthError = vi.fn();

vi.mock("convex/nextjs", () => ({
  fetchQuery,
}));

vi.mock("@/lib/featured-article", () => ({
  fetchCurrentFeaturedArticle,
}));

vi.mock("@/lib/trending-brief", () => ({
  getCurrentTrendingBriefSource,
  isTrendingBriefEnabled,
}));

vi.mock("@/lib/podcast-admin-auth", () => ({
  getPodcastAdminAuthError,
}));

describe("GET /api/podcast/status", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    getPodcastAdminAuthError.mockReturnValue(null);
    isTrendingBriefEnabled.mockReturnValue(true);
  });

  it("reports ready featured and trending publications that match upstream", async () => {
    fetchCurrentFeaturedArticle.mockResolvedValue({
      feedDateIso: "2026-03-11",
      tfa: {
        title: "Example Article",
        wikiPageId: "123",
      },
    });
    getCurrentTrendingBriefSource.mockResolvedValue({
      trendingDateIso: "2026-03-10",
      articles: [{ title: "One" }, { title: "Two" }],
    });
    fetchQuery
      .mockResolvedValueOnce({
        featuredDate: "2026-03-11",
        title: "Example Article",
        wikiPageId: "123",
        status: "ready",
        publishedAt: 1,
        updatedAt: 2,
      })
      .mockResolvedValueOnce({
        status: "ready",
        attempts: 2,
        updatedAt: 3,
        lastError: undefined,
      })
      .mockResolvedValueOnce({
        trendingDate: "2026-03-10",
        headline: "Daily brief",
        articleTitles: ["One", "Two"],
        status: "ready",
        updatedAt: 4,
        lastError: undefined,
      })
      .mockResolvedValueOnce({
        status: "ready",
        attempts: 1,
        updatedAt: 5,
        lastError: undefined,
      });

    const { GET } = await import("./route");
    const response = await GET(
      new NextRequest("https://curiogarden.org/api/podcast/status", {
        headers: { authorization: "Bearer test-secret" },
      }),
    );
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body.featured.matchesSource).toBe(true);
    expect(body.trending.matchesSource).toBe(true);
    expect(body.trending.stored.title).toBe("Daily brief");
  });

  it("reports mismatched and failed stored publications", async () => {
    fetchCurrentFeaturedArticle.mockResolvedValue({
      feedDateIso: "2026-03-11",
      tfa: {
        title: "New Article",
        wikiPageId: "999",
      },
    });
    getCurrentTrendingBriefSource.mockResolvedValue({
      trendingDateIso: "2026-03-10",
      articles: [{ title: "One" }, { title: "Two" }],
    });
    fetchQuery
      .mockResolvedValueOnce({
        featuredDate: "2026-03-11",
        title: "Old Article",
        wikiPageId: "123",
        status: "ready",
        publishedAt: 1,
        updatedAt: 2,
      })
      .mockResolvedValueOnce({
        status: "failed",
        attempts: 4,
        updatedAt: 3,
        lastError: "TTS failed",
      })
      .mockResolvedValueOnce({
        trendingDate: "2026-03-10",
        headline: "Yesterday's brief",
        articleTitles: ["Different topic"],
        status: "failed",
        updatedAt: 4,
        lastError: "Model timeout",
      })
      .mockResolvedValueOnce({
        status: "failed",
        attempts: 2,
        updatedAt: 5,
        lastError: "Model timeout",
      });

    const { GET } = await import("./route");
    const response = await GET(
      new NextRequest("https://curiogarden.org/api/podcast/status", {
        headers: { authorization: "Bearer test-secret" },
      }),
    );
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body.featured.matchesSource).toBe(false);
    expect(body.featured.job.lastError).toBe("TTS failed");
    expect(body.trending.matchesSource).toBe(false);
    expect(body.trending.stored.status).toBe("failed");
    expect(body.trending.job.lastError).toBe("Model timeout");
  });

  it("reports pending trending publication separately from missing content", async () => {
    fetchCurrentFeaturedArticle.mockResolvedValue({
      feedDateIso: "2026-03-11",
      tfa: null,
    });
    getCurrentTrendingBriefSource.mockResolvedValue({
      trendingDateIso: "2026-03-10",
      articles: [{ title: "One" }, { title: "Two" }],
    });
    fetchQuery
      .mockResolvedValueOnce(null)
      .mockResolvedValueOnce(null)
      .mockResolvedValueOnce({
        trendingDate: "2026-03-10",
        articleTitles: ["One", "Two"],
        status: "pending",
        updatedAt: 4,
        lastError: undefined,
      })
      .mockResolvedValueOnce({
        status: "running",
        attempts: 1,
        updatedAt: 5,
        lastError: undefined,
      });

    const { GET } = await import("./route");
    const response = await GET(
      new NextRequest("https://curiogarden.org/api/podcast/status", {
        headers: { authorization: "Bearer test-secret" },
      }),
    );
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body.featured.stored).toBeNull();
    expect(body.trending.stored.status).toBe("pending");
    expect(body.trending.job.status).toBe("running");
  });
});
