import { describe, expect, it } from "vitest";
import {
  buildTrendingBriefPrompt,
  getCachedTrendingBriefContent,
  hasCurrentTrendingArtworkVersion,
  normalizeTrendingBrief,
  parseGeneratedTrendingBrief,
  selectTrendingArtworkItems,
  shouldReuseExistingTrendingBrief,
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

describe("cached trending brief reuse", () => {
  it("extracts cached generated content when a brief already has summary fields", () => {
    expect(
      getCachedTrendingBriefContent({
        _id: "brief-1",
        trendingDate: "2026-03-11",
        status: "failed",
        headline: "Cached headline",
        summary: "Cached summary",
        podcastDescription: "Cached podcast description",
        spokenSummary: "Cached spoken summary",
        keyPoints: ["Point one"],
        sources: [{ title: "Reuters", url: "https://reuters.com" }],
        audioUrl: null,
        updatedAt: Date.now(),
      } as Parameters<typeof getCachedTrendingBriefContent>[0]),
    ).toEqual({
      headline: "Cached headline",
      summary: "Cached summary",
      podcastDescription: "Cached podcast description",
      spokenSummary: "Cached spoken summary",
      keyPoints: ["Point one"],
      sources: [{ title: "Reuters", url: "https://reuters.com" }],
    });
  });

  it("does not treat incomplete records as cached generated content", () => {
    expect(
      getCachedTrendingBriefContent({
        _id: "brief-1",
        trendingDate: "2026-03-11",
        status: "failed",
        headline: "Missing the rest",
        audioUrl: null,
        updatedAt: Date.now(),
      } as Parameters<typeof getCachedTrendingBriefContent>[0]),
    ).toBeNull();
  });

  it("always reuses an existing ready brief, even if a force sync was requested", () => {
    expect(
      shouldReuseExistingTrendingBrief({
        _id: "brief-1",
        trendingDate: "2026-03-11",
        status: "ready",
        audioUrl: "https://cdn.example.com/brief.mp3",
        artworkVersion: 2,
        updatedAt: Date.now(),
      } as Parameters<typeof shouldReuseExistingTrendingBrief>[0]),
    ).toBe(true);
  });

  it("does not reuse when regenArt is requested for an older artwork version", () => {
    expect(
      shouldReuseExistingTrendingBrief(
        {
          _id: "brief-1",
          trendingDate: "2026-03-11",
          status: "ready",
          audioUrl: "https://cdn.example.com/brief.mp3",
          artworkVersion: 1,
          updatedAt: Date.now(),
        } as Parameters<typeof shouldReuseExistingTrendingBrief>[0],
        { regenArt: true },
      ),
    ).toBe(false);
  });

  it("reuses when regenArt is requested and artwork is already current", () => {
    expect(
      shouldReuseExistingTrendingBrief(
        {
          _id: "brief-1",
          trendingDate: "2026-03-11",
          status: "ready",
          audioUrl: "https://cdn.example.com/brief.mp3",
          artworkVersion: 2,
          updatedAt: Date.now(),
        } as Parameters<typeof shouldReuseExistingTrendingBrief>[0],
        { regenArt: true },
      ),
    ).toBe(true);
  });

  it("does not reuse when force and regenArt are both requested", () => {
    expect(
      shouldReuseExistingTrendingBrief(
        {
          _id: "brief-1",
          trendingDate: "2026-03-11",
          status: "ready",
          audioUrl: "https://cdn.example.com/brief.mp3",
          artworkVersion: 2,
          updatedAt: Date.now(),
        } as Parameters<typeof shouldReuseExistingTrendingBrief>[0],
        { force: true, regenArt: true },
      ),
    ).toBe(false);
  });
});

describe("hasCurrentTrendingArtworkVersion", () => {
  it("detects the current artwork version", () => {
    expect(
      hasCurrentTrendingArtworkVersion({
        artworkVersion: 2,
      } as Parameters<typeof hasCurrentTrendingArtworkVersion>[0]),
    ).toBe(true);

    expect(
      hasCurrentTrendingArtworkVersion({
        artworkVersion: 1,
      } as Parameters<typeof hasCurrentTrendingArtworkVersion>[0]),
    ).toBe(false);
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
