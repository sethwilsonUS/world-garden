import { afterEach, describe, expect, it, vi } from "vitest";
import { enrichDidYouKnowThumbnails } from "./today-snapshot";
import type { WikipediaDidYouKnowItem } from "./featured-article";
import { WIKIMEDIA_FEED_THUMBNAIL_WIDTH } from "./wikimedia-media";

const originalFetch = global.fetch;
const originalLocalMode = process.env.NEXT_PUBLIC_LOCAL_MODE;
const originalConvexUrl = process.env.NEXT_PUBLIC_CONVEX_URL;
const originalAttestationSecret = process.env.TTS_QUOTA_BYPASS_SECRET;

const restoreEnvValue = (key: string, value: string | undefined) => {
  if (value === undefined) {
    delete process.env[key];
  } else {
    process.env[key] = value;
  }
};

afterEach(() => {
  global.fetch = originalFetch;
  vi.restoreAllMocks();
  vi.resetModules();
  vi.doUnmock("convex/nextjs");
  vi.doUnmock("convex/server");
  vi.doUnmock("@/lib/featured-article");
  vi.doUnmock("@/lib/nsfw-filter");
  restoreEnvValue("NEXT_PUBLIC_LOCAL_MODE", originalLocalMode);
  restoreEnvValue("NEXT_PUBLIC_CONVEX_URL", originalConvexUrl);
  restoreEnvValue("TTS_QUOTA_BYPASS_SECRET", originalAttestationSecret);
});

describe("enrichDidYouKnowThumbnails", () => {
  it("adds page ids and thumbnails to linked Did You Know articles", async () => {
    const fetchMock = vi.fn<typeof fetch>(async () =>
      Response.json({
        query: {
          pages: {
            "123": {
              pageid: 123,
              ns: 0,
              title: "Lenox Lyceum",
              thumbnail: {
                source: "https://upload.wikimedia.org/lenox.jpg",
                width: 320,
                height: 240,
              },
            },
          },
        },
      }),
    );
    global.fetch = fetchMock;

    const items: WikipediaDidYouKnowItem[] = [
      {
        text: "... that a celebration happened at the Lenox Lyceum?",
        links: [
          {
            title: "Lenox Lyceum",
            slug: "Lenox_Lyceum",
            text: "Lenox Lyceum",
          },
        ],
        segments: [
          { type: "text", text: "... that a celebration happened at the " },
          {
            type: "link",
            title: "Lenox Lyceum",
            slug: "Lenox_Lyceum",
            text: "Lenox Lyceum",
          },
          { type: "text", text: "?" },
        ],
      },
    ];

    await expect(enrichDidYouKnowThumbnails(items)).resolves.toEqual([
      {
        ...items[0],
        links: [
          {
            ...items[0].links[0],
            wikiPageId: "123",
            thumbnail: {
              source: "https://upload.wikimedia.org/lenox.jpg",
              width: 320,
              height: 240,
              attribution: {
                sourceTitle: "File:lenox.jpg",
              sourceUrl: "https://commons.wikimedia.org/wiki/File%3Alenox.jpg",
              },
            },
          },
        ],
      },
    ]);
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it("uses the slug when a Did You Know link has no title", async () => {
    const fetchMock = vi.fn<typeof fetch>(async () =>
      Response.json({
        query: {
          pages: {
            "123": {
              pageid: 123,
              ns: 0,
              title: "Lenox Lyceum",
              thumbnail: {
                source: "https://upload.wikimedia.org/lenox.jpg",
                width: 320,
                height: 240,
              },
            },
          },
        },
      }),
    );
    global.fetch = fetchMock;

    const slugOnlyLink = {
      slug: "Lenox_Lyceum",
      text: "Lenox Lyceum",
    } as WikipediaDidYouKnowItem["links"][number];
    const items: WikipediaDidYouKnowItem[] = [
      {
        text: "... that a celebration happened at the Lenox Lyceum?",
        links: [slugOnlyLink],
        segments: [
          { type: "text", text: "... that a celebration happened at the " },
          { type: "text", text: "Lenox Lyceum" },
          { type: "text", text: "?" },
        ],
      },
    ];

    await expect(enrichDidYouKnowThumbnails(items)).resolves.toEqual([
      {
        ...items[0],
        links: [
          {
            ...slugOnlyLink,
            wikiPageId: "123",
            thumbnail: {
              source: "https://upload.wikimedia.org/lenox.jpg",
              width: 320,
              height: 240,
              attribution: {
                sourceTitle: "File:lenox.jpg",
              sourceUrl: "https://commons.wikimedia.org/wiki/File%3Alenox.jpg",
              },
            },
          },
        ],
      },
    ]);
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it("leaves missing thumbnails and items without links untouched", async () => {
    const fetchMock = vi.fn<typeof fetch>(async () =>
      Response.json({
        query: {
          pages: {
            "-1": {
              missing: "",
              title: "Missing Article",
            },
          },
        },
      }),
    );
    global.fetch = fetchMock;

    const items: WikipediaDidYouKnowItem[] = [
      {
        text: "... that Missing Article has no page image?",
        links: [
          {
            title: "Missing Article",
            slug: "Missing_Article",
            text: "Missing Article",
          },
        ],
        segments: [
          { type: "text", text: "... that Missing Article has no page image?" },
        ],
      },
      {
        text: "... that namespace links are treated as plain text?",
        links: [],
        segments: [
          {
            type: "text",
            text: "... that namespace links are treated as plain text?",
          },
        ],
      },
    ];

    await expect(enrichDidYouKnowThumbnails(items)).resolves.toEqual(items);
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it("keeps Did You Know items when thumbnail enrichment fails", async () => {
    const fetchMock = vi
      .fn<typeof fetch>()
      .mockRejectedValue(new Error("Wikimedia timeout"));
    global.fetch = fetchMock;

    const items: WikipediaDidYouKnowItem[] = [
      {
        text: "... that Lenox Lyceum still renders without thumbnails?",
        links: [
          {
            title: "Lenox Lyceum",
            slug: "Lenox_Lyceum",
            text: "Lenox Lyceum",
          },
        ],
        segments: [
          {
            type: "text",
            text: "... that Lenox Lyceum still renders without thumbnails?",
          },
        ],
      },
    ];

    await expect(enrichDidYouKnowThumbnails(items)).resolves.toBe(items);
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it("applies MediaWiki normalized and redirects mappings, uses canonical pithumbsize, and routes /wikipedia/en/ thumbnails to enwiki", async () => {
    const enwikiThumb =
      "https://upload.wikimedia.org/wikipedia/en/thumb/f/f6/Fair_Use_Cover.png/500px-Fair_Use_Cover.png";
    let pageImagesThumbSize: string | null = null;
    const attributionHosts: string[] = [];

    const fetchMock = vi.fn<typeof fetch>(async (input) => {
      const url = new URL(String(input));

      if (url.searchParams.get("prop") === "pageimages|info") {
        pageImagesThumbSize = url.searchParams.get("pithumbsize");
        expect(url.searchParams.get("redirects")).toBe("1");
        return Response.json({
          query: {
            normalized: [{ from: "wwii", to: "Wwii" }],
            redirects: [{ from: "Wwii", to: "World War II" }],
            pages: [
              {
                pageid: 32927,
                ns: 0,
                title: "World War II",
                thumbnail: {
                  source: enwikiThumb,
                  width: 500,
                  height: 333,
                },
              },
            ],
          },
        });
      }

      if (url.searchParams.get("prop") === "imageinfo") {
        attributionHosts.push(url.hostname);
        expect(url.hostname).toBe("en.wikipedia.org");
        expect(url.searchParams.has("iiurlwidth")).toBe(false);
        return Response.json({
          query: {
            pages: [
              {
                title: "File:Fair Use Cover.png",
                imageinfo: [
                  {
                    descriptionurl:
                      "https://en.wikipedia.org/wiki/File:Fair_Use_Cover.png",
                    extmetadata: {
                      Credit: { value: "English Wikipedia archive" },
                      LicenseShortName: { value: "Fair use" },
                    },
                  },
                ],
              },
            ],
          },
        });
      }

      throw new Error(`Unexpected URL: ${url.toString()}`);
    });
    global.fetch = fetchMock;

    const items: WikipediaDidYouKnowItem[] = [
      {
        text: "... that wwii reshaped global history?",
        links: [
          {
            title: "wwii",
            slug: "wwii",
            text: "wwii",
          },
        ],
        segments: [
          { type: "text", text: "... that " },
          { type: "link", title: "wwii", slug: "wwii", text: "wwii" },
          { type: "text", text: " reshaped global history?" },
        ],
      },
    ];

    const enriched = await enrichDidYouKnowThumbnails(items);

    expect(pageImagesThumbSize).toBe(String(WIKIMEDIA_FEED_THUMBNAIL_WIDTH));
    expect(attributionHosts).toEqual(["en.wikipedia.org"]);
    expect(enriched[0]?.links[0]).toEqual({
      title: "wwii",
      slug: "wwii",
      text: "wwii",
      wikiPageId: "32927",
      thumbnail: {
        source: enwikiThumb,
        width: 500,
        height: 333,
        attribution: {
          creator: undefined,
          credit: "English Wikipedia archive",
          licenseName: "Fair use",
          licenseUrl: undefined,
          sourceTitle: "File:Fair Use Cover.png",
          sourceUrl: "https://en.wikipedia.org/wiki/File:Fair_Use_Cover.png",
        },
      },
    });
  });
});

describe("getTodayWikipediaData", () => {
  it("honors live fallback after a cache miss when caching is enabled", async () => {
    vi.resetModules();
    process.env.NEXT_PUBLIC_LOCAL_MODE = "false";
    process.env.NEXT_PUBLIC_CONVEX_URL = "https://example.convex.cloud";
    process.env.TTS_QUOTA_BYPASS_SECRET = "publication-secret";

    const fetchQuery = vi.fn().mockResolvedValue(null);
    const fetchMutation = vi.fn();
    const fetchWikipediaFeaturedSnapshot = vi.fn().mockResolvedValue({
      tfa: null,
      trendingCandidates: [],
      didYouKnow: [],
      inTheNews: [],
      pictureOfDay: null,
      onThisDay: [],
      trendingDate: null,
      trendingSource: null,
      trendingSourceType: null,
      trendingIsStale: false,
      feedDate: "2026/05/07",
      feedDateIso: "2026-05-07",
    });

    vi.doMock("convex/nextjs", () => ({
      fetchMutation,
      fetchQuery,
    }));
    vi.doMock("convex/server", () => ({
      anyApi: {
        today: {
          getLatestTodaySnapshot: "getLatestTodaySnapshot",
          getTodaySnapshotByDate: "getTodaySnapshotByDate",
          saveTodaySnapshot: "saveTodaySnapshot",
        },
      },
    }));
    vi.doMock("@/lib/featured-article", () => ({
      fetchWikipediaFeaturedSnapshot,
      getWikipediaFeaturedFeedDate: () => "2026/05/07",
    }));
    vi.doMock("@/lib/nsfw-filter", () => ({
      filterSafeTitles: async (titles: string[]) => new Set(titles),
    }));

    const { getTodayWikipediaData, syncTodayWikipediaSnapshot } = await import(
      "./today-snapshot"
    );

    await expect(
      getTodayWikipediaData({
        allowLiveFallback: true,
        feedDateIso: "2026-05-07",
      }),
    ).resolves.toMatchObject({
      feedDate: "2026-05-07",
      snapshotIsStale: false,
    });
    expect(fetchQuery).toHaveBeenCalled();
    expect(fetchWikipediaFeaturedSnapshot).toHaveBeenCalled();

    await syncTodayWikipediaSnapshot({ feedDateIso: "2026-05-07" });
    expect(fetchMutation).toHaveBeenCalledWith(
      "saveTodaySnapshot",
      expect.objectContaining({
        feedDate: "2026-05-07",
        attestation: expect.objectContaining({ signature: expect.any(String) }),
      }),
    );
  });

  it("prefers live current data over the latest stale snapshot when fallback is allowed", async () => {
    vi.resetModules();
    process.env.NEXT_PUBLIC_LOCAL_MODE = "false";
    process.env.NEXT_PUBLIC_CONVEX_URL = "https://example.convex.cloud";
    process.env.TTS_QUOTA_BYPASS_SECRET = "publication-secret";

    const fetchQuery = vi.fn().mockImplementation((query: string) => {
      if (query === "getLatestTodaySnapshot") {
        throw new Error("Latest snapshot should only be a stale fallback");
      }
      return null;
    });
    const fetchMutation = vi.fn();
    const fetchWikipediaFeaturedSnapshot = vi.fn().mockResolvedValue({
      tfa: null,
      trendingCandidates: [],
      didYouKnow: [],
      inTheNews: [],
      pictureOfDay: null,
      onThisDay: [],
      trendingDate: null,
      trendingSource: null,
      trendingSourceType: null,
      trendingIsStale: false,
      feedDate: "2026/05/07",
      feedDateIso: "2026-05-07",
    });

    vi.doMock("convex/nextjs", () => ({
      fetchMutation,
      fetchQuery,
    }));
    vi.doMock("convex/server", () => ({
      anyApi: {
        today: {
          getLatestTodaySnapshot: "getLatestTodaySnapshot",
          getTodaySnapshotByDate: "getTodaySnapshotByDate",
          saveTodaySnapshot: "saveTodaySnapshot",
        },
      },
    }));
    vi.doMock("@/lib/featured-article", () => ({
      fetchWikipediaFeaturedSnapshot,
      getWikipediaFeaturedFeedDate: () => "2026/05/07",
    }));
    vi.doMock("@/lib/nsfw-filter", () => ({
      filterSafeTitles: async (titles: string[]) => new Set(titles),
    }));

    const { getTodayWikipediaData } = await import("./today-snapshot");

    await expect(
      getTodayWikipediaData({ allowLiveFallback: true }),
    ).resolves.toMatchObject({
      feedDate: "2026-05-07",
      snapshotIsStale: false,
    });
    expect(fetchQuery).toHaveBeenCalledWith("getTodaySnapshotByDate", {
      feedDate: "2026-05-07",
    });
    expect(fetchQuery).not.toHaveBeenCalledWith("getLatestTodaySnapshot", {});
    expect(fetchWikipediaFeaturedSnapshot).toHaveBeenCalled();
  });

  it("keeps trending empty when the safety filter rejects every candidate", async () => {
    vi.resetModules();
    process.env.NEXT_PUBLIC_LOCAL_MODE = "true";

    const fetchWikipediaFeaturedSnapshot = vi.fn().mockResolvedValue({
      tfa: null,
      trendingCandidates: [
        {
          title: "Explicit Article",
          slug: "Explicit_Article",
          views: 50_000,
        },
        {
          title: "Mercury",
          slug: "Mercury",
          views: 40_000,
        },
      ],
      didYouKnow: [],
      inTheNews: [],
      pictureOfDay: null,
      onThisDay: [],
      trendingDate: "2026-05-06",
      trendingSource: "mostread",
      trendingSourceType: "mostread",
      trendingIsStale: false,
      feedDate: "2026/05/07",
      feedDateIso: "2026-05-07",
    });

    vi.doMock("@/lib/featured-article", () => ({
      fetchWikipediaFeaturedSnapshot,
      getWikipediaFeaturedFeedDate: () => "2026/05/07",
    }));
    vi.doMock("@/lib/nsfw-filter", () => ({
      filterSafeTitles: async () => new Set<string>(),
    }));

    const { buildTodayWikipediaSnapshot } = await import("./today-snapshot");

    const snapshot = await buildTodayWikipediaSnapshot({
      feedDateIso: "2026-05-07",
      now: new Date(Date.UTC(2026, 4, 7, 12, 0, 0)),
    });

    expect(snapshot.trending).toEqual([]);
  });
});
