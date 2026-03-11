import { describe, expect, it } from "vitest";
import {
  buildTrendingBriefPrompt,
  normalizeTrendingBrief,
  parseGeneratedTrendingBrief,
  selectTrendingArtworkItems,
} from "./trending-brief";

describe("normalizeTrendingBrief", () => {
  it("dedupes sources, trims fields, and strips URLs from spoken text", () => {
    const brief = normalizeTrendingBrief({
      headline: "  Big day on Wikipedia  ",
      summary: "  A concise summary.  ",
      podcastDescription: "  A compact podcast description.  ",
      spokenSummary: "Read more at https://example.com right now.  ",
      keyPoints: [" First point. ", "", "Second point."],
      sources: [
        { title: " Example ", url: "https://example.com " },
        { title: "Example duplicate", url: "https://example.com" },
        { title: "Second", url: "https://second.example" },
      ],
    });

    expect(brief.headline).toBe("Big day on Wikipedia");
    expect(brief.summary).toBe("A concise summary.");
    expect(brief.podcastDescription).toBe("A compact podcast description.");
    expect(brief.spokenSummary).not.toContain("https://");
    expect(brief.keyPoints).toEqual(["First point.", "Second point."]);
    expect(brief.sources).toEqual([
      { title: "Example", url: "https://example.com" },
      { title: "Second", url: "https://second.example" },
    ]);
  });
});

describe("buildTrendingBriefPrompt", () => {
  it("includes the trending date and article context", () => {
    const prompt = buildTrendingBriefPrompt({
      trendingDate: "2026-03-08",
      articles: [
        {
          title: "Example Topic",
          extract: "An example extract.",
          views: 12345,
        },
      ],
    });

    expect(prompt).toContain("2026-03-08");
    expect(prompt).toContain("Example Topic");
    expect(prompt).toContain("12,345 views");
    expect(prompt).toContain("Return only valid JSON");
  });
});

describe("selectTrendingArtworkItems", () => {
  it("keeps title and thumbnail pairs aligned and skips articles without thumbnails", () => {
    expect(
      selectTrendingArtworkItems([
        { title: "One", imageUrl: "1.png" },
        { title: "Two" },
        { title: "Three", imageUrl: "3.png" },
        { title: "Four", imageUrl: "" },
        { title: "Five", imageUrl: "5.png" },
      ]),
    ).toEqual([
      { title: "One", imageUrl: "1.png" },
      { title: "Three", imageUrl: "3.png" },
      { title: "Five", imageUrl: "5.png" },
    ]);
  });
});

describe("parseGeneratedTrendingBrief", () => {
  it("parses fenced JSON output from the model", () => {
    const parsed = parseGeneratedTrendingBrief(
      [
        "```json",
        '{"headline":"H","summary":"S","podcastDescription":"PD","spokenSummary":"SS","keyPoints":["A"],"sources":[{"title":"Reuters","url":"https://reuters.com"}]}',
        "```",
      ].join("\n"),
    );

    expect(parsed.headline).toBe("H");
    expect(parsed.podcastDescription).toBe("PD");
    expect(parsed.sources[0]?.url).toBe("https://reuters.com");
  });
});
