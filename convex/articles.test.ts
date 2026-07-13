import { describe, expect, it } from "vitest";
import {
  ARTICLE_PARSE_MEDIA_CACHE_VERSION,
  ARTICLE_CACHE_TTL_MS,
  cachedArticleToFetchResult,
  isArticleParseMediaCacheCompatible,
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

describe("isArticleParseMediaCacheCompatible", () => {
  const commonsImage = {
    src: "https://upload.wikimedia.org/wikipedia/commons/thumb/a/ab/Example.jpg/330px-Example.jpg",
    originalSrc:
      "https://upload.wikimedia.org/wikipedia/commons/a/ab/Example.jpg",
    attribution: { sourceTitle: "File:Example.jpg" },
  };

  it("invalidates a legacy Commons photo without lightbox metadata", () => {
    expect(isArticleParseMediaCacheCompatible([commonsImage])).toBe(false);
  });

  it("keeps legacy rows with complete lightbox metadata", () => {
    expect(
      isArticleParseMediaCacheCompatible([
        {
          ...commonsImage,
          lightboxSrc:
            "https://upload.wikimedia.org/wikipedia/commons/thumb/a/ab/Example.jpg/1600px-Example.jpg",
          lightboxWidth: 1600,
          lightboxHeight: 1067,
        },
      ]),
    ).toBe(true);
  });

  it("keeps empty and video-only legacy image collections", () => {
    expect(isArticleParseMediaCacheCompatible([])).toBe(true);
    expect(
      isArticleParseMediaCacheCompatible([
        {
          src: "https://upload.wikimedia.org/video-poster.jpg",
          videoSrc: "https://upload.wikimedia.org/example.webm",
        },
      ]),
    ).toBe(true);
  });

  it("refreshes every legacy photo once, including local and unqueryable media", () => {
    expect(
      isArticleParseMediaCacheCompatible([
        {
          src: "https://upload.wikimedia.org/wikipedia/en/thumb/8/80/Example.png/330px-Example.png",
        },
      ]),
    ).toBe(false);
    expect(
      isArticleParseMediaCacheCompatible([
        { src: "https://example.com/unqueryable-image.jpg" },
      ]),
    ).toBe(false);
  });

  it("accepts a current row when imageinfo legitimately returned no rendition", () => {
    expect(
      isArticleParseMediaCacheCompatible(
        [commonsImage],
        ARTICLE_PARSE_MEDIA_CACHE_VERSION,
      ),
    ).toBe(true);
  });

  it("rejects an explicitly stale media metadata version", () => {
    expect(
      isArticleParseMediaCacheCompatible(
        [
          {
            ...commonsImage,
            lightboxSrc:
              "https://upload.wikimedia.org/wikipedia/commons/thumb/a/ab/Example.jpg/1600px-Example.jpg",
            lightboxWidth: 1600,
            lightboxHeight: 1067,
          },
        ],
        ARTICLE_PARSE_MEDIA_CACHE_VERSION - 1,
      ),
    ).toBe(false);
  });

  it("retains the 800px invalidation even for versioned or enriched rows", () => {
    expect(
      isArticleParseMediaCacheCompatible(
        [
          {
            ...commonsImage,
            src: "https://upload.wikimedia.org/wikipedia/commons/thumb/a/ab/Example.jpg/800px-Example.jpg",
            lightboxSrc:
              "https://upload.wikimedia.org/wikipedia/commons/thumb/a/ab/Example.jpg/1600px-Example.jpg",
            lightboxWidth: 1600,
            lightboxHeight: 1067,
          },
        ],
        ARTICLE_PARSE_MEDIA_CACHE_VERSION,
      ),
    ).toBe(false);
  });

  it("continues to reject rows where images were never populated", () => {
    expect(isArticleParseMediaCacheCompatible(undefined)).toBe(false);
  });
});
