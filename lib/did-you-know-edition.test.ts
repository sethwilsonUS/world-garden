import { describe, expect, it } from "vitest";
import {
  buildDidYouKnowEditionDescription,
  buildDidYouKnowEditionMetadata,
  buildDidYouKnowEditionTitle,
  getDidYouKnowEditionPublishedAt,
} from "./did-you-know-edition";

describe("buildDidYouKnowEditionTitle", () => {
  it("formats the feed date into a readable title", () => {
    expect(buildDidYouKnowEditionTitle("2026-03-16")).toBe(
      "Did You Know? March 16, 2026",
    );
  });
});

describe("getDidYouKnowEditionPublishedAt", () => {
  it("derives a stable midnight UTC timestamp from the feed date", () => {
    expect(getDidYouKnowEditionPublishedAt("2026-03-16")).toBe(
      Date.UTC(2026, 2, 16, 0, 0, 0, 0),
    );
  });
});

describe("buildDidYouKnowEditionDescription", () => {
  it("derives a compact description from the leading fact texts", () => {
    expect(
      buildDidYouKnowEditionDescription([
        "... that there was a decades-long search for a photograph?",
        "... that Lucie Stern was called a rare child talent?",
        "... that a penguin became mayor?",
        "... that this fourth item is ignored?",
      ]),
    ).toBe(
      "That there was a decades-long search for a photograph? • That Lucie Stern was called a rare child talent? • That a penguin became mayor?",
    );
  });
});

describe("buildDidYouKnowEditionMetadata", () => {
  it("returns reusable edition metadata including a shortened excerpt", () => {
    expect(
      buildDidYouKnowEditionMetadata({
        feedDateIso: "2026-03-16",
        itemTexts: [
          "... that there was a decades-long search for a photograph?",
          "... that Lucie Stern was called a rare child talent?",
        ],
      }),
    ).toEqual({
      feedDateIso: "2026-03-16",
      title: "Did You Know? March 16, 2026",
      publishedAt: Date.UTC(2026, 2, 16, 0, 0, 0, 0),
      description:
        "That there was a decades-long search for a photograph? • That Lucie Stern was called a rare child talent?",
      excerpt:
        "That there was a decades-long search for a photograph? • That Lucie Stern was called a rare child talent?",
    });
  });
});
