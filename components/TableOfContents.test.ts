import { describe, it, expect } from "vitest";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import {
  TableOfContents,
  formatDuration,
  formatDurationAccessible,
  estimateDuration,
  durationLabel,
  TTS_WORDS_PER_SECOND,
} from "./TableOfContents";
import { DataContext, type DataContextValue } from "@/lib/data-context";

const dataContextValue: DataContextValue = {
  search: async () => [],
  fetchArticle: async () => {
    throw new Error("not implemented in test");
  },
  getSectionLinkCounts: async () => [],
  getCitationCounts: async () => [],
  getSectionLinks: async () => [],
  getSectionCitations: async () => [],
  getArticleImages: async () => [],
};

describe("formatDuration", () => {
  it("formats seconds only", () => {
    expect(formatDuration(45, false)).toBe("45s");
  });

  it("formats minutes and seconds", () => {
    expect(formatDuration(125, false)).toBe("2m 5s");
  });

  it("formats exact minutes without trailing seconds", () => {
    expect(formatDuration(120, false)).toBe("2m");
  });

  it("formats hours, minutes, and seconds", () => {
    expect(formatDuration(3661, false)).toBe("1h 1m 1s");
  });

  it("formats hours and minutes without trailing seconds", () => {
    expect(formatDuration(3660, false)).toBe("1h 1m");
  });

  it("formats exact hours", () => {
    expect(formatDuration(3600, false)).toBe("1h");
  });

  it("formats zero seconds", () => {
    expect(formatDuration(0, false)).toBe("0s");
  });

  it("prepends ~ for estimated durations", () => {
    expect(formatDuration(45, true)).toBe("~45s");
    expect(formatDuration(125, true)).toBe("~2m 5s");
    expect(formatDuration(3661, true)).toBe("~1h 1m 1s");
  });

  it("does not prepend ~ for exact durations", () => {
    expect(formatDuration(45, false)).toBe("45s");
    expect(formatDuration(125, false)).toBe("2m 5s");
  });

  it("handles large values (multi-hour)", () => {
    expect(formatDuration(7261, false)).toBe("2h 1m 1s");
  });

  it("handles hours with seconds but no minutes", () => {
    expect(formatDuration(3601, false)).toBe("1h 0m 1s");
  });
});

describe("formatDurationAccessible", () => {
  it("formats seconds only", () => {
    expect(formatDurationAccessible(45, false)).toBe("45 seconds");
  });

  it("formats minutes and seconds", () => {
    expect(formatDurationAccessible(125, false)).toBe("2 minutes 5 seconds");
  });

  it("formats exact minutes without trailing seconds", () => {
    expect(formatDurationAccessible(120, false)).toBe("2 minutes");
  });

  it("formats hours, minutes, and seconds", () => {
    expect(formatDurationAccessible(3661, false)).toBe("1 hour 1 minute 1 second");
  });

  it("formats zero seconds", () => {
    expect(formatDurationAccessible(0, false)).toBe("0 seconds");
  });

  it("prepends approximately for estimated durations", () => {
    expect(formatDurationAccessible(45, true)).toBe("approximately 45 seconds");
    expect(formatDurationAccessible(125, true)).toBe("approximately 2 minutes 5 seconds");
  });

  it("uses singular for 1 unit", () => {
    expect(formatDurationAccessible(3661, false)).toBe("1 hour 1 minute 1 second");
  });

  it("uses plural for multiple units", () => {
    expect(formatDurationAccessible(7322, false)).toBe("2 hours 2 minutes 2 seconds");
  });
});

describe("estimateDuration", () => {
  it("estimates duration based on word count and rate", () => {
    const tenWords = "one two three four five six seven eight nine ten";
    const expectedSeconds = Math.round(10 / TTS_WORDS_PER_SECOND / 1);
    expect(estimateDuration(tenWords, 1)).toBe(`~${expectedSeconds}s`);
  });

  it("accounts for playback rate", () => {
    const tenWords = "one two three four five six seven eight nine ten";
    const at1x = Math.round(10 / TTS_WORDS_PER_SECOND / 1);
    const at2x = Math.round(10 / TTS_WORDS_PER_SECOND / 2);
    expect(at2x).toBeLessThan(at1x);
    expect(estimateDuration(tenWords, 2)).toBe(`~${at2x}s`);
  });

  it("handles empty text", () => {
    expect(estimateDuration("", 1)).toBe("~0s");
  });

  it("ignores extra whitespace when counting words", () => {
    expect(estimateDuration("  one   two   three  ", 1)).toBe(
      estimateDuration("one two three", 1),
    );
  });
});

describe("durationLabel", () => {
  it("returns actual duration when available in durations map", () => {
    const durations = { summary: 90 };
    expect(durationLabel("summary", "some text", durations)).toBe("1m 30s");
  });

  it("adjusts actual duration by playback rate", () => {
    const durations = { summary: 120 };
    expect(durationLabel("summary", "some text", durations, 2)).toBe("1m");
  });

  it("falls back to estimated duration when key not in map", () => {
    const result = durationLabel("section-0", "one two three", {});
    expect(result).toMatch(/^~/);
  });

  it("falls back to estimated duration when durations is undefined", () => {
    const result = durationLabel("section-0", "one two three", undefined);
    expect(result).toMatch(/^~/);
  });

  it("uses rate=1 when rate is not provided", () => {
    const durations = { summary: 60 };
    expect(durationLabel("summary", "text", durations)).toBe("1m");
  });

  it("stretches actual duration with rate < 1", () => {
    const durations = { summary: 60 };
    expect(durationLabel("summary", "text", durations, 0.5)).toBe("2m");
  });

  it("returns estimate for empty durations map with rate > 1", () => {
    const result = durationLabel("section-0", "one two three four five", {}, 2);
    expect(result).toMatch(/^~/);
  });
});

describe("TableOfContents audio eligibility", () => {
  it("renders unavailable sections as greyed out and excludes them from play-all count", () => {
    const markup = renderToStaticMarkup(
      createElement(
        DataContext.Provider,
        { value: dataContextValue },
        createElement(TableOfContents, {
          articleTitle: "Example article",
          wikiPageId: "123",
          summaryText: "Lead summary with enough text to estimate a duration.",
          sections: [
            {
              title: "History",
              level: 2,
              content:
                "The town expanded after the railway arrived. It later rebuilt the market square after a flood.",
              audioMode: "full" as const,
              audioReason: "eligible" as const,
            },
            {
              title: "Election results",
              level: 2,
              content: [
                "Year  Candidate  Vote",
                "2020  Rivera     51.2%",
                "2022  Patel      49.8%",
              ].join("\n"),
              audioMode: "unavailable" as const,
              audioReason: "table_like" as const,
            },
          ],
          activeSectionIndex: null,
          isPlayingAll: false,
          onListenSection: () => {},
          onListenSummary: () => {},
          onPlayAll: () => {},
          onStopPlayAll: () => {},
          playbackRate: 1,
        }),
      ),
    );

    expect(markup).toContain("Play all");
    expect(markup).toContain("(2)");
    expect(markup).toContain("Not suited for audio");
    expect(markup).toContain(
      "title=\"This section is mostly table-like content, which usually does not sound great read aloud.\"",
    );
    expect(markup).toContain(
      "Election results — not available for audio: section reads like a table",
    );
  });

  it("shows a Listen control for playable sections", () => {
    const markup = renderToStaticMarkup(
      createElement(
        DataContext.Provider,
        { value: dataContextValue },
        createElement(TableOfContents, {
          articleTitle: "Example article",
          wikiPageId: "123",
          summaryText: "Lead summary with enough text to estimate a duration.",
          sections: [
            {
              title: "History",
              level: 2,
              content:
                "The town expanded after the railway arrived. It later rebuilt the market square after a flood.",
              audioMode: "full" as const,
              audioReason: "eligible" as const,
            },
          ],
          activeSectionIndex: null,
          isPlayingAll: false,
          onListenSection: () => {},
          onListenSummary: () => {},
          onPlayAll: () => {},
          onStopPlayAll: () => {},
          playbackRate: 1,
        }),
      ),
    );

    expect(markup).toContain("Listen to History");
    expect(markup).toContain(">Listen<");
  });
});
