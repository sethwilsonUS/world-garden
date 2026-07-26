import { describe, expect, it } from "vitest";
import {
  ARTICLE_PARSE_MEDIA_CACHE_VERSION,
  ARTICLE_CACHE_TTL_MS,
  canPersistNormalizedCachedNarration,
  cachedArticleToFetchResult,
  hasCompleteArticleParseSectionIdentity,
  isArticleParseMediaCacheCompatible,
  isCachedArticleFresh,
  isCachedArticleNarrationCompatible,
  normalizeCachedArticleForPersistence,
} from "./articles";
import {
  ARTICLE_SECTION_NARRATION_VERSION,
  hashNarrationText,
} from "../lib/section-narration";

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

describe("isCachedArticleNarrationCompatible", () => {
  it("refreshes legacy and older narration versions inside the normal TTL", () => {
    expect(isCachedArticleNarrationCompatible({})).toBe(false);
    expect(isCachedArticleNarrationCompatible({ narrationVersion: 0 })).toBe(
      false,
    );
    expect(
      isCachedArticleNarrationCompatible({
        narrationVersion: ARTICLE_SECTION_NARRATION_VERSION,
        sections: [],
      }),
    ).toBe(true);
    expect(
      isCachedArticleNarrationCompatible({
        narrationVersion: ARTICLE_SECTION_NARRATION_VERSION,
        sections: [{ title: "Legacy", level: 2, content: "Source text." }],
      }),
    ).toBe(false);
    const narrationText = "History. Source text.";
    expect(
      isCachedArticleNarrationCompatible({
        narrationVersion: ARTICLE_SECTION_NARRATION_VERSION,
        sections: [
          {
            wikiSectionIndex: "1",
            title: "History",
            level: 2,
            content: "Source text.",
            narration: {
              mode: "verbatim",
              text: narrationText,
              sourceFormat: "prose",
              adapted: false,
              usedRawFallback: true,
              sourceHash: hashNarrationText(narrationText),
            },
          },
        ],
      }),
    ).toBe(true);
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
        wikiSectionIndex: "1",
        title: "History",
        level: 2,
        content:
          "The first sentence establishes the section. The second sentence makes it suitable for audio.",
        narration: expect.objectContaining({
          mode: "verbatim",
          usedRawFallback: true,
          text: "History. The first sentence establishes the section. The second sentence makes it suitable for audio.",
        }),
      },
    ]);
  });

  it("rebuilds stale narration as complete plaintext instead of reviving old omissions", () => {
    const result = cachedArticleToFetchResult({
      _id: "article-stale" as never,
      wikiPageId: "123",
      title: "Example article",
      language: "en",
      revisionId: "456",
      narrationVersion: ARTICLE_SECTION_NARRATION_VERSION - 1,
      lastFetchedAt: Date.UTC(2026, 3, 28, 12),
      sections: [
        {
          wikiSectionIndex: "7",
          title: "Artistic recognition",
          level: 2,
          content:
            "A seventeen-word source sentence remains independently playable.",
          narration: {
            mode: "none",
            text: "",
            sourceFormat: "heading",
            adapted: false,
            usedRawFallback: false,
            sourceHash: "obsolete",
          },
        },
      ],
    });

    expect(result.narrationVersion).toBe(ARTICLE_SECTION_NARRATION_VERSION);
    expect(result.sections[0].narration).toMatchObject({
      mode: "verbatim",
      usedRawFallback: true,
      text: "Artistic recognition. A seventeen-word source sentence remains independently playable.",
    });
    expect(result.sections[0].narration.sourceHash).not.toBe("obsolete");
  });

  it("produces the exact narration patch workers will read after a failed refresh", () => {
    const article = {
      _id: "article-stale" as never,
      wikiPageId: "123",
      title: "Example article",
      language: "en",
      revisionId: "456",
      narrationVersion: ARTICLE_SECTION_NARRATION_VERSION - 1,
      lastFetchedAt: Date.UTC(2026, 3, 28, 12),
      sections: [
        {
          title: "Tiny section",
          level: 2,
          content: "Still source text.",
        },
      ],
    };

    const { result, mutationArgs } =
      normalizeCachedArticleForPersistence(article);

    expect(mutationArgs).toEqual({
      articleId: "article-stale",
      expectedRevisionId: "456",
      expectedNarrationVersion: ARTICLE_SECTION_NARRATION_VERSION - 1,
      expectedLastFetchedAt: Date.UTC(2026, 3, 28, 12),
      narrationVersion: ARTICLE_SECTION_NARRATION_VERSION,
      sections: result.sections,
    });
    expect(mutationArgs.sections[0].narration).toMatchObject({
      mode: "verbatim",
      usedRawFallback: true,
      text: "Tiny section. Still source text.",
    });
  });
});

describe("canPersistNormalizedCachedNarration", () => {
  const expected = {
    expectedRevisionId: "456",
    expectedNarrationVersion: ARTICLE_SECTION_NARRATION_VERSION - 1,
    expectedLastFetchedAt: 100,
  };

  it("accepts only the exact stale row used to build the fallback", () => {
    expect(
      canPersistNormalizedCachedNarration(
        {
          revisionId: "456",
          narrationVersion: ARTICLE_SECTION_NARRATION_VERSION - 1,
          lastFetchedAt: 100,
        },
        expected,
      ),
    ).toBe(true);
  });

  it("does not overwrite a concurrent successful refresh of the same revision", () => {
    expect(
      canPersistNormalizedCachedNarration(
        {
          revisionId: "456",
          narrationVersion: ARTICLE_SECTION_NARRATION_VERSION,
          lastFetchedAt: 101,
        },
        expected,
      ),
    ).toBe(false);
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

describe("hasCompleteArticleParseSectionIdentity", () => {
  it("makes title-only parse cache rows a lazy miss while accepting indexed projections", () => {
    expect(
      hasCompleteArticleParseSectionIdentity({
        linkCounts: [{ title: "History", count: 2 }],
        sectionCitations: [
          { title: "History", count: 1, citationIds: ["cite-1"] },
        ],
      }),
    ).toBe(false);
    expect(
      hasCompleteArticleParseSectionIdentity({
        linkCounts: [{ index: "8", title: "History", count: 2 }],
        sectionCitations: [
          {
            index: "8",
            title: "History",
            count: 1,
            citationIds: ["cite-1"],
          },
        ],
      }),
    ).toBe(true);
  });

  it("accepts an empty metadata projection", () => {
    expect(
      hasCompleteArticleParseSectionIdentity({
        linkCounts: [],
        sectionCitations: [],
      }),
    ).toBe(true);
  });
});
