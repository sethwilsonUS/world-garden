import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { PodcastFeedPanel } from "./PodcastFeedPanel";

describe("PodcastFeedPanel", () => {
  it("shows reader subscription controls without developer sync instructions", () => {
    const markup = renderToStaticMarkup(
      createElement(PodcastFeedPanel, {
        title: "Curio Garden Featured Article",
        feedUrl: "https://curiogarden.org/api/podcast/featured.xml",
      }),
    );

    expect(markup).toContain("Apple Podcasts");
    expect(markup).toContain("/api/podcast/featured.xml");
    expect(markup).not.toContain("local testing");
    expect(markup).not.toContain("/sync");
    expect(markup).not.toContain("authorized");
  });

  it("puts subscription first with a wrapping, non-scrolling feed URL", () => {
    const markup = renderToStaticMarkup(
      createElement(PodcastFeedPanel, {
        title: "Curio Garden Featured Article",
        feedUrl: "https://curiogarden.org/api/podcast/featured.xml",
      }),
    );

    expect(markup).toContain(">Subscribe</h3>");
    expect(markup).not.toContain("overflow-x-auto");
    expect(markup).toContain("break-all");
    expect(markup).toContain(
      'aria-label="Copy feed URL for Curio Garden Featured Article"',
    );
    expect(markup).toContain("<span>Copy feed URL</span>");
  });
});
