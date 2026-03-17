import { describe, expect, it } from "vitest";
import {
  buildDidYouKnowAudioTitle,
  buildDidYouKnowSpeechScript,
  resolveDidYouKnowFeedDateIso,
  shouldReuseExistingDidYouKnowAudio,
} from "./did-you-know-audio";

describe("buildDidYouKnowAudioTitle", () => {
  it("formats the feed date into a readable title", () => {
    expect(buildDidYouKnowAudioTitle("2026-03-16")).toBe(
      "Did You Know? March 16, 2026",
    );
  });
});

describe("resolveDidYouKnowFeedDateIso", () => {
  it("keeps a valid feed date unchanged", () => {
    expect(resolveDidYouKnowFeedDateIso("2026-03-16")).toBe("2026-03-16");
  });
});

describe("buildDidYouKnowSpeechScript", () => {
  it("builds a spoken script with intro, numbered facts, and outro", () => {
    const script = buildDidYouKnowSpeechScript({
      feedDateIso: "2026-03-16",
      items: [
        {
          text: "... that there was a decades-long search for a photograph?",
          links: [],
          segments: [],
        },
        {
          text: "... that Lucie Stern was called a rare child talent?",
          links: [],
          segments: [],
        },
      ],
    });

    expect(script).toContain("Curio Garden. Did you know? March 16, 2026.");
    expect(script).toContain(
      "Fact 1. That there was a decades-long search for a photograph?",
    );
    expect(script).toContain(
      "Fact 2. That Lucie Stern was called a rare child talent?",
    );
    expect(script).toContain("End of today's Did you know list.");
  });
});

describe("shouldReuseExistingDidYouKnowAudio", () => {
  it("requires a ready record with an audio URL", () => {
    expect(
      shouldReuseExistingDidYouKnowAudio({
        _id: "dyk-1",
        feedDate: "2026-03-16",
        status: "ready",
        audioUrl: "https://cdn.example.com/dyk.mp3",
        createdAt: Date.now(),
        updatedAt: Date.now(),
      } as Parameters<typeof shouldReuseExistingDidYouKnowAudio>[0]),
    ).toBe(true);

    expect(
      shouldReuseExistingDidYouKnowAudio({
        _id: "dyk-2",
        feedDate: "2026-03-16",
        status: "ready",
        audioUrl: null,
        createdAt: Date.now(),
        updatedAt: Date.now(),
      } as Parameters<typeof shouldReuseExistingDidYouKnowAudio>[0]),
    ).toBe(false);
  });
});
