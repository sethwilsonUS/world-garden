import { afterEach, describe, expect, it, vi } from "vitest";
import { enrichDidYouKnowThumbnails } from "./today-snapshot";
import type { WikipediaDidYouKnowItem } from "./featured-article";

const originalFetch = global.fetch;

afterEach(() => {
  global.fetch = originalFetch;
  vi.restoreAllMocks();
});

describe("enrichDidYouKnowThumbnails", () => {
  it("adds page ids and thumbnails to linked Did You Know articles", async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({
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
    });
    global.fetch = fetchMock as unknown as typeof fetch;

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
            },
          },
        ],
      },
    ]);
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it("leaves missing thumbnails and items without links untouched", async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({
        query: {
          pages: {
            "-1": {
              missing: "",
              title: "Missing Article",
            },
          },
        },
      }),
    });
    global.fetch = fetchMock as unknown as typeof fetch;

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
});
