import { afterEach, describe, expect, it } from "vitest";
import sitemap from "./sitemap";

const originalSiteUrl = process.env.NEXT_PUBLIC_SITE_URL;

afterEach(() => {
  if (originalSiteUrl === undefined) {
    delete process.env.NEXT_PUBLIC_SITE_URL;
  } else {
    process.env.NEXT_PUBLIC_SITE_URL = originalSiteUrl;
  }
});

describe("sitemap", () => {
  it("lists only canonical public pages intended for search", () => {
    process.env.NEXT_PUBLIC_SITE_URL = "https://curiogarden.org/";

    expect(sitemap()).toEqual(
      [
        "/",
        "/on-this-day",
        "/trending",
        "/podcasts",
        "/podcasts/featured",
        "/podcasts/trending",
        "/about",
        "/feedback",
        "/privacy",
        "/terms",
      ].map((path) => ({
        url: `https://curiogarden.org${path === "/" ? "" : path}`,
      })),
    );
  });

  it("excludes utility and legacy redirect URLs", () => {
    const paths = sitemap().map((entry) => new URL(entry.url).pathname);

    expect(paths).not.toContain("/library");
    expect(paths).not.toContain("/search");
    expect(paths).not.toContain("/dashboard");
    expect(paths).not.toContain("/podcast");
    expect(paths).not.toContain("/did-you-know");
  });
});
