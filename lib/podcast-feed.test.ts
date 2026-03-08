import { describe, expect, it } from "vitest";
import { getPodcastDescription, getPodcastSiteUrl } from "./podcast-feed";

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
