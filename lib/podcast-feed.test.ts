import { describe, expect, it } from "vitest";
import {
  getPodcastArtworkUrl,
  getPodcastDescription,
  getPodcastExcerpt,
  getPodcastSiteUrl,
  getTrendingPodcastArtworkUrl,
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
      "https://curiogarden.org/api/podcast/artwork",
    );
  });
});

describe("getTrendingPodcastArtworkUrl", () => {
  it("builds the latest trending artwork URL", () => {
    expect(getTrendingPodcastArtworkUrl("https://curiogarden.org/")).toBe(
      "https://curiogarden.org/api/podcast/trending/artwork",
    );
  });

  it("builds an episode-specific trending artwork URL", () => {
    expect(
      getTrendingPodcastArtworkUrl("https://curiogarden.org/", "brief123"),
    ).toBe(
      "https://curiogarden.org/api/podcast/trending/artwork/brief123",
    );
  });
});
