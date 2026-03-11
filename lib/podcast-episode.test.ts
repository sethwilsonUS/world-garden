import { describe, expect, it } from "vitest";
import {
  getPodcastSectionSources,
  hasCurrentFeaturedArtworkVersion,
  shouldReuseExistingFeaturedEpisode,
} from "./podcast-episode";

describe("getPodcastSectionSources", () => {
  it("uses only full-audio sections for the featured podcast", () => {
    const result = getPodcastSectionSources({
      _id: "article-1" as never,
      wikiPageId: "123",
      title: "Example article",
      language: "en",
      revisionId: "1",
      lastEdited: "2026-03-10T00:00:00Z",
      summary: "Lead summary with enough content to speak aloud.",
      contentText: "unused",
      sections: [
        {
          title: "History",
          level: 2,
          content:
            "The city rebuilt its harbor after the storm. Officials later expanded the rail connection to the capital.",
          audioMode: "full",
          audioReason: "eligible",
        },
        {
          title: "Results",
          level: 2,
          content: [
            "Year  Candidate  Vote",
            "2020  Rivera     51.2%",
            "2022  Patel      49.8%",
          ].join("\n"),
          audioMode: "unavailable",
          audioReason: "table_like",
        },
      ],
    });

    expect(result).toEqual([
      {
        sectionKey: "summary",
        text: "Lead summary with enough content to speak aloud.",
      },
      {
        sectionKey: "section-0",
        text:
          "History. The city rebuilt its harbor after the storm. Officials later expanded the rail connection to the capital.",
      },
    ]);
  });
});

describe("shouldReuseExistingFeaturedEpisode", () => {
  const article = {
    wikiPageId: "123",
    title: "Example article",
  };

  it("reuses an existing ready episode when it matches the current article", () => {
    expect(
      shouldReuseExistingFeaturedEpisode({
        force: false,
        regenArt: false,
        existingEpisode: {
          status: "ready",
          wikiPageId: "123",
          title: "Example article",
          artworkVersion: 2,
        } as Parameters<typeof shouldReuseExistingFeaturedEpisode>[0]["existingEpisode"],
        article,
      }),
    ).toBe(true);
  });

  it("does not reuse a mismatched ready episode for the same featured date", () => {
    expect(
      shouldReuseExistingFeaturedEpisode({
        force: false,
        regenArt: false,
        existingEpisode: {
          status: "ready",
          wikiPageId: "999",
          title: "Older featured article",
          artworkVersion: 2,
        } as Parameters<typeof shouldReuseExistingFeaturedEpisode>[0]["existingEpisode"],
        article,
      }),
    ).toBe(false);
  });

  it("does not reuse when force is enabled", () => {
    expect(
      shouldReuseExistingFeaturedEpisode({
        force: true,
        regenArt: false,
        existingEpisode: {
          status: "ready",
          wikiPageId: "123",
          title: "Example article",
          artworkVersion: 2,
        } as Parameters<typeof shouldReuseExistingFeaturedEpisode>[0]["existingEpisode"],
        article,
      }),
    ).toBe(false);
  });

  it("does not reuse when regenArt is requested for an older artwork version", () => {
    expect(
      shouldReuseExistingFeaturedEpisode({
        force: false,
        regenArt: true,
        existingEpisode: {
          status: "ready",
          wikiPageId: "123",
          title: "Example article",
          artworkVersion: 1,
        } as Parameters<typeof shouldReuseExistingFeaturedEpisode>[0]["existingEpisode"],
        article,
      }),
    ).toBe(false);
  });

  it("reuses when regenArt is requested but artwork is already current", () => {
    expect(
      shouldReuseExistingFeaturedEpisode({
        force: false,
        regenArt: true,
        existingEpisode: {
          status: "ready",
          wikiPageId: "123",
          title: "Example article",
          artworkVersion: 2,
        } as Parameters<typeof shouldReuseExistingFeaturedEpisode>[0]["existingEpisode"],
        article,
      }),
    ).toBe(true);
  });
});

describe("hasCurrentFeaturedArtworkVersion", () => {
  it("detects the current artwork version", () => {
    expect(
      hasCurrentFeaturedArtworkVersion({
        artworkVersion: 2,
      } as Parameters<typeof hasCurrentFeaturedArtworkVersion>[0]),
    ).toBe(true);

    expect(
      hasCurrentFeaturedArtworkVersion({
        artworkVersion: 1,
      } as Parameters<typeof hasCurrentFeaturedArtworkVersion>[0]),
    ).toBe(false);
  });
});
