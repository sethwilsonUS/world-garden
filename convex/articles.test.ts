import { describe, expect, it } from "vitest";
import {
  ARTICLE_CACHE_TTL_MS,
  cachedArticleToFetchResult,
  isCachedArticleFresh,
} from "./articles";

describe("isCachedArticleFresh", () => {
  it("treats articles inside the cache TTL as fresh", () => {
    const now = Date.UTC(2026, 3, 28);

    expect(
      isCachedArticleFresh(
        { lastFetchedAt: now - ARTICLE_CACHE_TTL_MS + 1 },
        now,
      ),
    ).toBe(true);
    expect(
      isCachedArticleFresh({ lastFetchedAt: now - ARTICLE_CACHE_TTL_MS }, now),
    ).toBe(false);
  });
});

describe("cachedArticleToFetchResult", () => {
  it("returns a fetch-compatible article from cached rows", () => {
    const result = cachedArticleToFetchResult({
      _id: "article-1" as never,
      wikiPageId: "123",
      title: "Example article",
      slug: "Example_article",
      language: "en",
      revisionId: "456",
      lastFetchedAt: Date.UTC(2026, 3, 28, 12),
      summary: "Lead summary with enough useful context.",
      thumbnailUrl: "https://example.com/thumb.jpg",
      thumbnailWidth: 800,
      thumbnailHeight: 600,
      badgeKeys: ["history"],
      sections: [
        {
          title: "History",
          level: 2,
          content:
            "The first sentence establishes the section. The second sentence makes it suitable for audio.",
        },
      ],
    });

    expect(result).toMatchObject({
      _id: "article-1",
      wikiPageId: "123",
      title: "Example article",
      language: "en",
      revisionId: "456",
      lastEdited: "2026-04-28T12:00:00.000Z",
      summary: "Lead summary with enough useful context.",
      thumbnailUrl: "https://example.com/thumb.jpg",
      thumbnailWidth: 800,
      thumbnailHeight: 600,
      badgeKeys: ["history"],
    });
    expect(result.contentText).toContain("Lead summary");
    expect(result.sections).toEqual([
      {
        title: "History",
        level: 2,
        content:
          "The first sentence establishes the section. The second sentence makes it suitable for audio.",
        audioMode: "full",
        audioReason: "eligible",
      },
    ]);
  });
});
