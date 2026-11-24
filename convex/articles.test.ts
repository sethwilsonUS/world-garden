import { afterEach, describe, expect, it, vi } from "vitest";
import { getFunctionName } from "convex/server";
import {
  ARTICLE_PARSE_MEDIA_CACHE_VERSION,
  ARTICLE_CACHE_TTL_MS,
  canPersistNormalizedCachedNarration,
  cachedArticleToFetchResult,
  canonicalizeWikipediaRevisionIdentity,
  fetchAndCacheBySlugForCtx,
  fetchAndCacheForCtx,
  getArticleImagesForCtx,
  getArticleMetadataForCtx,
  getParseCache,
  getRelatedArticlesForCtx,
  getRelatedArticlesFromCache,
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
import { registeredInvoker } from "./testing/registeredFunctions";

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
    const handler = registeredInvoker(getParseCache);

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
    const handler = registeredInvoker(getSectionLinksFromCache);
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

describe("cold-article ingestion parse cache seeding and coalesced metadata", () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  const createInMemoryArticleCtx = ({
    failUpsertParseCache = false,
  }: {
    failUpsertParseCache?: boolean;
  } = {}) => {
    const articlesByPageId = new Map<string, Record<string, unknown>>();
    const articlesBySlug = new Map<string, Record<string, unknown>>();
    const parseCacheByKey = new Map<string, Record<string, unknown>>();
    const sectionLinksCacheByKey = new Map<string, Record<string, unknown>>();
    const parseCacheKey = (wikiPageId: string, revisionId: string) =>
      `${wikiPageId}:${revisionId}`;
    const sectionLinksKey = (
      wikiPageId: string,
      revisionId: string,
      sectionTitle: string,
    ) => `${wikiPageId}:${revisionId}:${sectionTitle}`;

    const runQuery = vi.fn(async (ref: unknown, args: Record<string, unknown>) => {
      const name = getFunctionName(ref as never);
      if (name === "articles:getCachedArticleBySlug") {
        return articlesBySlug.get(String(args.slug)) ?? null;
      }
      if (
        name === "articles:getCachedArticleByWikiPageId" ||
        name === "articles:getExistingArticleForRefresh"
      ) {
        return articlesByPageId.get(String(args.wikiPageId)) ?? null;
      }
      if (name === "articles:getParseCache") {
        const cached =
          parseCacheByKey.get(
            parseCacheKey(String(args.wikiPageId), String(args.revisionId)),
          ) ?? null;
        return isWikipediaRevisionCacheIdentityCompatible(
          cached as never,
          args as never,
        )
          ? cached
          : null;
      }
      if (name === "articles:getSectionLinksFromCache") {
        const cached =
          sectionLinksCacheByKey.get(
            sectionLinksKey(
              String(args.wikiPageId),
              String(args.revisionId),
              String(args.sectionTitle),
            ),
          ) ?? null;
        return isWikipediaRevisionCacheIdentityCompatible(
          cached as never,
          args as never,
        )
          ? cached
          : null;
      }
      throw new Error(`Unexpected query: ${name}`);
    });

    const runMutation = vi.fn(
      async (ref: unknown, args: Record<string, unknown>) => {
        const name = getFunctionName(ref as never);
        if (name === "articles:upsertArticle") {
          const row = { _id: "article-doc-1", ...args };
          articlesByPageId.set(String(args.wikiPageId), row);
          articlesBySlug.set(String(args.slug), row);
          return "article-doc-1";
        }
        if (name === "articles:upsertParseCache") {
          if (failUpsertParseCache) {
            throw new Error("Simulated parse cache write failure");
          }
          const row = {
            ...args,
            mediaMetadataVersion: ARTICLE_PARSE_MEDIA_CACHE_VERSION,
            cachedAt: Date.now(),
          };
          parseCacheByKey.set(
            parseCacheKey(String(args.wikiPageId), String(args.revisionId)),
            row,
          );
          return undefined;
        }
        if (name === "articles:upsertSectionLinksCache") {
          const row = {
            ...args,
            cachedAt: Date.now(),
          };
          sectionLinksCacheByKey.set(
            sectionLinksKey(
              String(args.wikiPageId),
              String(args.revisionId),
              String(args.sectionTitle),
            ),
            row,
          );
          return undefined;
        }
        throw new Error(`Unexpected mutation: ${name}`);
      },
    );

    return {
      ctx: { runQuery, runMutation },
      articlesByPageId,
      parseCacheByKey,
      runQuery,
      runMutation,
    };
  };

  const mockColdWikipediaResponses = ({
    parseOverride,
  }: {
    parseOverride?: () => Response;
  } = {}) => {
    let parseRequestCount = 0;
    let commonsImageInfoCount = 0;

    const parsoidHtml = [
      '<section data-mw-section-id="0">',
      '<p>Ada Lovelace was an <a rel="mw:WikiLink" href="./England" title="England">English</a> mathematician.<sup class="reference"><a href="#cite_note-1">[1]</a></sup></p>',
      '<figure typeof="mw:File/Thumb">',
      '<a href="./File:Ada_portrait.jpg" class="mw-file-description">',
      '<img src="//upload.wikimedia.org/wikipedia/commons/thumb/a/ab/Ada_portrait.jpg/330px-Ada_portrait.jpg" width="330" height="440" alt="Portrait of Ada Lovelace" resource="./File:Ada_portrait.jpg" />',
      "</a>",
      "<figcaption>Portrait of Ada Lovelace in 1840.</figcaption>",
      "</figure>",
      "</section>",
      '<section data-mw-section-id="1">',
      '<h2 id="Early_life">Early life</h2>',
      '<p>She studied <a rel="mw:WikiLink" href="./Mathematics" title="Mathematics">mathematics</a> and <a rel="mw:WikiLink" href="./Logic" title="Logic">logic</a>.</p>',
      "</section>",
      '<section data-mw-section-id="2">',
      '<h2 id="References">References</h2>',
      '<ol class="references"><li id="cite_note-1"><span class="reference-text">Biographical note on Ada Lovelace.</span></li></ol>',
      "</section>",
    ].join("");

    const fetchSpy = vi
      .spyOn(globalThis, "fetch")
      .mockImplementation(async (input) => {
        const url = new URL(String(input));
        if (
          url.hostname === "en.wikipedia.org" &&
          url.searchParams.get("action") === "query" &&
          url.searchParams.get("prop") === "description"
        ) {
          const titles = (url.searchParams.get("titles") ?? "")
            .split("|")
            .filter(Boolean);
          const catalog: Record<
            string,
            { pageid: number; ns: number; title: string; description: string }
          > = {
            England: {
              pageid: 9316,
              ns: 0,
              title: "England",
              description: "Country in north-west Europe",
            },
            Mathematics: {
              pageid: 18831,
              ns: 0,
              title: "Mathematics",
              description: "Area of knowledge",
            },
            Logic: {
              pageid: 17867,
              ns: 0,
              title: "Logic",
              description: "Study of correct reasoning",
            },
          };
          return new Response(
            JSON.stringify({
              query: {
                pages: titles.map(
                  (title, idx) =>
                    catalog[title] ?? {
                      pageid: 50_000 + idx,
                      ns: 0,
                      title,
                      description: `Description for ${title}`,
                    },
                ),
              },
            }),
            { status: 200, headers: { "Content-Type": "application/json" } },
          );
        }

        if (
          url.hostname === "en.wikipedia.org" &&
          url.searchParams.get("action") === "query"
        ) {
          return new Response(
            JSON.stringify({
              query: {
                pages: [
                  {
                    pageid: 974,
                    title: "Ada Lovelace",
                    extract: [
                      "Ada Lovelace was an English mathematician.",
                      "== Early life ==",
                      "She studied mathematics and logic.",
                      "== References ==",
                      "Biographical note on Ada Lovelace.",
                    ].join("\n\n"),
                    revisions: [
                      { revid: 4200, timestamp: "2026-11-24T00:00:00Z" },
                    ],
                  },
                ],
              },
            }),
            { status: 200, headers: { "Content-Type": "application/json" } },
          );
        }

        if (
          url.hostname === "en.wikipedia.org" &&
          url.pathname.startsWith("/api/rest_v1/page/summary/")
        ) {
          return new Response(JSON.stringify({}), {
            status: 200,
            headers: { "Content-Type": "application/json" },
          });
        }

        if (
          url.hostname === "en.wikipedia.org" &&
          url.searchParams.get("action") === "parse"
        ) {
          parseRequestCount += 1;
          if (parseOverride) return parseOverride();
          return new Response(
            JSON.stringify({
              parse: {
                pageid: 974,
                revid: 4200,
                title: "Ada Lovelace",
                text: parsoidHtml,
                tocdata: {
                  sections: [
                    { index: "1", line: "Early life", level: 2 },
                    { index: "2", line: "References", level: 2 },
                  ],
                },
              },
            }),
            { status: 200, headers: { "Content-Type": "application/json" } },
          );
        }

        if (
          url.hostname === "commons.wikimedia.org" &&
          url.searchParams.get("prop") === "imageinfo"
        ) {
          commonsImageInfoCount += 1;
          return new Response(
            JSON.stringify({
              query: {
                pages: [
                  {
                    title: "File:Ada portrait.jpg",
                    imagerepository: "local",
                    imageinfo: [
                      {
                        url: "https://upload.wikimedia.org/wikipedia/commons/a/ab/Ada_portrait.jpg",
                        width: 2400,
                        height: 3200,
                        thumburl:
                          "https://upload.wikimedia.org/wikipedia/commons/thumb/a/ab/Ada_portrait.jpg/1600px-Ada_portrait.jpg",
                        thumbwidth: 1600,
                        thumbheight: 2133,
                        descriptionurl:
                          "https://commons.wikimedia.org/wiki/File:Ada_portrait.jpg",
                        extmetadata: {
                          Artist: { value: "Alfred Edward Chalon" },
                          LicenseShortName: { value: "Public domain" },
                        },
                      },
                    ],
                  },
                ],
              },
            }),
            { status: 200, headers: { "Content-Type": "application/json" } },
          );
        }

        throw new Error(`Unexpected fetch URL in test: ${url.toString()}`);
      });

    return {
      fetchSpy,
      getParseRequestCount: () => parseRequestCount,
      getCommonsImageInfoCount: () => commonsImageInfoCount,
    };
  };

  it("triggers at most one action=parse across cold slug ingestion plus metadata and gallery reads", async () => {
    const { ctx, parseCacheByKey } = createInMemoryArticleCtx();
    const network = mockColdWikipediaResponses();

    const article = await fetchAndCacheBySlugForCtx(
      ctx as never,
      { slug: "Ada_Lovelace" },
      { fetchBadgeKeys: async () => ["biography", "technology"] },
    );

    expect(article.wikiPageId).toBe("974");
    expect(article.revisionId).toBe("4200");
    expect(network.getParseRequestCount()).toBe(1);
    expect(network.getCommonsImageInfoCount()).toBe(1);

    const seededRow = parseCacheByKey.get("974:4200");
    expect(seededRow).toMatchObject({
      wikiPageId: "974",
      revisionId: "4200",
      title: "Ada Lovelace",
      language: "en",
      mediaMetadataVersion: ARTICLE_PARSE_MEDIA_CACHE_VERSION,
    });

    const identity = {
      wikiPageId: article.wikiPageId,
      revisionId: article.revisionId,
      title: article.title,
      language: article.language,
    };
    const metadata = await getArticleMetadataForCtx(ctx as never, identity);
    const images = await getArticleImagesForCtx(ctx as never, identity);
    const leadLinks = await getSectionLinksForCtx(ctx as never, {
      ...identity,
      sectionTitle: null,
    });
    const earlyLifeLinks = await getSectionLinksForCtx(ctx as never, {
      ...identity,
      sectionTitle: "Early life",
      sectionIndex: "1",
    });

    // Zero additional upstream parses or Commons enrichment calls across
    // metadata, gallery, lead links (RelatedArticles), and indexed section links.
    expect(network.getParseRequestCount()).toBe(1);
    expect(network.getCommonsImageInfoCount()).toBe(1);
    expect(leadLinks).toEqual([
      {
        wikiPageId: "9316",
        title: "England",
        description: "Country in north-west Europe",
      },
    ]);
    expect(earlyLifeLinks).toEqual([
      {
        wikiPageId: "17867",
        title: "Logic",
        description: "Study of correct reasoning",
      },
      {
        wikiPageId: "18831",
        title: "Mathematics",
        description: "Area of knowledge",
      },
    ]);
    expect(metadata.linkCounts).toEqual(
      expect.arrayContaining([
        { index: "__summary__", title: "__summary__", count: 1 },
        { index: "1", title: "Early life", count: 2 },
      ]),
    );
    expect(metadata.citations).toEqual([
      {
        id: "cite_note-1",
        index: 1,
        text: "Biographical note on Ada Lovelace.",
      },
    ]);
    expect(metadata.sectionIndexMap).toEqual(
      expect.arrayContaining([{ title: "Early life", index: "1" }]),
    );
    expect(images).toHaveLength(1);
    expect(images[0]).toMatchObject({
      lightboxSrc:
        "https://upload.wikimedia.org/wikipedia/commons/thumb/a/ab/Ada_portrait.jpg/1600px-Ada_portrait.jpg",
      lightboxWidth: 1600,
      lightboxHeight: 2133,
      attribution: expect.objectContaining({
        creator: "Alfred Edward Chalon",
        licenseName: "Public domain",
      }),
    });
  });

  it("seeds the parse cache during cold pageId ingestion with one action=parse call", async () => {
    const { ctx } = createInMemoryArticleCtx();
    const network = mockColdWikipediaResponses();

    const article = await fetchAndCacheForCtx(
      ctx as never,
      { wikiPageId: "974" },
      { fetchBadgeKeys: async () => ["biography"] },
    );
    const metadata = await getArticleMetadataForCtx(ctx as never, {
      wikiPageId: article.wikiPageId,
      revisionId: article.revisionId,
      title: article.title,
      language: article.language,
    });

    expect(network.getParseRequestCount()).toBe(1);
    expect(metadata.images).toHaveLength(1);
    expect(metadata.citations).toHaveLength(1);
  });

  it("preserves plaintext fallback without poisoning articleParseCache when HTML parsing fails", async () => {
    const { ctx, parseCacheByKey } = createInMemoryArticleCtx();
    let failParse = true;
    const network = mockColdWikipediaResponses({
      parseOverride: () =>
        failParse
          ? new Response("upstream error", { status: 500 })
          : new Response(
              JSON.stringify({
                parse: {
                  pageid: 974,
                  revid: 4200,
                  title: "Ada Lovelace",
                  text: '<section data-mw-section-id="0"><p>Lead.</p></section>',
                  tocdata: { sections: [] },
                },
              }),
              { status: 200, headers: { "Content-Type": "application/json" } },
            ),
    });

    const article = await fetchAndCacheBySlugForCtx(
      ctx as never,
      { slug: "Ada_Lovelace" },
      { fetchBadgeKeys: async () => [] },
    );

    expect(article.sections[0]?.narration.usedRawFallback).toBe(true);
    expect(parseCacheByKey.size).toBe(0);

    // Later metadata read still parses HTML cleanly once upstream recovers.
    failParse = false;
    const metadata = await getArticleMetadataForCtx(ctx as never, {
      wikiPageId: article.wikiPageId,
      revisionId: article.revisionId,
      title: article.title,
      language: article.language,
    });
    expect(metadata.linkCounts).toHaveLength(1);
    expect(parseCacheByKey.size).toBe(1);
    expect(network.getParseRequestCount()).toBe(2);
  });

  it("keeps article ingestion successful even if seeding articleParseCache fails", async () => {
    const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});
    const { ctx, articlesByPageId } = createInMemoryArticleCtx({
      failUpsertParseCache: true,
    });
    mockColdWikipediaResponses();

    const article = await fetchAndCacheBySlugForCtx(
      ctx as never,
      { slug: "Ada_Lovelace" },
      { fetchBadgeKeys: async () => [] },
    );

    expect(article.wikiPageId).toBe("974");
    expect(articlesByPageId.has("974")).toBe(true);
    expect(warnSpy).toHaveBeenCalledWith(
      expect.stringContaining("Failed to seed article parse cache"),
    );
  });

  it("keeps revision identity mismatches fatal during cold article ingestion", async () => {
    const { ctx, articlesByPageId, parseCacheByKey } =
      createInMemoryArticleCtx();
    mockColdWikipediaResponses({
      parseOverride: () =>
        new Response(
          JSON.stringify({
            parse: {
              pageid: 974,
              revid: 9999,
              title: "Ada Lovelace",
              text: '<section data-mw-section-id="0"><p>Wrong rev.</p></section>',
              tocdata: { sections: [] },
            },
          }),
          { status: 200, headers: { "Content-Type": "application/json" } },
        ),
    });

    await expect(
      fetchAndCacheBySlugForCtx(
        ctx as never,
        { slug: "Ada_Lovelace" },
        { fetchBadgeKeys: async () => [] },
      ),
    ).rejects.toMatchObject({ code: "identity-mismatch" });
    expect(articlesByPageId.size).toBe(0);
    expect(parseCacheByKey.size).toBe(0);
  });

  it("falls back to fetchSectionLinksByIndex when a legacy parse cache row lacks sectionLinkTitles", async () => {
    const { ctx, parseCacheByKey } = createInMemoryArticleCtx();
    const identity = {
      wikiPageId: "974",
      revisionId: "4200",
      title: "Ada Lovelace",
      language: "en",
    };
    parseCacheByKey.set("974:4200", {
      ...identity,
      linkCounts: [{ index: "1", title: "Early life", count: 1 }],
      citations: [],
      sectionCitations: [
        { index: "1", title: "Early life", count: 0, citationIds: [] },
      ],
      sectionIndexMap: [{ title: "Early life", index: "1" }],
      images: [],
      mediaMetadataVersion: ARTICLE_PARSE_MEDIA_CACHE_VERSION,
      cachedAt: Date.now(),
    });
    const fetchSectionLinks = vi.fn(async () => [
      { wikiPageId: "17867", title: "Logic" },
    ]);

    await expect(
      getSectionLinksForCtx(
        ctx as never,
        { ...identity, sectionTitle: "Early life", sectionIndex: "1" },
        { fetchSectionLinks },
      ),
    ).resolves.toEqual([{ wikiPageId: "17867", title: "Logic" }]);
    expect(fetchSectionLinks).toHaveBeenCalledTimes(1);
    expect(fetchSectionLinks).toHaveBeenCalledWith(identity, "1");
  });

  it("classifies badges with zero extra API calls when cirrusdoc weighted_tags are piggybacked on ingestion", async () => {
    const { ctx, articlesByPageId } = createInMemoryArticleCtx();
    let liftWingCalls = 0;
    let searchCalls = 0;

    vi.spyOn(globalThis, "fetch").mockImplementation(async (input) => {
      const url = new URL(String(input));
      if (url.hostname === "api.wikimedia.org") {
        liftWingCalls += 1;
        throw new Error("Lift Wing should not be called when cirrusdoc tags exist");
      }
      if (url.searchParams.get("list") === "search") {
        searchCalls += 1;
        throw new Error("CirrusSearch fallback should not be called");
      }
      if (
        url.hostname === "en.wikipedia.org" &&
        url.searchParams.get("action") === "query"
      ) {
        return new Response(
          JSON.stringify({
            query: {
              pages: [
                {
                  pageid: 974,
                  title: "Ada Lovelace",
                  extract: "Ada Lovelace was an English mathematician.",
                  revisions: [
                    { revid: 4200, timestamp: "2026-11-24T00:00:00Z" },
                  ],
                  cirrusdoc: [
                    {
                      source: {
                        weighted_tags: [
                          "classification.prediction.articletopic/Culture.Biography.Biography*|538",
                          "classification.prediction.articletopic/STEM.Computing|880",
                        ],
                      },
                    },
                  ],
                },
              ],
            },
          }),
          { status: 200, headers: { "Content-Type": "application/json" } },
        );
      }
      if (url.pathname.startsWith("/api/rest_v1/page/summary/")) {
        return new Response(JSON.stringify({}), { status: 200 });
      }
      if (url.searchParams.get("action") === "parse") {
        return new Response(
          JSON.stringify({
            parse: {
              pageid: 974,
              revid: 4200,
              title: "Ada Lovelace",
              text: '<section data-mw-section-id="0"><p>Ada Lovelace was an English mathematician.</p></section>',
              tocdata: { sections: [] },
            },
          }),
          { status: 200, headers: { "Content-Type": "application/json" } },
        );
      }
      throw new Error(`Unexpected URL: ${url.toString()}`);
    });

    const article = await fetchAndCacheBySlugForCtx(ctx as never, {
      slug: "Ada_Lovelace",
    });

    expect(article.badgeKeys).toEqual(["biography", "technology"]);
    expect(articlesByPageId.get("974")?.badgeKeys).toEqual([
      "biography",
      "technology",
    ]);
    expect(liftWingCalls).toBe(0);
    expect(searchCalls).toBe(0);
  });

  it("degrades gracefully without blocking article ingestion and preserves cached badges on rate limits", async () => {
    const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});
    const { ctx, articlesByPageId } = createInMemoryArticleCtx();
    // Seed an older expired article row with previously cached badge topics.
    articlesByPageId.set("974", {
      _id: "article-doc-1",
      wikiPageId: "974",
      slug: "Ada_Lovelace",
      title: "Ada Lovelace",
      language: "en",
      revisionId: "4100",
      lastFetchedAt: Date.now() - ARTICLE_CACHE_TTL_MS - 1_000,
      badgeKeys: ["history", "biography"],
      badgeTopicVersion: 0,
      badgeTopicsCachedAt: 1_000,
    });

    vi.spyOn(globalThis, "fetch").mockImplementation(async (input) => {
      const url = new URL(String(input));
      if (
        url.hostname === "api.wikimedia.org" ||
        url.searchParams.get("list") === "search"
      ) {
        return new Response("rate limited", {
          status: 429,
          headers: { "Retry-After": "60" },
        });
      }
      if (
        url.hostname === "en.wikipedia.org" &&
        url.searchParams.get("action") === "query"
      ) {
        return new Response(
          JSON.stringify({
            query: {
              pages: [
                {
                  pageid: 974,
                  title: "Ada Lovelace",
                  extract: "Ada Lovelace was an English mathematician.",
                  revisions: [
                    { revid: 4200, timestamp: "2026-11-24T00:00:00Z" },
                  ],
                },
              ],
            },
          }),
          { status: 200, headers: { "Content-Type": "application/json" } },
        );
      }
      if (url.pathname.startsWith("/api/rest_v1/page/summary/")) {
        return new Response(JSON.stringify({}), { status: 200 });
      }
      if (url.searchParams.get("action") === "parse") {
        return new Response(
          JSON.stringify({
            parse: {
              pageid: 974,
              revid: 4200,
              title: "Ada Lovelace",
              text: '<section data-mw-section-id="0"><p>Ada Lovelace was an English mathematician.</p></section>',
              tocdata: { sections: [] },
            },
          }),
          { status: 200, headers: { "Content-Type": "application/json" } },
        );
      }
      throw new Error(`Unexpected URL: ${url.toString()}`);
    });

    const article = await fetchAndCacheBySlugForCtx(ctx as never, {
      slug: "Ada_Lovelace",
    });

    expect(article.revisionId).toBe("4200");
    expect(article.summary).toContain("Ada Lovelace");
    expect(article.badgeKeys).toEqual(["history", "biography"]);
    expect(warnSpy).toHaveBeenCalled();
  });
});

describe("getRelatedArticlesForCtx caching and graceful degradation", () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  const sampleIdentity = {
    wikiPageId: "974",
    revisionId: "4200",
    title: "Ada Lovelace",
    language: "en",
  };

  it("caches related articles per article across revisions and serves subsequent visits without upstream calls", async () => {
    const cacheByKey = new Map<
      string,
      {
        wikiPageId: string;
        title: string;
        language: string;
        articles: Array<{
          wikiPageId: string;
          title: string;
          description?: string;
          thumbnail?: { source: string; width: number; height: number };
        }>;
        cachedAt: number;
      }
    >();

    const runQuery = vi.fn(async (ref: unknown, args: Record<string, unknown>) => {
      if (getFunctionName(ref as never) === "articles:getRelatedArticlesFromCache") {
        const key = `${args.wikiPageId}:${args.language}`;
        const cached = cacheByKey.get(key);
        return cached && cached.title === args.title ? cached : null;
      }
      throw new Error(`Unexpected query: ${getFunctionName(ref as never)}`);
    });
    const runMutation = vi.fn(
      async (ref: unknown, args: Record<string, unknown>) => {
        if (
          getFunctionName(ref as never) ===
          "articles:upsertRelatedArticlesCache"
        ) {
          const key = `${args.wikiPageId}:${args.language}`;
          cacheByKey.set(key, {
            wikiPageId: String(args.wikiPageId),
            title: String(args.title),
            language: String(args.language),
            articles: args.articles as Array<{
              wikiPageId: string;
              title: string;
              description?: string;
              thumbnail?: { source: string; width: number; height: number };
            }>,
            cachedAt: Date.now(),
          });
          return undefined;
        }
        throw new Error(`Unexpected mutation: ${getFunctionName(ref as never)}`);
      },
    );

    const fetchRelated = vi.fn(async () => [
      {
        wikiPageId: "1271",
        title: "Analytical engine",
        description: "19th century proposed mechanical computer",
        thumbnail: {
          source:
            "https://upload.wikimedia.org/wikipedia/commons/thumb/a/ab/Engine.jpg/500px-Engine.jpg",
          width: 500,
          height: 375,
        },
      },
      {
        wikiPageId: "5698",
        title: "Charles Babbage",
        description: "English mathematician and inventor",
      },
    ]);

    const first = await getRelatedArticlesForCtx(
      { runQuery, runMutation } as never,
      sampleIdentity,
      { fetchRelatedArticles: fetchRelated },
    );
    const second = await getRelatedArticlesForCtx(
      { runQuery, runMutation } as never,
      { ...sampleIdentity, revisionId: "4201" },
      { fetchRelatedArticles: fetchRelated },
    );

    expect(first).toHaveLength(2);
    expect(second).toEqual(first);
    expect(fetchRelated).toHaveBeenCalledTimes(1);
    expect(runMutation).toHaveBeenCalledTimes(1);
  });

  it("degrades gracefully to an empty list without caching when upstream morelike fails", async () => {
    const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});
    const runQuery = vi.fn(async () => null);
    const runMutation = vi.fn();
    const fetchRelated = vi.fn(async () => {
      throw new Error("Wikipedia related articles search failed: 503");
    });

    const result = await getRelatedArticlesForCtx(
      { runQuery, runMutation } as never,
      sampleIdentity,
      { fetchRelatedArticles: fetchRelated },
    );

    expect(result).toEqual([]);
    expect(runMutation).not.toHaveBeenCalled();
    expect(warnSpy).toHaveBeenCalledWith(
      "[articles] Failed to fetch related articles",
      expect.objectContaining({
        wikiPageId: "974",
        title: "Ada Lovelace",
      }),
    );
  });

  it("invalidates relatedArticlesCache lookup when an article's title changes", async () => {
    const handler = registeredInvoker(getRelatedArticlesFromCache);
    const cachedRow = {
      wikiPageId: "974",
      title: "Old Title",
      language: "en",
      articles: [{ wikiPageId: "1271", title: "Analytical engine" }],
      cachedAt: Date.now(),
    };
    const db = {
      query: vi.fn(() => ({
        withIndex: vi.fn(() => ({
          first: vi.fn(async () => cachedRow),
        })),
      })),
    };

    await expect(
      handler(
        { db } as never,
        { wikiPageId: "974", title: "Ada Lovelace", language: "en" },
      ),
    ).resolves.toBeNull();
    await expect(
      handler(
        { db } as never,
        { wikiPageId: "974", title: "Old Title", language: "en" },
      ),
    ).resolves.toEqual(cachedRow);
  });
});
