import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";
import {
  TodayOnWikipediaContent,
  type TodayOnWikipediaData,
} from "./TodayOnWikipedia";

vi.mock("@/components/AudioPlayer", () => ({
  AudioPlayer: ({
    title,
    audioUrl,
    playbackRate,
    onPlaybackRateChange,
  }: {
    title: string;
    audioUrl: string;
    playbackRate?: number;
    onPlaybackRateChange?: (rate: number) => void;
  }) =>
    createElement(
      "div",
      {
        "data-audio-url": audioUrl,
        "data-rate": playbackRate,
        "data-can-change-rate": String(Boolean(onPlaybackRateChange)),
      },
      `Audio: ${title} @${playbackRate ?? "missing"}`,
    ),
}));

const imageTagsFor = (markup: string, source: string): string[] =>
  Array.from(markup.matchAll(/<img\b[^>]*>/g), ([tag]) => tag).filter((tag) =>
    tag.includes(`src="${source}"`),
  );

const expectSingleCoverImage = (markup: string, source: string): string => {
  const imageTags = imageTagsFor(markup, source);

  expect(imageTags).toHaveLength(1);
  expect(imageTags[0]).toMatch(/\bobject-cover\b/);
  expect(imageTags[0]).not.toMatch(/\bobject-contain\b/);

  return imageTags[0];
};

describe("TodayOnWikipediaContent", () => {
  it("renders the daily digest with full Did You Know, thumbnails, stale callout, and compact trending", () => {
    const markup = renderToStaticMarkup(
      createElement(TodayOnWikipediaContent, {
        data: {
          snapshotFeedDate: "2026-05-07",
          snapshotGeneratedAt: 1_778_200_000_000,
          snapshotIsStale: true,
          tfa: {
            title: "First Treaty of London",
            extract:
              "The First Treaty of London was formally agreed on 8 May 1358 at Windsor Castle in England.",
            thumbnail: {
              source: "https://upload.wikimedia.org/tfa.jpg",
              width: 960,
              height: 672,
            },
          },
          inTheNews: [
            {
              story:
                "American media proprietor and philanthropist Ted Turner dies at the age of 87.",
              links: [
                {
                  title: "Ted Turner",
                  slug: "Ted_Turner",
                  wikiPageId: "30475",
                  thumbnail: {
                    source: "https://upload.wikimedia.org/ted.jpg",
                    width: 330,
                    height: 220,
                  },
                },
              ],
            },
          ],
          didYouKnow: [
            {
              text: "... that the U.S. Supreme Court visited the Lenox Lyceum?",
              links: [
                {
                  title: "Lenox Lyceum",
                  slug: "Lenox_Lyceum",
                  text: "Lenox Lyceum",
                  wikiPageId: "123",
                  thumbnail: {
                    source: "https://upload.wikimedia.org/lenox.jpg",
                    width: 960,
                    height: 540,
                  },
                },
              ],
              segments: [
                {
                  type: "text",
                  text: "... that the U.S. Supreme Court visited the ",
                },
                {
                  type: "link",
                  title: "Lenox Lyceum",
                  slug: "Lenox_Lyceum",
                  text: "Lenox Lyceum",
                },
                { type: "text", text: "?" },
              ],
            },
            {
              text: "... that a second fact keeps the full list visible?",
              links: [],
              segments: [
                {
                  type: "text",
                  text: "... that a second fact keeps the full list visible?",
                },
              ],
            },
          ],
          didYouKnowAudio: {
            feedDate: "2026-05-07",
            title: "Did You Know? May 7, 2026",
            status: "ready",
            audioUrl: "https://cdn.example.com/dyk.mp3",
            durationSeconds: 180,
          },
          trending: [
            {
              title: "Vijay (actor)",
              extract:
                "Chandrasekaran Joseph Vijay is an Indian actor and politician.",
              views: 373000,
              thumbnail: {
                source: "https://upload.wikimedia.org/trending-vijay.jpg",
                width: 330,
                height: 495,
              },
            },
            {
              title: "Second trend",
              extract: "The second compact trending item.",
              views: 200000,
            },
            {
              title: "Third trend",
              extract: "The third compact trending item.",
              views: 100000,
            },
            {
              title: "Fourth trend",
              extract: "The fourth compact trending item.",
              views: 50000,
            },
            {
              title: "Fifth trend should be hidden",
              extract: "This item belongs on the dedicated Trending page.",
              views: 40000,
            },
          ],
          trendingDate: "2026-05-07Z",
          trendingBrief: {
            audioUrl: "https://cdn.example.com/trending.mp3",
            headline: "Why these topics are trending today",
            durationSeconds: 210,
          },
          onThisDay: [
            {
              year: 1984,
              text: "The Soviet Union announced the boycott of the Summer Olympics in Los Angeles.",
              pages: [
                {
                  title: "1984 Summer Olympics boycott",
                  slug: "1984_Summer_Olympics_boycott",
                  wikiPageId: "12813736",
                  thumbnail: {
                    source: "https://upload.wikimedia.org/on-this-day.jpg",
                    width: 330,
                    height: 495,
                  },
                },
              ],
            },
          ],
          pictureOfDay: {
            title: "File:Hoverfly May 2008-8.jpg",
            pictureKey: "File:Hoverfly May 2008-8.jpg",
            altText: "A Marmelade fly on flight.",
            description: "A Marmelade fly on flight.",
            artist: "Alvesgaspar",
            credit: "Own work",
            filePage:
              "https://commons.wikimedia.org/wiki/File:Hoverfly_May_2008-8.jpg",
            thumbnail: {
              source: "https://upload.wikimedia.org/thumb.jpg",
              width: 640,
              height: 427,
            },
            license: {
              type: "CC BY-SA 3.0",
              url: "https://creativecommons.org/licenses/by-sa/3.0",
            },
            audio: {
              status: "ready",
              audioUrl: "https://cdn.example.com/picture.mp3",
              durationSeconds: 42,
            },
          },
        } as TodayOnWikipediaData & { didYouKnowAudio: unknown },
      }),
    );

    expect(markup).toContain("Today on Wikipedia");
    expect(markup).toContain(
      "Showing the latest cached edition from May 7, 2026",
    );

    // Today's picks: featured, picture of the day, and the audio brief share
    // one equal-height row of cover-image cards.
    expect(markup).toContain("data-today-picks");
    expect(markup).toContain("Featured article");
    expect(markup).toContain("First Treaty of London");
    expectSingleCoverImage(markup, "https://upload.wikimedia.org/tfa.jpg");
    expect(
      markup.match(/href="\/article\/First_Treaty_of_London"/g)?.length,
    ).toBe(1);
    expect(markup).toContain("line-clamp-4");
    expect(markup).toContain("Picture of the day");
    expect(markup).toContain("A Marmelade fly on flight.");
    expect(markup).toMatch(
      /<img[^>]*(?=[^>]*alt="A Marmelade fly on flight\.")(?=[^>]*class="[^"]*\bobject-cover\b[^"]*")(?=[^>]*src="https:\/\/upload\.wikimedia\.org\/thumb\.jpg")[^>]*>/,
    );
    expect(markup).toContain("Listen to the description");
    expect(markup).toContain("Audio: Picture of the Day description @1");
    expect(markup).toContain('data-can-change-rate="true"');
    expect(markup).toContain("Daily audio brief");
    expect(markup).toContain("AI-generated daily audio briefing");
    expect(markup).toContain("Why these topics are trending today");

    // Credits stay available (CC BY-SA) behind a small disclosure.
    expect(markup).toContain("Image credit");
    expect(markup).toContain("Alvesgaspar");
    expect(markup).toContain("CC BY-SA 3.0");

    // The daily feed is text-first: no thumbnails or duplicate chip links.
    expect(markup).toContain("data-today-feed");
    expect(markup).toContain("In the news");
    expect(markup).toContain("Ted Turner");
    expect(markup).not.toContain("https://upload.wikimedia.org/ted.jpg");
    expect(markup).toContain("Did you know?");
    expect(markup).toContain("Lenox Lyceum");
    expect(markup).not.toContain("https://upload.wikimedia.org/lenox.jpg");
    expect(markup).toContain("1984");
    expect(markup).not.toContain(
      "https://upload.wikimedia.org/on-this-day.jpg",
    );
    expect(markup).not.toContain(
      "rounded-full border border-accent-border bg-accent-bg",
    );
    expect(markup).not.toContain("Image for ");
    expect(markup).not.toContain(">Daily audio</p>");
    expect(markup).not.toContain("Audio: Did You Know? May 7, 2026 @1");

    // Trending: four clamped cards.
    expect(markup).toContain("Trending now");
    expect(markup).toContain("Vijay (actor)");
    expect(
      expectSingleCoverImage(
        markup,
        "https://upload.wikimedia.org/trending-vijay.jpg",
      ),
    ).toContain("object-[50%_30%]");
    expect(markup).toContain("Fourth trend");
    expect(markup).not.toContain("Fifth trend should be hidden");
    expect(markup).toContain("373 thousand");
    expect(markup).toContain("Most read on May 7, 2026");
    expect(markup).toContain("line-clamp-3");
    expect(markup).not.toContain('data-adaptive-image-mode="backdrop"');
    expect(markup).not.toContain("object-contain");

    const featuredIndex = markup.indexOf("Featured article");
    const pictureIndex = markup.indexOf("Picture of the day");
    const briefIndex = markup.indexOf("Daily audio brief");
    const didYouKnowIndex = markup.indexOf("Did you know?");
    const newsIndex = markup.indexOf("In the news");
    const onThisDayIndex = markup.indexOf("On this day");
    const trendingHeadingIndex = markup.indexOf("Trending now");
    const firstTrendIndex = markup.indexOf("Vijay (actor)");

    expect(featuredIndex).toBeGreaterThan(-1);
    expect(pictureIndex).toBeGreaterThan(featuredIndex);
    expect(briefIndex).toBeGreaterThan(pictureIndex);
    expect(didYouKnowIndex).toBeGreaterThan(briefIndex);
    expect(newsIndex).toBeGreaterThan(didYouKnowIndex);
    expect(onThisDayIndex).toBeGreaterThan(newsIndex);
    expect(trendingHeadingIndex).toBeGreaterThan(onThisDayIndex);
    expect(firstTrendIndex).toBeGreaterThan(trendingHeadingIndex);
  });

  it("renders a polite pending status instead of an audio player", () => {
    const markup = renderToStaticMarkup(
      createElement(TodayOnWikipediaContent, {
        data: {
          inTheNews: [],
          onThisDay: [],
          pictureOfDay: {
            title: "File:Hoverfly May 2008-8.jpg",
            pictureKey: "File:Hoverfly May 2008-8.jpg",
            altText: "A Marmelade fly on flight.",
            description: "A Marmelade fly on flight.",
            audio: { status: "pending", audioUrl: null },
          },
        },
      }),
    );

    expect(markup).toContain("Picture audio is being prepared");
    expect(markup).not.toContain("Audio: Picture of the Day description");
  });

  it("renders a polite failed status instead of an audio player", () => {
    const markup = renderToStaticMarkup(
      createElement(TodayOnWikipediaContent, {
        data: {
          inTheNews: [],
          onThisDay: [],
          pictureOfDay: {
            title: "File:Hoverfly May 2008-8.jpg",
            pictureKey: "File:Hoverfly May 2008-8.jpg",
            altText: "A Marmelade fly on flight.",
            description: "A Marmelade fly on flight.",
            audio: {
              status: "failed",
              audioUrl: null,
              lastError: "TTS timeout",
            },
          },
        },
      }),
    );

    expect(markup).toContain("Picture audio is not available right now");
    expect(markup).not.toContain("Audio: Picture of the Day description");
  });

  it("offers the podcasts card when today's audio brief isn't ready", () => {
    const markup = renderToStaticMarkup(
      createElement(TodayOnWikipediaContent, {
        data: {
          tfa: {
            title: "Ice Warrior",
            extract: "The Ice Warriors are a fictional race.",
          },
        },
      }),
    );

    expect(markup).toContain("Daily podcasts");
    expect(markup).toContain('href="/podcasts"');
    expect(markup).not.toContain("Daily audio brief");
  });

  it("previews three On This Day highlights and links to the full timeline", () => {
    const markup = renderToStaticMarkup(
      createElement(TodayOnWikipediaContent, {
        data: {
          onThisDay: Array.from({ length: 4 }, (_, index) => ({
            year: 2000 + index,
            text: `Historical highlight ${index + 1}`,
            pages: [],
          })),
        },
      }),
    );

    expect(markup).toContain("Historical highlight 1");
    expect(markup).toContain("Historical highlight 2");
    expect(markup).toContain("Historical highlight 3");
    expect(markup).not.toContain("Historical highlight 4");
    expect(markup).toContain('href="/on-this-day"');
    expect(markup).toContain("Explore all 4 highlights");
  });
});
