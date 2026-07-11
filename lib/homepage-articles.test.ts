import { describe, expect, it } from "vitest";
import {
  collectHomepageArticleRefs,
  HOMEPAGE_PREVIEW_LIMITS,
} from "./homepage-articles";
import type { TodayWikipediaData } from "./today-snapshot";

const link = (title: string, wikiPageId?: string) => ({
  title,
  slug: title.replace(/ /g, "_"),
  text: title,
  ...(wikiPageId ? { wikiPageId } : {}),
});

const snapshot = (overrides: Partial<TodayWikipediaData> = {}): TodayWikipediaData => ({
  tfa: null,
  trending: [],
  didYouKnow: [],
  inTheNews: [],
  pictureOfDay: null,
  onThisDay: [],
  trendingDate: null,
  trendingSource: null,
  trendingSourceType: null,
  trendingIsStale: false,
  feedDate: "2026-07-10",
  snapshotFeedDate: "2026-07-10",
  snapshotGeneratedAt: 1,
  snapshotIsStale: false,
  ...overrides,
});

describe("collectHomepageArticleRefs", () => {
  it("matches homepage limits and prioritizes initially visible content", () => {
    const data = snapshot({
      tfa: {
        title: "Featured",
        extract: "",
        featuredDate: null,
        wikiPageId: "1",
      },
      didYouKnow: Array.from({ length: 4 }, (_, index) => ({
        text: `Fact ${index}`,
        segments: [],
        links: Array.from({ length: 4 }, (__, linkIndex) =>
          link(`DYK ${index}-${linkIndex}`),
        ),
      })),
      inTheNews: Array.from({ length: 3 }, (_, index) => ({
        story: `News ${index}`,
        links: Array.from({ length: 4 }, (__, linkIndex) =>
          link(`News ${index}-${linkIndex}`),
        ),
      })),
      onThisDay: [
        { text: "Event", pages: [link("On day 0"), link("On day 1"), link("On day 2"), link("Hidden day")] },
        { text: "Not rendered", pages: [link("Second event")] },
      ],
      trending: Array.from({ length: 6 }, (_, index) => ({
        title: `Trending ${index}`,
        extract: "",
        views: 10,
      })),
    });

    const result = collectHomepageArticleRefs(data);
    const titles = result.articles.map((article) => article.title);

    expect(titles[0]).toBe("Featured");
    expect(titles).toContain("DYK 2-2");
    expect(titles).toContain("News 1-2");
    expect(titles).toContain("On day 2");
    expect(titles).toContain("Trending 3");
    expect(titles).not.toContain("DYK 0-3");
    expect(titles).not.toContain("Hidden day");
    expect(titles).not.toContain("Trending 4");
    expect(titles.indexOf("Trending 3")).toBeLessThan(titles.indexOf("DYK 3-0"));
    expect(titles.indexOf("Trending 3")).toBeLessThan(titles.indexOf("News 2-0"));
  });

  it("deduplicates by page id or normalized slug", () => {
    const result = collectHomepageArticleRefs(
      snapshot({
        didYouKnow: [
          {
            text: "Fact",
            segments: [],
            links: [link("Same Article", "42"), link("Same Article")],
          },
        ],
        inTheNews: [
          { story: "Story", links: [link("Different slug", "42")] },
        ],
      }),
    );

    expect(result.articles).toHaveLength(1);
    expect(result.articles[0].wikiPageId).toBe("42");
  });

  it("caps the warm set at 30 and reports omitted articles", () => {
    const data = snapshot({
      didYouKnow: Array.from({ length: 12 }, (_, index) => ({
        text: `Fact ${index}`,
        segments: [],
        links: [link(`A ${index}`), link(`B ${index}`), link(`C ${index}`)],
      })),
    });

    const result = collectHomepageArticleRefs(data, 100);
    expect(result.articles).toHaveLength(HOMEPAGE_PREVIEW_LIMITS.warmedArticles);
    expect(result.capped).toBe(6);
  });
});
