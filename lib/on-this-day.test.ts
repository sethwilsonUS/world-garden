import { describe, expect, it, vi } from "vitest";
import {
  buildOnThisDaySnapshot,
  paginateOnThisDaySnapshot,
  WIKIFEEDS_REQUEST_TIMEOUT_MS,
  wikifeedsOnThisDayProvider,
  type OnThisDayFeedPayload,
  type OnThisDayProvider,
} from "./on-this-day";
import type { OnThisDaySnapshot } from "./on-this-day-contracts";

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
      feedDate: "2026-07-24",
      provider,
      resolveImages,
      generatedAt: 1_779_000_000_000,
    });

    expect(provider.fetchAll).toHaveBeenCalledWith({ month: "07", day: "24" });
    expect(snapshot).toMatchObject({
      schemaVersion: 1,
      provider: "wikifeeds-v1",
      feedDate: "2026-07-24",
      monthDay: "07-24",
      generatedAt: 1_779_000_000_000,
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
      feedDate: "2026-07-24",
      provider,
      resolveImages,
      generatedAt: 1_779_000_000_100,
    });
    expect(rebuilt.categories.selected[0].id).toBe(
      snapshot.categories.selected[0].id,
    );
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
      feedDate: "2026-07-30",
      provider: encodedProvider,
    });

    expect(snapshot.categories.selected[0]).toMatchObject({
      text: "Rock & roll reached © and 🚀.",
      pages: [{ title: "History <today>", slug: "History_<today>" }],
    });
  });

  it("bounds live Wikifeeds requests so a visitor cannot wait indefinitely", async () => {
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
      const request = wikifeedsOnThisDayProvider.fetchAll({
        month: "07",
        day: "30",
      });
      const rejection = expect(request).rejects.toMatchObject({
        name: "AbortError",
      });

      await vi.advanceTimersByTimeAsync(WIKIFEEDS_REQUEST_TIMEOUT_MS);
      await rejection;
      expect(fetchMock).toHaveBeenCalledWith(
        "https://api.wikimedia.org/feed/v1/wikipedia/en/onthisday/all/07/30",
        expect.objectContaining({ signal: expect.any(AbortSignal) }),
      );
    } finally {
      vi.useRealTimers();
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
      schemaVersion: 1,
      provider: "wikifeeds-v1",
      feedDate: "2026-07-24",
      monthDay: "07-24",
      generatedAt: 1,
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
      requestedDate: "2026-07-24",
      category: "events",
      order: "newest",
      offset: 0,
      limit: 25,
    });
    expect(newest).toMatchObject({
      requestedDate: "2026-07-24",
      snapshotDate: "2026-07-24",
      snapshotIsStale: false,
      total: 30,
      nextOffset: 25,
    });
    expect(newest.items).toHaveLength(25);
    expect(newest.items.slice(0, 2).map((item) => item.year)).toEqual([
      1929, 1928,
    ]);
    const oldest = paginateOnThisDaySnapshot(snapshot, {
      requestedDate: "2026-07-24",
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
      requestedDate: "2026-07-24",
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

  it("keeps valid events with source-page attribution when metadata resolution fails", async () => {
    const snapshot = await buildOnThisDaySnapshot({
      feedDate: "2026-07-24",
      provider,
      resolveImages: vi.fn(async () => {
        throw new Error("Wikimedia metadata is temporarily unavailable");
      }),
    });

    expect(snapshot.categories.selected).toHaveLength(1);
    expect(snapshot.categories.selected[0].image?.attribution).toEqual({
      sourceTitle: "File:apollo.jpg",
      sourceUrl:
        "https://commons.wikimedia.org/wiki/File%3Aapollo.jpg",
    });
  });

  it("discards malformed items but rejects an incomplete category contract", async () => {
    const malformedProvider: OnThisDayProvider = {
      fetchAll: vi.fn(async () =>
        ({
          selected: [null, { text: 42, pages: [null] }],
          events: [],
          births: [],
          deaths: [],
          holidays: [],
        }) as unknown as OnThisDayFeedPayload),
    };
    const malformed = await buildOnThisDaySnapshot({
      feedDate: "2026-07-24",
      provider: malformedProvider,
    });
    expect(malformed.counts.selected).toBe(0);

    const incompleteProvider: OnThisDayProvider = {
      fetchAll: vi.fn(async () => ({ selected: [] })),
    };
    await expect(
      buildOnThisDaySnapshot({
        feedDate: "2026-07-24",
        provider: incompleteProvider,
      }),
    ).rejects.toThrow("missing the events category");
  });
});
