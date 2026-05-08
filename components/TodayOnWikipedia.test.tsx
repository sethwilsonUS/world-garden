import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";
import { TodayOnWikipediaContent } from "./TodayOnWikipedia";

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

describe("TodayOnWikipediaContent", () => {
  it("renders featured, news, trending, picture metadata, and ready picture audio", () => {
    const markup = renderToStaticMarkup(
      createElement(TodayOnWikipediaContent, {
        data: {
          tfa: {
            title: "First Treaty of London",
            extract:
              "The First Treaty of London was formally agreed on 8 May 1358 at Windsor Castle in England.",
            thumbnail: {
              source: "https://upload.wikimedia.org/tfa.jpg",
              width: 640,
              height: 360,
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
          trending: [
            {
              title: "Vijay (actor)",
              extract:
                "Chandrasekaran Joseph Vijay is an Indian actor and politician.",
              views: 373000,
              thumbnail: {
                source: "https://upload.wikimedia.org/trending-vijay.jpg",
                width: 640,
                height: 360,
              },
            },
          ],
          trendingDate: "2026-05-07Z",
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
                    height: 440,
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
        },
      }),
    );

    expect(markup).toContain("Today on Wikipedia");
    expect(markup).toContain("Featured article");
    expect(markup).toContain("First Treaty of London");
    expect(
      markup.match(/href="\/article\/First_Treaty_of_London"/g)?.length,
    ).toBe(1);
    expect(markup).toContain("In the News");
    expect(markup).toContain("Ted Turner");
    expect(markup).toContain("https://upload.wikimedia.org/ted.jpg");
    expect(markup).toContain("Image for Ted Turner");
    expect(markup).toContain("Trending");
    expect(markup).toContain("Vijay (actor)");
    expect(markup).toContain("https://upload.wikimedia.org/trending-vijay.jpg");
    expect(markup).toContain("373 thousand");
    expect(markup).toContain("Last updated: May 7, 2026");
    expect(markup).toContain("A Marmelade fly on flight.");
    expect(markup).toContain("Alvesgaspar");
    expect(markup).toContain("CC BY-SA 3.0");
    expect(markup).toContain("Audio: Picture of the Day description @1");
    expect(markup).toContain('data-can-change-rate="true"');
    expect(markup).toContain("1984");
    expect(markup).toContain("https://upload.wikimedia.org/on-this-day.jpg");
    expect(markup).toContain("Image for 1984 Summer Olympics boycott");
    expect(markup).toContain('width="330"');
    expect(markup).toContain('height="440"');
    expect(markup).toContain("object-contain");
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
});
