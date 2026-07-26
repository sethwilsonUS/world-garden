import { describe, expect, it, vi } from "vitest";
import {
  ARTICLE_PARSE_MEDIA_CACHE_VERSION,
  ARTICLE_CACHE_TTL_MS,
  canPersistNormalizedCachedNarration,
  cachedArticleToFetchResult,
  canonicalizeWikipediaRevisionIdentity,
  getArticleImagesForCtx,
  getParseCache,
  getWikipediaSectionLinksCacheKey,
  getSectionLinksForCtx,
  getSectionLinksFromCache,
  hasCompleteArticleParseSectionIdentity,
  isArticleParseMediaCacheCompatible,
  isCachedArticleFresh,
  isCachedArticleNarrationCompatible,
  isWikipediaRevisionCacheIdentityCompatible,
  normalizeCachedArticleForPersistence,
  normalizeWikipediaSectionIndex,
  persistCachedNarrationFallback,
} from "./articles";
import {
  ARTICLE_SECTION_NARRATION_VERSION,
  hashNarrationText,
} from "../lib/section-narration";

describe("Wikipedia revision cache identity", () => {
  const identity = {
    wikiPageId: "42",
    revisionId: "99",
    title: "Walter Savage Landor",
    language: "en",
  };

  it("canonicalizes numeric IDs, title spacing, and language at the action boundary", () => {
    expect(
      canonicalizeWikipediaRevisionIdentity({
        wikiPageId: "00042",
        revisionId: "00099",
        title: "  Walter__Savage Landor  ",
        language: " EN ",
      }),
    ).toEqual(identity);

    expect(() =>
      canonicalizeWikipediaRevisionIdentity({
        ...identity,
        wikiPageId: "42.0",
      }),
    ).toThrow("wikiPageId must be a positive numeric ID");
    expect(() =>
      canonicalizeWikipediaRevisionIdentity({
        ...identity,
        revisionId: "0",
      }),
    ).toThrow("revisionId must be a positive numeric ID");
  });

  it("uses the canonical identity for parse-cache reads from a public action", async () => {
    const cached = {
      ...identity,
      linkCounts: [],
      citations: [],
      sectionCitations: [],
      sectionIndexMap: [],
      images: [],
      mediaMetadataVersion: ARTICLE_PARSE_MEDIA_CACHE_VERSION,
      cachedAt: Date.now(),
    };
    const runQuery = vi.fn(async (...call: [unknown, unknown]) => {
      expect(call).toHaveLength(2);
      return cached;
    });
    const runMutation = vi.fn();
    await expect(
      getArticleImagesForCtx({ runQuery, runMutation } as never, {
        wikiPageId: "00042",
        revisionId: "00099",
        title: " Walter__Savage Landor ",
        language: "EN",
      }),
    ).resolves.toEqual([]);
    expect(runQuery.mock.calls[0]?.[1]).toEqual(identity);
    expect(runMutation).not.toHaveBeenCalled();
  });

  it("normalizes caller-supplied section indices before cache and source reads", async () => {
    const runQuery = vi.fn<
      (reference: unknown, args: unknown) => Promise<null>
    >(async () => null);
    const runMutation = vi.fn<
      (reference: unknown, args: unknown) => Promise<undefined>
    >(async () => undefined);
    const fetchSectionLinks = vi.fn(async () => [
      { wikiPageId: "7", title: "A linked article" },
    ]);

    await expect(
      getSectionLinksForCtx(
        { runQuery, runMutation } as never,
        {
          ...identity,
          sectionTitle: "Repeated heading",
          sectionIndex: " 0003 ",
        },
        { fetchSectionLinks },
      ),
    ).resolves.toEqual([{ wikiPageId: "7", title: "A linked article" }]);

    expect(runQuery.mock.calls[0]?.[1]).toMatchObject({
      ...identity,
      sectionTitle: '["index","3"]',
    });
    expect(fetchSectionLinks).toHaveBeenCalledWith(identity, "3");
    expect(runMutation.mock.calls[0]?.[1]).toMatchObject({
      ...identity,
      sectionTitle: '["index","3"]',
    });
  });

  it("preserves the summary section path when no explicit index is supplied", async () => {
    const runQuery = vi.fn<
      (reference: unknown, args: unknown) => Promise<null>
    >(async () => null);
    const runMutation = vi.fn<
      (reference: unknown, args: unknown) => Promise<undefined>
    >(async () => undefined);
    const fetchSectionLinks = vi.fn(async () => []);

    await getSectionLinksForCtx(
      { runQuery, runMutation } as never,
      { ...identity, sectionTitle: null },
      { fetchSectionLinks },
    );

    expect(runQuery.mock.calls[0]?.[1]).toMatchObject({
      sectionTitle: '["summary"]',
    });
    expect(fetchSectionLinks).toHaveBeenCalledWith(identity, "0");
  });

  it("rejects conflicting summary and explicit-index identities before cache access", async () => {
    const runQuery = vi.fn();
    const runMutation = vi.fn();
    const fetchSectionLinks = vi.fn();

    for (const sectionIndex of ["3", "not-an-index"]) {
      await expect(
        getSectionLinksForCtx(
          { runQuery, runMutation } as never,
          { ...identity, sectionTitle: null, sectionIndex },
          { fetchSectionLinks },
        ),
      ).rejects.toThrow("sectionIndex must be omitted for the summary");
    }
    expect(runQuery).not.toHaveBeenCalled();
    expect(fetchSectionLinks).not.toHaveBeenCalled();
    expect(runMutation).not.toHaveBeenCalled();
  });

  it("rejects malformed explicit section indices before cache access", async () => {
    const runQuery = vi.fn();
    const runMutation = vi.fn();
    const fetchSectionLinks = vi.fn();

    await expect(
      getSectionLinksForCtx(
        { runQuery, runMutation } as never,
        { ...identity, sectionTitle: "History", sectionIndex: " 3.5 " },
        { fetchSectionLinks },
      ),
    ).rejects.toThrow("sectionIndex must be a non-negative integer");
    expect(runQuery).not.toHaveBeenCalled();
    expect(fetchSectionLinks).not.toHaveBeenCalled();
    expect(runMutation).not.toHaveBeenCalled();
  });

  it("does not cache failed section-link fetches but caches successful empty results", async () => {
    const runQuery = vi.fn<
      (reference: unknown, args: unknown) => Promise<null>
    >(async () => null);
    const runMutation = vi.fn<
      (reference: unknown, args: unknown) => Promise<undefined>
    >(async () => undefined);
    const fetchSectionLinks = vi
      .fn()
      .mockRejectedValueOnce(new Error("temporary MediaWiki failure"))
      .mockResolvedValueOnce([]);
    const args = { ...identity, sectionTitle: "History", sectionIndex: "3" };

    await expect(
      getSectionLinksForCtx({ runQuery, runMutation } as never, args, {
        fetchSectionLinks,
      }),
    ).rejects.toThrow("temporary MediaWiki failure");
    expect(runMutation).not.toHaveBeenCalled();

    await expect(
      getSectionLinksForCtx({ runQuery, runMutation } as never, args, {
        fetchSectionLinks,
      }),
    ).resolves.toEqual([]);
    expect(fetchSectionLinks).toHaveBeenCalledTimes(2);
    expect(runMutation).toHaveBeenCalledOnce();
    expect(runMutation.mock.calls[0]?.[1]).toMatchObject({ links: [] });
  });

  it("normalizes bounded numeric and semantic section keys", () => {
    expect(normalizeWikipediaSectionIndex(undefined)).toBeUndefined();
    expect(normalizeWikipediaSectionIndex(" 0007 ")).toBe("7");
    expect(normalizeWikipediaSectionIndex("0")).toBe("0");
    expect(normalizeWikipediaSectionIndex(" mw-special:-1:0002:0001 ")).toBe(
      "mw-special:-1:2:1",
    );
    expect(normalizeWikipediaSectionIndex("mw-special:-2:3:4")).toBe(
      "mw-special:-2:3:4",
    );
    expect(() => normalizeWikipediaSectionIndex("")).toThrow();
    expect(() => normalizeWikipediaSectionIndex("-1")).toThrow();
    expect(() => normalizeWikipediaSectionIndex("1e2")).toThrow();
    expect(() => normalizeWikipediaSectionIndex("9007199254740992")).toThrow();
    expect(() => normalizeWikipediaSectionIndex("7".repeat(10_000))).toThrow();
  });

  it("uses disjoint cache namespaces for the summary, indices, and literal headings", () => {
    const summary = getWikipediaSectionLinksCacheKey(null, undefined);
    const indexed = getWikipediaSectionLinksCacheKey("History", "3");
    const summaryHeading = getWikipediaSectionLinksCacheKey(
      "__summary__",
      undefined,
    );
    const indexHeading = getWikipediaSectionLinksCacheKey("index:3", undefined);

    expect(new Set([summary, indexed, summaryHeading, indexHeading]).size).toBe(
      4,
    );
    expect(JSON.parse(summary)).toEqual(["summary"]);
    expect(JSON.parse(indexed)).toEqual(["index", "3"]);
    expect(JSON.parse(summaryHeading)).toEqual(["title", "__summary__"]);
    expect(JSON.parse(indexHeading)).toEqual(["title", "index:3"]);
  });

  it("requires page, revision, normalized title, and language while rejecting legacy rows", () => {
    expect(
      isWikipediaRevisionCacheIdentityCompatible(
        {
          wikiPageId: "00042",
          revisionId: "00099",
          title: "Walter_Savage  Landor",
          language: "EN",
        },
        identity,
      ),
    ).toBe(true);
    expect(
      isWikipediaRevisionCacheIdentityCompatible(
        { wikiPageId: "42", revisionId: "99" },
        identity,
      ),
    ).toBe(false);
    expect(
      isWikipediaRevisionCacheIdentityCompatible(
        { ...identity, title: "Nile" },
        identity,
      ),
    ).toBe(false);
    expect(
      isWikipediaRevisionCacheIdentityCompatible(
        { ...identity, language: "fr" },
        identity,
      ),
    ).toBe(false);
  });

  it("makes mismatched and legacy parse-cache rows lazy misses", async () => {
    const first = vi
      .fn()
      .mockResolvedValueOnce({ ...identity, title: "Nile" })
      .mockResolvedValueOnce({
        wikiPageId: identity.wikiPageId,
        revisionId: identity.revisionId,
      });
    const query = vi.fn(() => {
      const chain = {
        withIndex: vi.fn(() => chain),
        first,
      };
      return chain;
    });
    const handler = (
      getParseCache as unknown as {
        _handler: (ctx: unknown, args: unknown) => Promise<unknown>;
      }
    )._handler;

    await expect(handler({ db: { query } }, identity)).resolves.toBeNull();
    await expect(handler({ db: { query } }, identity)).resolves.toBeNull();
  });

  it("makes section-link rows without the complete source identity lazy misses", async () => {
    const cacheIdentity = {
      ...identity,
      sectionTitle: "index:3",
      links: [],
      cachedAt: 1,
    };
    const first = vi
      .fn()
      .mockResolvedValueOnce({ ...cacheIdentity, title: "Nile" })
      .mockResolvedValueOnce({
        wikiPageId: identity.wikiPageId,
        revisionId: identity.revisionId,
        sectionTitle: "index:3",
        links: [],
        cachedAt: 1,
      })
      .mockResolvedValueOnce(cacheIdentity);
    const query = vi.fn(() => {
      const chain = {
        withIndex: vi.fn(() => chain),
        first,
      };
      return chain;
    });
    const handler = (
      getSectionLinksFromCache as unknown as {
        _handler: (ctx: unknown, args: unknown) => Promise<unknown>;
      }
    )._handler;
    const args = { ...identity, sectionTitle: "index:3" };

    await expect(handler({ db: { query } }, args)).resolves.toBeNull();
    await expect(handler({ db: { query } }, args)).resolves.toBeNull();
    await expect(handler({ db: { query } }, args)).resolves.toEqual(
      cacheIdentity,
    );
  });
});

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

  it("uses null as the compare-and-set identity for a legacy row without a version", () => {
    const { mutationArgs } = normalizeCachedArticleForPersistence({
      _id: "article-unversioned" as never,
      wikiPageId: "123",
      title: "Example article",
      language: "en",
      revisionId: "456",
      lastFetchedAt: Date.UTC(2026, 3, 28, 12),
      sections: [],
    });

    expect(mutationArgs.expectedNarrationVersion).toBeNull();
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

describe("persistCachedNarrationFallback", () => {
  const staleArticle = {
    _id: "article-stale" as never,
    wikiPageId: "123",
    title: "Example article",
    language: "en",
    revisionId: "456",
    lastFetchedAt: Date.UTC(2026, 3, 28, 12),
    sections: [
      {
        title: "Tiny section",
        level: 2,
        content: "Still source text.",
      },
    ],
  };

  it("returns the last readable cache when persistence loses a concurrent race", async () => {
    const ctx = {
      runMutation: vi.fn(async () => ({ persisted: false })),
      runQuery: vi.fn(async () => null),
    };

    const result = await persistCachedNarrationFallback(
      ctx as never,
      staleArticle,
    );

    expect(result.sections[0].narration).toMatchObject({
      mode: "verbatim",
      text: "Tiny section. Still source text.",
      usedRawFallback: true,
    });
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
