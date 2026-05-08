import { describe, expect, it } from "vitest";
import {
  isMostReadDateStale,
  parseDidYouKnowItem,
  parseInTheNewsItem,
  parseOnThisDayItem,
  parsePictureOfDay,
} from "./featured-article";

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
        },
      ],
    });
  });
});
