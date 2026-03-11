import { describe, expect, it } from "vitest";
import {
  FEATURED_SHOW_ARTWORK_VERSION,
  TRENDING_SHOW_ARTWORK_VERSION,
  getFeaturedPodcastEpisodeArtworkUrl,
  getFeaturedPodcastItemArtworkUrl,
  getPodcastArtworkUrl,
  getPodcastDescription,
  getPodcastExcerpt,
  getPodcastSiteUrl,
  getTrendingPodcastEpisodeArtworkUrl,
  getTrendingPodcastItemArtworkUrl,
  getTrendingPodcastShowArtworkUrl,
} from "./podcast-feed";

describe("getPodcastDescription", () => {
  it("returns only the first paragraph", () => {
    expect(
      getPodcastDescription("First paragraph.\n\nSecond paragraph.\n\nThird."),
    ).toBe("First paragraph.");
  });

  it("trims single-paragraph text", () => {
    expect(getPodcastDescription("  One paragraph only.  ")).toBe(
      "One paragraph only.",
    );
  });

  it("returns an empty string for empty input", () => {
    expect(getPodcastDescription("")).toBe("");
    expect(getPodcastDescription(null)).toBe("");
  });
});

describe("getPodcastExcerpt", () => {
  it("returns the first sentence when the paragraph is long", () => {
    expect(
      getPodcastExcerpt(
        "First sentence is compact. Second sentence keeps going with extra detail that should not be needed in a short podcast description.",
        80,
      ),
    ).toBe("First sentence is compact.");
  });

  it("truncates long text without a short first sentence", () => {
    const excerpt = getPodcastExcerpt(
      "This is a very long sentence without an early stop that keeps going and going until it needs to be clipped for display in a compact UI.",
      70,
    );

    expect(excerpt.endsWith("…")).toBe(true);
    expect(excerpt.length).toBeLessThanOrEqual(70);
  });
});

describe("getPodcastSiteUrl", () => {
  it("prefers NEXT_PUBLIC_SITE_URL when present", () => {
    process.env.NEXT_PUBLIC_SITE_URL = "https://curiogarden.org/";

    expect(getPodcastSiteUrl("http://localhost:3000")).toBe(
      "https://curiogarden.org",
    );

    delete process.env.NEXT_PUBLIC_SITE_URL;
  });

  it("falls back to the provided origin and trims trailing slashes", () => {
    expect(getPodcastSiteUrl("http://localhost:3000/")).toBe(
      "http://localhost:3000",
    );
  });
});

describe("getPodcastArtworkUrl", () => {
  it("builds a stable absolute artwork URL", () => {
    expect(getPodcastArtworkUrl("https://curiogarden.org/")).toBe(
      `https://curiogarden.org/api/podcast/artwork?v=${FEATURED_SHOW_ARTWORK_VERSION}`,
    );
  });
});

describe("getFeaturedPodcastEpisodeArtworkUrl", () => {
  it("builds an episode-specific featured artwork URL", () => {
    expect(
      getFeaturedPodcastEpisodeArtworkUrl(
        "https://curiogarden.org/",
        "episode123",
      ),
    ).toBe("https://curiogarden.org/api/podcast/artwork/episode123");
  });
});

describe("getFeaturedPodcastItemArtworkUrl", () => {
  it("prefers the stable episode artwork route when an episode id exists", () => {
    expect(
      getFeaturedPodcastItemArtworkUrl(
        {
          artworkUrl: "https://cdn.example.com/featured.png",
          imageUrl: "https://images.example.com/article.png",
          episodeId: "episode123",
        },
        "https://curiogarden.org/",
      ),
    ).toBe("https://curiogarden.org/api/podcast/artwork/episode123");
  });

  it("falls back to the stored artwork url when no episode id exists", () => {
    expect(
      getFeaturedPodcastItemArtworkUrl(
        {
          artworkUrl: "https://cdn.example.com/featured.png",
          imageUrl: "https://images.example.com/article.png",
        },
        "https://curiogarden.org/",
      ),
    ).toBe("https://cdn.example.com/featured.png");
  });
});

describe("getTrendingPodcastShowArtworkUrl", () => {
  it("builds the trending show artwork URL", () => {
    expect(getTrendingPodcastShowArtworkUrl("https://curiogarden.org/")).toBe(
      `https://curiogarden.org/api/podcast/trending/artwork?v=${TRENDING_SHOW_ARTWORK_VERSION}`,
    );
  });
});

describe("getTrendingPodcastEpisodeArtworkUrl", () => {
  it("builds an episode-specific trending artwork URL", () => {
    expect(
      getTrendingPodcastEpisodeArtworkUrl("https://curiogarden.org/", "brief123"),
    ).toBe(
      "https://curiogarden.org/api/podcast/trending/artwork/brief123",
    );
  });
});

describe("getTrendingPodcastItemArtworkUrl", () => {
  it("prefers the stable episode artwork route when a brief id exists", () => {
    expect(
      getTrendingPodcastItemArtworkUrl(
        {
          artworkItems: [{ title: "Lead", imageUrl: "https://images.example.com/lead.png" }],
          artworkUrl: "https://cdn.example.com/brief.png",
          imageUrls: ["https://images.example.com/first.png"],
          briefId: "brief123",
        },
        "https://curiogarden.org/",
      ),
    ).toBe("https://curiogarden.org/api/podcast/trending/artwork/brief123");
  });

  it("falls back to the first episode image when no brief id exists", () => {
    expect(
      getTrendingPodcastItemArtworkUrl(
        {
          artworkItems: [{ title: "Lead", imageUrl: "https://images.example.com/lead.png" }],
        },
        "https://curiogarden.org/",
      ),
    ).toBe("https://images.example.com/lead.png");
  });

  it("falls back to legacy image urls when artwork items are missing", () => {
    expect(
      getTrendingPodcastItemArtworkUrl(
        {
          imageUrls: ["", "https://images.example.com/first.png"],
        },
        "https://curiogarden.org/",
      ),
    ).toBe("https://images.example.com/first.png");
  });

  it("falls back to the stable episode artwork route when no images exist", () => {
    expect(
      getTrendingPodcastItemArtworkUrl(
        {
          briefId: "brief123",
        },
        "https://curiogarden.org/",
      ),
    ).toBe("https://curiogarden.org/api/podcast/trending/artwork/brief123");
  });
});
