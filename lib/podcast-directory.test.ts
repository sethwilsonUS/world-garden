import { describe, expect, it } from "vitest";
import {
  PODCAST_DIRECTORY,
  formatPodcastDate,
  formatTrendingDate,
  getAbsoluteFeedUrl,
  getPodcastDirectoryEntry,
  getFeaturedEpisodeArtworkUrl,
  getTrendingEpisodeTitle,
  getTrendingEpisodeArtworkUrl,
} from "./podcast-directory";

describe("getPodcastDirectoryEntry", () => {
  it("returns the featured feed entry", () => {
    expect(getPodcastDirectoryEntry("featured")?.feedPath).toBe(
      "/api/podcast/featured.xml",
    );
  });

  it("returns null for unknown slugs", () => {
    expect(getPodcastDirectoryEntry("unknown")).toBeNull();
  });
});

describe("PODCAST_DIRECTORY", () => {
  it("contains both public podcast feeds", () => {
    expect(PODCAST_DIRECTORY.map((entry) => entry.slug)).toEqual([
      "featured",
      "trending",
    ]);
  });
});

describe("getAbsoluteFeedUrl", () => {
  it("builds an absolute feed URL from a path and origin", () => {
    expect(
      getAbsoluteFeedUrl("/api/podcast/trending.xml", "https://curiogarden.org/"),
    ).toBe("https://curiogarden.org/api/podcast/trending.xml");
  });
});

describe("formatPodcastDate", () => {
  it("formats published timestamps in US English", () => {
    expect(formatPodcastDate(Date.UTC(2026, 2, 8, 18, 16, 46))).toBe(
      "March 8, 2026",
    );
  });
});

describe("formatTrendingDate", () => {
  it("formats trending ISO dates in UTC", () => {
    expect(formatTrendingDate("2026-03-07")).toBe("March 7, 2026");
  });
});

describe("getTrendingEpisodeTitle", () => {
  it("prefers the saved headline when present", () => {
    expect(
      getTrendingEpisodeTitle({
        headline: "Top trends today",
        trendingDate: "2026-03-07",
      } as Parameters<typeof getTrendingEpisodeTitle>[0]),
    ).toBe("Top trends today");
  });

  it("falls back to the date-based title", () => {
    expect(
      getTrendingEpisodeTitle({
        trendingDate: "2026-03-07",
      } as Parameters<typeof getTrendingEpisodeTitle>[0]),
    ).toBe("Wikipedia Trending Brief: March 7, 2026");
  });
});

describe("episode artwork urls", () => {
  it("returns the featured episode image when present", () => {
    expect(
      getFeaturedEpisodeArtworkUrl({
        imageUrl: "https://upload.wikimedia.org/example.jpg",
      } as Parameters<typeof getFeaturedEpisodeArtworkUrl>[0]),
    ).toBe("https://upload.wikimedia.org/example.jpg");
  });

  it("prefers the stored featured artwork url when present", () => {
    expect(
      getFeaturedEpisodeArtworkUrl({
        imageUrl: "https://upload.wikimedia.org/example.jpg",
        artworkUrl: "https://cdn.example.com/featured.png",
      } as Parameters<typeof getFeaturedEpisodeArtworkUrl>[0]),
    ).toBe("https://cdn.example.com/featured.png");
  });

  it("falls back to the first imageUrl when artworkUrl is missing", () => {
    expect(
      getTrendingEpisodeArtworkUrl({
        _id: "brief123",
        imageUrls: ["https://upload.wikimedia.org/thumb1.jpg"],
      } as Parameters<typeof getTrendingEpisodeArtworkUrl>[0]),
    ).toBe("https://upload.wikimedia.org/thumb1.jpg");
  });

  it("returns null when no artwork or images are available", () => {
    expect(
      getTrendingEpisodeArtworkUrl({
        _id: "brief123",
      } as Parameters<typeof getTrendingEpisodeArtworkUrl>[0]),
    ).toBeNull();
  });

  it("prefers the stored trending artwork url when present", () => {
    expect(
      getTrendingEpisodeArtworkUrl({
        _id: "brief123",
        artworkUrl: "https://cdn.example.com/trending.png",
      } as Parameters<typeof getTrendingEpisodeArtworkUrl>[0]),
    ).toBe("https://cdn.example.com/trending.png");
  });
});
