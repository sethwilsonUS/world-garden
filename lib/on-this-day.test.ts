import { describe, expect, it, vi } from "vitest";
import {
  buildFeaturedOnThisDayFallback,
  buildOnThisDaySnapshot,
  hashOnThisDaySnapshot,
  OnThisDayUpstreamError,
  paginateOnThisDaySnapshot,
  WIKIPEDIA_ON_THIS_DAY_REQUEST_TIMEOUT_MS,
  wikipediaRestOnThisDayProvider,
  type OnThisDayProvider,
} from "./on-this-day";
import {
  CURRENT_ON_THIS_DAY_SCHEMA_VERSION,
  type OnThisDaySnapshot,
} from "./on-this-day-contracts";

const provider: OnThisDayProvider = {
  fetchAll: vi.fn(async () => ({
    selected: [
      {
        year: 1969,
        text: "Apollo 11 splashed down in the Pacific Ocean.",
        pages: [
          {
            titles: { normalized: "Apollo 11" },
            pageid: 6625,
            thumbnail: {
              source: "https://upload.wikimedia.org/apollo.jpg",
              width: 330,
              height: 220,
            },
          },
          {
            title: "Splashdown",
            pageid: "123",
          },
        ],
      },
      { year: 1900, text: "", pages: [] },
    ],
    events: [
      { year: -30, text: "A historical event in 30 BCE.", pages: [] },
    ],
    births: [],
    deaths: [],
    holidays: [
      {
        text: "An annual observance",
        pages: [{ titles: { normalized: "Annual observance" }, pageid: 99 }],
      },
    ],
  })),
};

describe("On This Day snapshot", () => {
  it("normalizes every category and resolves one representative image per event", async () => {
    const resolveImages = vi.fn(async () =>
      new Map([
        [
          "https://upload.wikimedia.org/apollo.jpg",
          {
            altText:
              "Apollo 11 astronauts in a life raft after their Pacific splashdown.",
            attribution: {
              sourceTitle: "File:Apollo.jpg",
              sourceUrl: "https://commons.wikimedia.org/wiki/File:Apollo.jpg",
              creator: "NASA",
              licenseName: "Public domain",
            },
          },
        ],
      ]),
    );

    const snapshot = await buildOnThisDaySnapshot({
      day: { month: 7, day: 24 },
      provider,
      resolveImages,
      checkedAt: 1_779_000_000_000,
    });

    expect(provider.fetchAll).toHaveBeenCalledWith({ month: "07", day: "24" });
    expect(snapshot).toMatchObject({
      schemaVersion: CURRENT_ON_THIS_DAY_SCHEMA_VERSION,
      provider: "wikipedia-rest-v1",
      monthDay: "07-24",
      checkedAt: 1_779_000_000_000,
      sourceUrl: "https://en.wikipedia.org/wiki/July_24",
      counts: {
        selected: 1,
        events: 1,
        births: 0,
        deaths: 0,
        holidays: 1,
      },
      availableCategories: {
        selected: true,
        events: true,
        births: true,
        deaths: true,
        holidays: true,
      },
    });
    expect(snapshot.categories.selected[0]).toMatchObject({
      year: 1969,
      text: "Apollo 11 splashed down in the Pacific Ocean.",
      pages: [
        { title: "Apollo 11", slug: "Apollo_11", wikiPageId: "6625" },
        { title: "Splashdown", slug: "Splashdown", wikiPageId: "123" },
      ],
      image: {
        source: "https://upload.wikimedia.org/apollo.jpg",
        width: 330,
        height: 220,
        articleTitle: "Apollo 11",
        altText:
          "Apollo 11 astronauts in a life raft after their Pacific splashdown.",
        attribution: {
          creator: "NASA",
          licenseName: "Public domain",
        },
      },
    });
    expect(snapshot.categories.selected[0].id).toMatch(/^selected-/u);
    expect(snapshot.categories.events[0]).toMatchObject({ year: -30 });
    expect(snapshot.categories.holidays[0].year).toBeUndefined();
    expect(resolveImages).toHaveBeenCalledWith([
      {
        imageUrl: "https://upload.wikimedia.org/apollo.jpg",
        sourceTitle: "File:apollo.jpg",
      },
    ]);

    const rebuilt = await buildOnThisDaySnapshot({
      day: { month: 7, day: 24 },
      provider,
      resolveImages,
      checkedAt: 1_779_000_000_100,
    });
    expect(rebuilt.categories.selected[0].id).toBe(
      snapshot.categories.selected[0].id,
    );
    expect(hashOnThisDaySnapshot(rebuilt)).toBe(
      hashOnThisDaySnapshot(snapshot),
    );
  });

  it("reuses unchanged image metadata from the previous snapshot unless reResolveImages is set", async () => {
    const firstResolve = vi.fn(async () =>
      new Map([
        [
          "https://upload.wikimedia.org/apollo.jpg",
          {
            altText: "Cached Apollo alt text",
            attribution: {
              sourceTitle: "File:Apollo.jpg",
              sourceUrl: "https://commons.wikimedia.org/wiki/File:Apollo.jpg",
              creator: "NASA",
              licenseName: "Public domain",
            },
          },
        ],
      ]),
    );

    const previousSnapshot = await buildOnThisDaySnapshot({
      day: { month: 7, day: 24 },
      provider,
      resolveImages: firstResolve,
      checkedAt: 1_000,
    });

    const secondResolve = vi.fn(async () => new Map());
    const reused = await buildOnThisDaySnapshot({
      day: { month: 7, day: 24 },
      provider,
      resolveImages: secondResolve,
      previousSnapshot,
      checkedAt: 2_000,
    });

    expect(secondResolve).not.toHaveBeenCalled();
    expect(reused.categories.selected[0].image?.altText).toBe(
      "Cached Apollo alt text",
    );
    expect(reused.categories.selected[0].image?.attribution?.creator).toBe(
      "NASA",
    );

    const forcedResolve = vi.fn(async () =>
      new Map([
        [
          "https://upload.wikimedia.org/apollo.jpg",
          {
            altText: "Refreshed Apollo alt text",
            attribution: {
              sourceTitle: "File:Apollo.jpg",
              sourceUrl: "https://commons.wikimedia.org/wiki/File:Apollo.jpg",
              creator: "NASA Archive",
              licenseName: "Public domain",
            },
          },
        ],
      ]),
    );
    const reResolved = await buildOnThisDaySnapshot({
      day: { month: 7, day: 24 },
      provider,
      resolveImages: forcedResolve,
      previousSnapshot,
      reResolveImages: true,
      checkedAt: 3_000,
    });

    expect(forcedResolve).toHaveBeenCalledTimes(1);
    expect(reResolved.categories.selected[0].image?.altText).toBe(
      "Refreshed Apollo alt text",
    );
  });

  it("skips image metadata lookup during fast cold builds and attaches source fallbacks", async () => {
    const resolveImages = vi.fn();
    const snapshot = await buildOnThisDaySnapshot({
      day: { month: 7, day: 24 },
      provider,
      resolveImages,
      skipImageResolution: true,
    });

    expect(resolveImages).not.toHaveBeenCalled();
    expect(snapshot.categories.selected[0].image?.attribution).toEqual({
      sourceTitle: "File:apollo.jpg",
      sourceUrl: "https://commons.wikimedia.org/wiki/File%3Aapollo.jpg",
    });
  });

  it("decodes Wikimedia HTML entities in event and article text", async () => {
    const encodedProvider: OnThisDayProvider = {
      fetchAll: vi.fn(async () => ({
        selected: [
          {
            year: 2026,
            text: "Rock &amp; roll&nbsp;reached &#169; and &#x1F680;.",
            pages: [{ title: "History &lt;today&gt;" }],
          },
        ],
        events: [],
        births: [],
        deaths: [],
        holidays: [],
      })),
    };

    const snapshot = await buildOnThisDaySnapshot({
      day: { month: 7, day: 30 },
      provider: encodedProvider,
    });

    expect(snapshot.categories.selected[0]).toMatchObject({
      text: "Rock & roll reached © and 🚀.",
      pages: [{ title: "History <today>", slug: "History_<today>" }],
    });
  });

  it("targets en.wikipedia.org rest_v1 and bounds live requests with a timeout", async () => {
    vi.useFakeTimers();
    const fetchMock = vi.fn(
      async (_input: string | URL | Request, init?: RequestInit) =>
        await new Promise<Response>((_resolve, reject) => {
          init?.signal?.addEventListener("abort", () => {
            reject(new DOMException("The operation was aborted", "AbortError"));
          });
        }),
    );
    vi.stubGlobal("fetch", fetchMock);

    try {
      const request = wikipediaRestOnThisDayProvider.fetchAll({
        month: "07",
        day: "30",
      });
      const rejection = expect(request).rejects.toMatchObject({
        name: "AbortError",
      });

      await vi.advanceTimersByTimeAsync(
        WIKIPEDIA_ON_THIS_DAY_REQUEST_TIMEOUT_MS,
      );
      await rejection;
      expect(fetchMock).toHaveBeenCalledWith(
        "https://en.wikipedia.org/api/rest_v1/feed/onthisday/all/07/30",
        expect.objectContaining({ signal: expect.any(AbortSignal) }),
      );
    } finally {
      vi.useRealTimers();
      vi.unstubAllGlobals();
    }
  });

  it("surfaces HTTP 429 status and Retry-After seconds from Wikipedia", async () => {
    const fetchMock = vi.fn(
      async () =>
        new Response("Too many requests", {
          status: 429,
          headers: { "Retry-After": "45" },
        }),
    );
    vi.stubGlobal("fetch", fetchMock);

    try {
      await expect(
        wikipediaRestOnThisDayProvider.fetchAll({ month: "03", day: "05" }),
      ).rejects.toMatchObject({
        name: "OnThisDayUpstreamError",
        status: 429,
        retryAfterSeconds: 45,
      });
      expect(new OnThisDayUpstreamError("rate limited", { status: 429 })).toBeInstanceOf(
        Error,
      );
    } finally {
      vi.unstubAllGlobals();
    }
  });

  it("paginates from the correct end while preserving holiday source order", () => {
    const events = Array.from({ length: 30 }, (_, index) => ({
      id: `events-${index}`,
      year: 1900 + index,
      text: `Event ${index}`,
      pages: [],
    }));
    const holidays = [
      { id: "holiday-z", text: "First source holiday", pages: [] },
      { id: "holiday-a", text: "Second source holiday", pages: [] },
    ];
    const snapshot = {
      schemaVersion: CURRENT_ON_THIS_DAY_SCHEMA_VERSION,
      provider: "wikipedia-rest-v1",
      monthDay: "07-24",
      checkedAt: 5_000,
      sourceUrl: "https://en.wikipedia.org/wiki/July_24",
      categories: {
        selected: [],
        events,
        births: [],
        deaths: [],
        holidays,
      },
      counts: {
        selected: 0,
        events: 30,
        births: 0,
        deaths: 0,
        holidays: 2,
      },
      availableCategories: {
        selected: true,
        events: true,
        births: true,
        deaths: true,
        holidays: true,
      },
    } satisfies OnThisDaySnapshot;

    const newest = paginateOnThisDaySnapshot(snapshot, {
      category: "events",
      order: "newest",
      offset: 0,
      limit: 25,
      checkedAt: 6_000,
      changedAt: 4_000,
      degraded: false,
    });
    expect(newest).toMatchObject({
      calendarDay: "07-24",
      checkedAt: 6_000,
      changedAt: 4_000,
      degraded: false,
      total: 30,
      nextOffset: 25,
    });
    expect(newest.items).toHaveLength(25);
    expect(newest.items.slice(0, 2).map((item) => item.year)).toEqual([
      1929, 1928,
    ]);
    const oldest = paginateOnThisDaySnapshot(snapshot, {
      category: "events",
      order: "oldest",
      offset: 25,
      limit: 25,
    });
    expect(oldest.items.map((item) => item.year)).toEqual([
      1925, 1926, 1927, 1928, 1929,
    ]);
    expect(oldest.nextOffset).toBeNull();

    const holidayPage = paginateOnThisDaySnapshot(snapshot, {
      category: "holidays",
      order: "oldest",
      offset: 0,
      limit: 25,
    });
    expect(holidayPage.order).toBe("newest");
    expect(holidayPage.items.map((item) => item.text)).toEqual([
      "First source holiday",
      "Second source holiday",
    ]);
  });

  it("treats per-URL fallback entries from Wikimedia media lookup as unresolved", async () => {
    const { buildOnThisDaySnapshotWithMeta } = await import("./on-this-day");
    const built = await buildOnThisDaySnapshotWithMeta({
      day: { month: 7, day: 24 },
      provider,
      resolveImages: vi.fn(async () =>
        new Map([
          [
            "https://upload.wikimedia.org/apollo.jpg",
            {
              isFallback: true,
              attribution: {
                sourceTitle: "File:apollo.jpg",
                sourceUrl:
                  "https://commons.wikimedia.org/wiki/File%3Aapollo.jpg",
              },
            },
          ],
        ]),
      ),
      checkedAt: 1_000,
    });

    expect(built.imageResolutionSucceeded).toBe(false);
    expect(
      built.snapshot.categories.selected[0]?.image?.attributionIsFallback,
    ).toBe(true);

    // Next build must NOT reuse the fallback entry and must retry the URL.
    const retryResolve = vi.fn(async () =>
      new Map([
        [
          "https://upload.wikimedia.org/apollo.jpg",
          {
            altText: "Resolved on retry",
            attribution: {
              sourceTitle: "File:Apollo.jpg",
              sourceUrl: "https://commons.wikimedia.org/wiki/File:Apollo.jpg",
              creator: "NASA",
              licenseName: "Public domain",
            },
          },
        ],
      ]),
    );
    const retried = await buildOnThisDaySnapshotWithMeta({
      day: { month: 7, day: 24 },
      provider,
      previousSnapshot: built.snapshot,
      resolveImages: retryResolve,
      checkedAt: 2_000,
    });
    expect(retryResolve).toHaveBeenCalledTimes(1);
    expect(retried.imageResolutionSucceeded).toBe(true);
    expect(
      retried.snapshot.categories.selected[0]?.image?.attributionIsFallback,
    ).toBeUndefined();
    expect(retried.snapshot.categories.selected[0]?.image?.altText).toBe(
      "Resolved on retry",
    );
  });

  it("distinguishes Commons HTTP errors from definitively missing files end-to-end", async () => {
    const { buildOnThisDaySnapshotWithMeta } = await import("./on-this-day");
    const commonsImageUrl =
      "https://upload.wikimedia.org/wikipedia/commons/a/ab/Apollo.jpg";
    const commonsProvider: OnThisDayProvider = {
      fetchAll: vi.fn(async () => ({
        selected: [
          {
            year: 1969,
            text: "Apollo 11 splashed down.",
            pages: [
              {
                titles: { normalized: "Apollo 11" },
                pageid: 6625,
                thumbnail: { source: commonsImageUrl, width: 330, height: 220 },
              },
            ],
          },
        ],
        events: [],
        births: [],
        deaths: [],
        holidays: [],
      })),
    };

    const fetchMock = vi
      .fn<typeof fetch>()
      .mockResolvedValueOnce(
        new Response(null, { status: 503, headers: { "Retry-After": "60" } }),
      )
      .mockResolvedValueOnce(
        new Response(
          JSON.stringify({
            query: {
              pages: {
                "-1": { title: "File:Apollo.jpg", missing: "" },
              },
            },
          }),
          { status: 200 },
        ),
      );
    vi.stubGlobal("fetch", fetchMock);

    try {
      const failedLookup = await buildOnThisDaySnapshotWithMeta({
        day: { month: 7, day: 24 },
        provider: commonsProvider,
        checkedAt: 1_000,
      });
      expect(failedLookup.imageResolutionSucceeded).toBe(false);
      expect(
        failedLookup.snapshot.categories.selected[0]?.image
          ?.attributionIsFallback,
      ).toBe(true);

      const missingFile = await buildOnThisDaySnapshotWithMeta({
        day: { month: 7, day: 24 },
        provider: commonsProvider,
        checkedAt: 2_000,
      });
      expect(missingFile.imageResolutionSucceeded).toBe(true);
      expect(
        missingFile.snapshot.categories.selected[0]?.image
          ?.attributionIsFallback,
      ).toBe(true);
    } finally {
      vi.unstubAllGlobals();
    }
  });

  it("queries On This Day image attribution and alt text without requesting lightbox renditions", async () => {
    const { buildOnThisDaySnapshotWithMeta } = await import("./on-this-day");
    const commonsImageUrl =
      "https://upload.wikimedia.org/wikipedia/commons/thumb/a/ab/Apollo.jpg/330px-Apollo.jpg";
    const enwikiImageUrl =
      "https://upload.wikimedia.org/wikipedia/en/thumb/c/cd/Poster.jpg/330px-Poster.jpg";
    const mixedProvider: OnThisDayProvider = {
      fetchAll: vi.fn(async () => ({
        selected: [
          {
            year: 1969,
            text: "Apollo 11 splashed down.",
            pages: [
              {
                titles: { normalized: "Apollo 11" },
                pageid: 6625,
                thumbnail: { source: commonsImageUrl, width: 330, height: 220 },
              },
            ],
          },
        ],
        events: [
          {
            year: 1977,
            text: "A film premiered.",
            pages: [
              {
                titles: { normalized: "Film" },
                pageid: 999,
                thumbnail: { source: enwikiImageUrl, width: 330, height: 480 },
              },
            ],
          },
        ],
        births: [],
        deaths: [],
        holidays: [],
      })),
    };

    const queriedUrls: URL[] = [];
    const fetchMock = vi.fn<typeof fetch>(async (input) => {
      const url = new URL(String(input));
      queriedUrls.push(url);
      expect(url.searchParams.get("prop")).toBe("imageinfo");
      expect(url.searchParams.get("iiprop")).toBe("url|extmetadata");
      expect(url.searchParams.has("iiurlwidth")).toBe(false);

      if (url.hostname === "commons.wikimedia.org") {
        return Response.json({
          query: {
            pages: [
              {
                title: "File:Apollo.jpg",
                imageinfo: [
                  {
                    descriptionurl:
                      "https://commons.wikimedia.org/wiki/File:Apollo.jpg",
                    extmetadata: {
                      ImageDescription: { value: "Apollo 11 raft." },
                      Artist: { value: "NASA" },
                      LicenseShortName: { value: "Public domain" },
                    },
                  },
                ],
              },
            ],
          },
        });
      }

      return Response.json({
        query: {
          pages: [
            {
              title: "File:Poster.jpg",
              imageinfo: [
                {
                  descriptionurl:
                    "https://en.wikipedia.org/wiki/File:Poster.jpg",
                  extmetadata: {
                    ImageDescription: { value: "Theatrical release poster." },
                    LicenseShortName: { value: "Fair use" },
                  },
                },
              ],
            },
          ],
        },
      });
    });
    vi.stubGlobal("fetch", fetchMock);

    try {
      const built = await buildOnThisDaySnapshotWithMeta({
        day: { month: 7, day: 24 },
        provider: mixedProvider,
        checkedAt: 1_000,
      });

      expect(built.imageResolutionSucceeded).toBe(true);
      expect(queriedUrls.map((url) => url.hostname)).toEqual([
        "commons.wikimedia.org",
        "en.wikipedia.org",
      ]);
      expect(built.snapshot.categories.selected[0]?.image).toMatchObject({
        altText: "Apollo 11 raft.",
        attribution: {
          creator: "NASA",
          licenseName: "Public domain",
          sourceUrl: "https://commons.wikimedia.org/wiki/File:Apollo.jpg",
        },
      });
      expect(built.snapshot.categories.events[0]?.image).toMatchObject({
        altText: "Theatrical release poster.",
        attribution: {
          licenseName: "Fair use",
          sourceUrl: "https://en.wikipedia.org/wiki/File:Poster.jpg",
        },
      });
    } finally {
      vi.unstubAllGlobals();
    }
  });

  it("preserves prior resolved image metadata and signals failure when re-resolution throws", async () => {
    const warnSpy = vi
      .spyOn(console, "warn")
      .mockImplementation(() => undefined);
    try {
      const { buildOnThisDaySnapshotWithMeta } = await import("./on-this-day");
      const previousSnapshot = await buildOnThisDaySnapshot({
        day: { month: 7, day: 24 },
        provider,
        resolveImages: vi.fn(async () =>
          new Map([
            [
              "https://upload.wikimedia.org/apollo.jpg",
              {
                altText: "Verified Apollo alt text",
                attribution: {
                  sourceTitle: "File:Apollo.jpg",
                  sourceUrl:
                    "https://commons.wikimedia.org/wiki/File:Apollo.jpg",
                  creator: "NASA",
                  licenseName: "Public domain",
                },
              },
            ],
          ]),
        ),
        checkedAt: 1_000,
      });

      const rebuilt = await buildOnThisDaySnapshotWithMeta({
        day: { month: 7, day: 24 },
        provider,
        previousSnapshot,
        reResolveImages: true,
        resolveImages: vi.fn(async () => {
          throw new Error("Commons timed out");
        }),
        checkedAt: 2_000,
      });

      expect(rebuilt.imageResolutionSucceeded).toBe(false);
      expect(rebuilt.snapshot.categories.selected[0].image?.altText).toBe(
        "Verified Apollo alt text",
      );
      expect(
        rebuilt.snapshot.categories.selected[0].image?.attribution?.creator,
      ).toBe("NASA");
    } finally {
      warnSpy.mockRestore();
    }
  });

  it("keeps valid events with source-page attribution when metadata resolution fails", async () => {
    const snapshot = await buildOnThisDaySnapshot({
      day: { month: 7, day: 24 },
      provider,
      resolveImages: vi.fn(async () => {
        throw new Error("Wikimedia metadata is temporarily unavailable");
      }),
    });

    expect(snapshot.categories.selected).toHaveLength(1);
    expect(snapshot.categories.selected[0].image?.attribution).toEqual({
      sourceTitle: "File:apollo.jpg",
      sourceUrl: "https://commons.wikimedia.org/wiki/File%3Aapollo.jpg",
    });
  });

  it("discards malformed items, rejects incomplete categories, and builds degraded fallbacks", async () => {
    const malformedProvider: OnThisDayProvider = {
      fetchAll: vi.fn(async () => ({
        selected: [null, { text: 42, pages: [null] }],
        events: [],
        births: [],
        deaths: [],
        holidays: [],
      })),
    };
    const malformed = await buildOnThisDaySnapshot({
      day: { month: 7, day: 24 },
      provider: malformedProvider,
    });
    expect(malformed.counts.selected).toBe(0);

    const incompleteProvider: OnThisDayProvider = {
      fetchAll: vi.fn(async () => ({ selected: [] })),
    };
    await expect(
      buildOnThisDaySnapshot({
        day: { month: 7, day: 24 },
        provider: incompleteProvider,
      }),
    ).rejects.toThrow("missing the events category");

    const degraded = buildFeaturedOnThisDayFallback({
      day: { month: 7, day: 24 },
      items: [{ year: 1969, text: "Apollo 11 returned.", pages: [] }],
      checkedAt: 10_000,
    });
    expect(degraded.provider).toBe("featured-fallback");
    expect(degraded.availableCategories).toEqual({
      selected: true,
      events: false,
      births: false,
      deaths: false,
      holidays: false,
    });
  });
});
