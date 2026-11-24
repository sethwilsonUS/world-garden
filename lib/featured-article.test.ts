import { afterEach, describe, expect, it, vi } from "vitest";
import {
  fetchWikipediaFeaturedSnapshot,
  isMostReadDateStale,
  parseDidYouKnowItem,
  parseInTheNewsItem,
  parseOnThisDayItem,
  parsePictureOfDay,
} from "./featured-article";
import { WIKIMEDIA_FEED_THUMBNAIL_WIDTH } from "./wikimedia-media";

afterEach(() => {
  vi.restoreAllMocks();
});

describe("isMostReadDateStale", () => {
  it("allows normal most-read lag from Wikipedia analytics", () => {
    expect(
      isMostReadDateStale({
        feedDate: "2026/04/20",
        trendingDate: "2026-04-18Z",
      }),
    ).toBe(false);
  });

  it("flags a most-read date that is several days behind the feed date", () => {
    expect(
      isMostReadDateStale({
        feedDate: "2026/04/20",
        trendingDate: "2026-04-16Z",
      }),
    ).toBe(true);
  });
});

describe("parseDidYouKnowItem", () => {
  it("converts Wikipedia article links into internal slug segments", () => {
    const item = parseDidYouKnowItem({
      html:
        '... that, by establishing diplomatic missions like <b><a href="https://en.wikipedia.org/wiki/Embassy_of_the_Philippines,_Suva">an embassy in Fiji</a></b>, the Philippine government hopes to play a bigger role in international politics?',
      text:
        "... that, by establishing diplomatic missions like an embassy in Fiji, the Philippine government hopes to play a bigger role in international politics?",
    });

    expect(item).toEqual({
      text:
        "... that, by establishing diplomatic missions like an embassy in Fiji, the Philippine government hopes to play a bigger role in international politics?",
      links: [
        {
          title: "Embassy of the Philippines, Suva",
          slug: "Embassy_of_the_Philippines,_Suva",
          text: "an embassy in Fiji",
        },
      ],
      segments: [
        {
          type: "text",
          text: "... that, by establishing diplomatic missions like ",
        },
        {
          type: "link",
          text: "an embassy in Fiji",
          title: "Embassy of the Philippines, Suva",
          slug: "Embassy_of_the_Philippines,_Suva",
        },
        {
          type: "text",
          text: ", the Philippine government hopes to play a bigger role in international politics?",
        },
      ],
    });
  });

  it("treats blocked namespaces as plain text instead of internal links", () => {
    const item = parseDidYouKnowItem({
      html:
        '... that <a href="https://en.wikipedia.org/wiki/Template:Foo">this template reference</a> should not become an article link?',
      text:
        "... that this template reference should not become an article link?",
    });

    expect(item?.links).toEqual([]);
    expect(item?.segments).toEqual([
      {
        type: "text",
        text: "... that this template reference should not become an article link?",
      },
    ]);
  });

  it("falls back to plain text when no HTML is provided", () => {
    const item = parseDidYouKnowItem({
      text: "... that Curio Garden now has a trivia page?",
    });

    expect(item).toEqual({
      text: "... that Curio Garden now has a trivia page?",
      links: [],
      segments: [
        {
          type: "text",
          text: "... that Curio Garden now has a trivia page?",
        },
      ],
    });
  });
});

describe("featured feed extras", () => {
  it("normalizes In the News stories and article links", () => {
    const item = parseInTheNewsItem({
      story:
        'American media proprietor and philanthropist <b>Ted Turner</b> dies at the age of 87.',
      links: [
        {
          pageid: 30475,
          title: "Ted Turner",
          titles: { normalized: "Ted Turner" },
          thumbnail: {
            source: "https://upload.wikimedia.org/ted.jpg",
            width: 320,
            height: 180,
          },
        },
      ],
    });

    expect(item).toEqual({
      story:
        "American media proprietor and philanthropist Ted Turner dies at the age of 87.",
      links: [
        {
          title: "Ted Turner",
          slug: "Ted_Turner",
          wikiPageId: "30475",
          thumbnail: {
            source: "https://upload.wikimedia.org/ted.jpg",
            width: 320,
            height: 180,
          },
        },
      ],
    });
  });

  it("preserves Wikipedia picture callouts and thumbnail metadata for In the News", () => {
    const item = parseInTheNewsItem({
      story:
        "A hantavirus outbreak on the cruise ship <i>MV Hondius</i> (pictured) forces most of the remaining passengers to quarantine on board.",
      links: [
        {
          pageid: 123,
          title: "MV Hondius",
          titles: { normalized: "MV Hondius" },
          thumbnail: {
            source: "https://upload.wikimedia.org/hondius.jpg",
            width: 330,
            height: 220,
          },
        },
      ],
    });

    expect(item?.story).toBe(
      "A hantavirus outbreak on the cruise ship MV Hondius (pictured) forces most of the remaining passengers to quarantine on board.",
    );
    expect(item?.links[0]?.thumbnail?.source).toBe(
      "https://upload.wikimedia.org/hondius.jpg",
    );
  });

  it("normalizes Picture of the Day metadata for accessible display", () => {
    const picture = parsePictureOfDay({
      title: "File:Hoverfly May 2008-8.jpg",
      thumbnail: {
        source: "https://upload.wikimedia.org/thumb.jpg",
        width: 640,
        height: 427,
      },
      image: {
        source: "https://upload.wikimedia.org/original.jpg",
        width: 3000,
        height: 2000,
      },
      file_page: "https://commons.wikimedia.org/wiki/File:Hoverfly_May_2008-8.jpg",
      description: {
        html: "A <i>Marmelade fly</i> on flight.",
        text: "A Marmelade fly on flight.",
      },
      artist: { text: "Alvesgaspar" },
      credit: { html: "<span>Own work</span>", text: "Own work" },
      license: {
        type: "CC BY-SA 3.0",
        code: "cc-by-sa-3.0",
        url: "https://creativecommons.org/licenses/by-sa/3.0",
      },
    });

    expect(picture).toEqual({
      title: "File:Hoverfly May 2008-8.jpg",
      pictureKey: "File:Hoverfly May 2008-8.jpg",
      altText: "A Marmelade fly on flight.",
      thumbnail: {
        source: "https://upload.wikimedia.org/thumb.jpg",
        width: 640,
        height: 427,
      },
      image: {
        source: "https://upload.wikimedia.org/original.jpg",
        width: 3000,
        height: 2000,
      },
      filePage: "https://commons.wikimedia.org/wiki/File:Hoverfly_May_2008-8.jpg",
      description: "A Marmelade fly on flight.",
      artist: "Alvesgaspar",
      credit: "Own work",
      license: {
        type: "CC BY-SA 3.0",
        code: "cc-by-sa-3.0",
        url: "https://creativecommons.org/licenses/by-sa/3.0",
      },
    });
  });

  it("normalizes On This Day items with linked pages", () => {
    const item = parseOnThisDayItem({
      year: 1984,
      text: "The Soviet Union announced the boycott of the Summer Olympics in Los Angeles.",
      pages: [
        {
          pageid: 12813736,
          title: "1984 Summer Olympics boycott",
          titles: { normalized: "1984 Summer Olympics boycott" },
          thumbnail: {
            source: "https://upload.wikimedia.org/olympics.jpg",
            width: 330,
            height: 220,
          },
        },
      ],
    });

    expect(item).toEqual({
      year: 1984,
      text: "The Soviet Union announced the boycott of the Summer Olympics in Los Angeles.",
      pages: [
        {
          title: "1984 Summer Olympics boycott",
          slug: "1984_Summer_Olympics_boycott",
          wikiPageId: "12813736",
          thumbnail: {
            source: "https://upload.wikimedia.org/olympics.jpg",
            width: 330,
            height: 220,
          },
        },
      ],
    });
  });
});

describe("fetchWikipediaFeaturedSnapshot", () => {
  it("resolves normalized and redirected Pageviews Trending candidates, uses canonical pithumbsize, and routes /wikipedia/en/ attributions to enwiki", async () => {
    const tfaThumb =
      "https://upload.wikimedia.org/wikipedia/en/f/f6/Album_Cover.png";
    const wwiiThumb =
      "https://upload.wikimedia.org/wikipedia/commons/thumb/a/ab/WWII_Map.jpg/500px-WWII_Map.jpg";
    const nycThumb =
      "https://upload.wikimedia.org/wikipedia/en/thumb/b/bc/NYC_Poster.jpg/500px-NYC_Poster.jpg";

    const imageInfoHosts: Array<{ host: string; titles: string | null }> = [];
    let trendingDetailThumbSize: string | null = null;

    vi.spyOn(globalThis, "fetch").mockImplementation(async (input) => {
      const url = new URL(String(input));

      if (url.pathname.startsWith("/api/rest_v1/feed/featured/")) {
        return Response.json({
          tfa: {
            pageid: 1001,
            title: "1989 (Taylor Swift album)",
            titles: { normalized: "1989 (Taylor Swift album)" },
            extract: "Studio album.",
            thumbnail: { source: tfaThumb, width: 300, height: 300 },
          },
          mostread: {
            date: "2026-04-10Z",
            articles: [{ title: "Stale Article", extract: "Old", views: 10 }],
          },
        });
      }

      if (url.pathname.startsWith("/api/rest_v1/metrics/pageviews/top/")) {
        return Response.json({
          items: [
            {
              year: "2026",
              month: "04",
              day: "19",
              articles: [
                { article: "wwii", views: 180_000, rank: 1 },
                { article: "World_War_II", views: 120_000, rank: 2 },
                { article: "NYC", views: 95_000, rank: 3 },
              ],
            },
          ],
        });
      }

      if (
        url.hostname === "en.wikipedia.org" &&
        url.searchParams.get("prop") === "extracts|pageimages|info"
      ) {
        trendingDetailThumbSize = url.searchParams.get("pithumbsize");
        expect(url.searchParams.get("redirects")).toBe("1");
        return Response.json({
          query: {
            normalized: [{ from: "wwii", to: "Wwii" }],
            redirects: [
              { from: "Wwii", to: "World War II" },
              { from: "NYC", to: "New York City" },
            ],
            pages: [
              {
                pageid: 32927,
                ns: 0,
                title: "World War II",
                extract: "Global conflict from 1939 to 1945.",
                thumbnail: { source: wwiiThumb, width: 500, height: 333 },
              },
              {
                pageid: 645042,
                ns: 0,
                title: "New York City",
                extract: "Most populous city in the United States.",
                thumbnail: { source: nycThumb, width: 500, height: 375 },
              },
            ],
          },
        });
      }

      if (url.searchParams.get("prop") === "imageinfo") {
        expect(url.searchParams.has("iiurlwidth")).toBe(false);
        imageInfoHosts.push({
          host: url.hostname,
          titles: url.searchParams.get("titles"),
        });

        if (url.hostname === "commons.wikimedia.org") {
          return Response.json({
            query: {
              pages: [
                {
                  title: "File:WWII Map.jpg",
                  imageinfo: [
                    {
                      descriptionurl:
                        "https://commons.wikimedia.org/wiki/File:WWII_Map.jpg",
                      extmetadata: {
                        Artist: { value: "Cartographer" },
                        LicenseShortName: { value: "CC BY-SA 4.0" },
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
                title: "File:Album Cover.png",
                imageinfo: [
                  {
                    descriptionurl:
                      "https://en.wikipedia.org/wiki/File:Album_Cover.png",
                    extmetadata: {
                      Credit: { value: "Album cover art" },
                      LicenseShortName: { value: "Fair use" },
                    },
                  },
                ],
              },
              {
                title: "File:NYC Poster.jpg",
                imageinfo: [
                  {
                    descriptionurl:
                      "https://en.wikipedia.org/wiki/File:NYC_Poster.jpg",
                    extmetadata: {
                      Credit: { value: "Local poster" },
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

    const snapshot = await fetchWikipediaFeaturedSnapshot(
      new Date(Date.UTC(2026, 3, 20, 12, 0, 0)),
    );

    expect(trendingDetailThumbSize).toBe(String(WIKIMEDIA_FEED_THUMBNAIL_WIDTH));
    expect(snapshot.trendingSourceType).toBe("pageviews-top");
    expect(snapshot.trendingCandidates).toEqual([
      {
        title: "World War II",
        extract: "Global conflict from 1939 to 1945.",
        views: 180_000,
        thumbnail: {
          source: wwiiThumb,
          width: 500,
          height: 333,
          attribution: {
            creator: "Cartographer",
            credit: undefined,
            licenseName: "CC BY-SA 4.0",
            licenseUrl: undefined,
            sourceTitle: "File:WWII Map.jpg",
            sourceUrl: "https://commons.wikimedia.org/wiki/File:WWII_Map.jpg",
          },
        },
      },
      {
        title: "New York City",
        extract: "Most populous city in the United States.",
        views: 95_000,
        thumbnail: {
          source: nycThumb,
          width: 500,
          height: 375,
          attribution: {
            creator: undefined,
            credit: "Local poster",
            licenseName: "Fair use",
            licenseUrl: undefined,
            sourceTitle: "File:NYC Poster.jpg",
            sourceUrl: "https://en.wikipedia.org/wiki/File:NYC_Poster.jpg",
          },
        },
      },
    ]);
    expect(snapshot.tfa?.thumbnail?.attribution).toMatchObject({
      credit: "Album cover art",
      licenseName: "Fair use",
      sourceUrl: "https://en.wikipedia.org/wiki/File:Album_Cover.png",
    });
    expect(imageInfoHosts).toEqual([
      { host: "commons.wikimedia.org", titles: "File:WWII Map.jpg" },
      {
        host: "en.wikipedia.org",
        titles: "File:Album Cover.png|File:NYC Poster.jpg",
      },
    ]);
  });

  it("keeps case-distinct titles separate when another title redirects through a differently cased variant", async () => {
    vi.spyOn(globalThis, "fetch").mockImplementation(async (input) => {
      const url = new URL(String(input));

      if (url.pathname.startsWith("/api/rest_v1/feed/featured/")) {
        return Response.json({
          mostread: {
            date: "2026-04-10Z",
            articles: [{ title: "Stale Article", extract: "Old", views: 10 }],
          },
        });
      }

      if (url.pathname.startsWith("/api/rest_v1/metrics/pageviews/top/")) {
        return Response.json({
          items: [
            {
              year: "2026",
              month: "04",
              day: "19",
              articles: [
                { article: "The_Notion_Club_Papers", views: 110_000, rank: 1 },
                { article: "So_Long,_London", views: 90_000, rank: 2 },
              ],
            },
          ],
        });
      }

      if (
        url.hostname === "en.wikipedia.org" &&
        url.searchParams.get("prop") === "extracts|pageimages|info"
      ) {
        return Response.json({
          query: {
            redirects: [
              { from: "The Notion Club Papers", to: "So long, London" },
              { from: "So long, London", to: "The Sword of Damocles" },
              { from: "The Sword of Damocles", to: "Book of Jasher" },
            ],
            pages: [
              {
                pageid: 1001,
                ns: 0,
                title: "So Long, London",
                extract: "Track five from The Tortured Poets Department.",
              },
              {
                pageid: 1002,
                ns: 0,
                title: "Book of Jasher",
                extract: "Non-canonical book referenced in the Hebrew Bible.",
              },
            ],
          },
        });
      }

      throw new Error(`Unexpected URL: ${url.toString()}`);
    });

    const snapshot = await fetchWikipediaFeaturedSnapshot(
      new Date(Date.UTC(2026, 3, 20, 12, 0, 0)),
    );

    expect(snapshot.trendingCandidates).toEqual([
      {
        title: "Book of Jasher",
        extract: "Non-canonical book referenced in the Hebrew Bible.",
        views: 110_000,
        thumbnail: undefined,
      },
      {
        title: "So Long, London",
        extract: "Track five from The Tortured Poets Department.",
        views: 90_000,
        thumbnail: undefined,
      },
    ]);
  });
});
