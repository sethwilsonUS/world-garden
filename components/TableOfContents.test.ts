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
  type AudioPlaybackState,
} from "./TableOfContents";
import { DataContext, type DataContextValue } from "@/lib/data-context";
import type { ContextBlock } from "@/lib/article-context-types";

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

const playback = (
  overrides: Partial<AudioPlaybackState> = {},
): AudioPlaybackState => ({
  status: "idle",
  sectionKey: null,
  sectionIdx: null,
  label: null,
  mode: "single",
  slowLoading: false,
  ...overrides,
});

const contextBlock: ContextBlock = {
  id: "timeline-context",
  kind: "timeline",
  title: "A short chronology",
  caption: "The milestone happened in 1969.",
  longDescription: "The chronology contains one milestone in 1969.",
  section: { index: "__summary__", title: "Summary" },
  order: 0,
  sources: [
    {
      label: "Wikipedia revision",
      url: "https://en.wikipedia.org/w/index.php?oldid=123",
      revisionId: "123",
      accessedAt: "2026-07-13T00:00:00.000Z",
    },
  ],
  provenance: {
    articleUrl: "https://en.wikipedia.org/wiki/Example",
    articleRevisionUrl: "https://en.wikipedia.org/w/index.php?oldid=123",
    sourceHash: "context-source-hash",
    extractorVersion: "test",
    descriptionMethod: "deterministic",
  },
  timeline: {
    chronological: true,
    events: [
      {
        id: "milestone",
        label: "Milestone",
        start: {
          display: "1969",
          iso: "1969",
          sortKey: 1969,
          precision: "year",
        },
      },
    ],
  },
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
          playback: playback(),
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
      "Why this section is not suited for audio",
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
          playback: playback(),
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

  it("makes Play All a stop control while the next section is loading", () => {
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
          playback: playback({
            status: "loading",
            sectionKey: "section-0",
            sectionIdx: 0,
            label: "History",
            mode: "play_all",
          }),
          onListenSection: () => {},
          onListenSummary: () => {},
          onPlayAll: () => {},
          onStopPlayAll: () => {},
          onSkipSection: () => {},
          onDownloadAll: () => {},
          playbackRate: 1,
        }),
      ),
    );

    expect(markup).toContain('aria-label="Stop playing all sections"');
    expect(markup).toContain(">Loading<");
    expect(markup).not.toContain(">Stop<");
  });

  it("allows skipping a section while Play All is loading", () => {
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
          playback: playback({
            status: "loading",
            sectionKey: "section-0",
            sectionIdx: 0,
            label: "History",
            mode: "play_all",
          }),
          onListenSection: () => {},
          onListenSummary: () => {},
          onPlayAll: () => {},
          onStopPlayAll: () => {},
          onSkipSection: () => {},
          onDownloadAll: () => {},
          playbackRate: 1,
        }),
      ),
    );
    const skipButton = markup.match(
      /<button[^>]*aria-label="Skip to next section"[^>]*>/,
    )?.[0];

    expect(skipButton).toBeDefined();
    expect(skipButton).not.toContain("disabled");
  });

  it("keeps download disabled while audio generation is active", () => {
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
          playback: playback({
            status: "loading",
            sectionKey: "section-0",
            sectionIdx: 0,
            label: "History",
            mode: "play_all",
          }),
          onListenSection: () => {},
          onListenSummary: () => {},
          onPlayAll: () => {},
          onStopPlayAll: () => {},
          onSkipSection: () => {},
          onDownloadAll: () => {},
          playbackRate: 1,
        }),
      ),
    );

    const downloadButton = markup.match(
      /<button[^>]*aria-label="Download full article as one audio file"[^>]*>/,
    )?.[0];

    expect(downloadButton).toBeDefined();
    expect(downloadButton).toContain('disabled=""');
  });

  it("keeps visual context out of Play All while retaining its direct anchor", () => {
    const markup = renderToStaticMarkup(
      createElement(
        DataContext.Provider,
        { value: dataContextValue },
        createElement(TableOfContents, {
          articleTitle: "Example article",
          wikiPageId: "123",
          summaryText: "A short summary.",
          sections: [],
          contextBlocks: [contextBlock],
          sectionDurations: {
            summary: 10,
            "context-summary-timeline-context-context-source": 3_600,
          },
          playback: playback(),
          onListenSection: () => {},
          onListenSummary: () => {},
          onPlayAll: () => {},
          onStopPlayAll: () => {},
          onDownloadAll: () => {},
          playbackRate: 1,
        }),
      ),
    );

    expect(markup).toContain('aria-label="Play summary"');
    expect(markup).not.toContain("Play all");
    expect(markup).not.toContain("(2)");
    expect(markup).toContain('aria-hidden="true">10s</span>');
    expect(markup).not.toContain("1h");
    expect(markup).toContain('aria-label="Download summary as audio file"');
    expect(markup).not.toContain(
      'aria-label="Download full article as one audio file"',
    );
    expect(markup).toContain(
      'aria-label="1 visual: jump to timeline: A short chronology"',
    );
    expect(markup).not.toContain("context note");
    expect(markup).not.toContain("Generating accessible context");
  });

  it("shows the active Play All section with the same playing state as an individual section", () => {
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
          playback: {
            status: "playing",
            sectionKey: "section-0",
            sectionIdx: 0,
            label: "History",
            mode: "play_all",
            slowLoading: false,
          },
          audioProgress: { currentTime: 4, duration: 12 },
          onSeek: () => {},
          onListenSection: () => {},
          onListenSummary: () => {},
          onPlayAll: () => {},
          onStopPlayAll: () => {},
          onTogglePlayAll: () => {},
          playbackRate: 1,
        }),
      ),
    );

    const stopButton = markup.match(
      /<button[^>]*aria-label="Stop playing all sections"[^>]*>/,
    )?.[0];

    expect(markup).toContain("Pause");
    expect(markup).toContain(">Stop<");
    expect(stopButton).toContain('type="button"');
    expect(markup).toContain(">Playing<");
    expect(markup).toContain("toc-progress-range");
  });

  it("keeps the active section progress visible while Play All is paused", () => {
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
          playback: {
            status: "paused",
            sectionKey: "section-0",
            sectionIdx: 0,
            label: "History",
            mode: "play_all",
            slowLoading: false,
          },
          audioProgress: { currentTime: 4, duration: 12 },
          onSeek: () => {},
          onListenSection: () => {},
          onListenSummary: () => {},
          onPlayAll: () => {},
          onStopPlayAll: () => {},
          onTogglePlayAll: () => {},
          playbackRate: 1,
        }),
      ),
    );

    const stopButton = markup.match(
      /<button[^>]*aria-label="Stop playing all sections"[^>]*>/,
    )?.[0];

    expect(markup).toContain("Resume");
    expect(markup).toContain(">Stop<");
    expect(stopButton).toContain('type="button"');
    expect(markup).toContain(">Paused<");
    expect(markup).toContain("toc-progress-range");
  });

  it("renders the slow-loading nudge for Play All generation", () => {
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
          playback: {
            status: "loading",
            sectionKey: "section-0",
            sectionIdx: 0,
            label: "History",
            mode: "play_all",
            slowLoading: true,
          },
          onListenSection: () => {},
          onListenSummary: () => {},
          onPlayAll: () => {},
          onStopPlayAll: () => {},
          playbackRate: 1,
        }),
      ),
    );

    expect(markup).toContain("aria-live=\"polite\"");
    expect(markup).toContain("Still generating audio. OpenAI is taking a little longer.");
  });

  it("renders the high-demand fallback voice notice as polite status text", () => {
    const markup = renderToStaticMarkup(
      createElement(
        DataContext.Provider,
        { value: dataContextValue },
        createElement(TableOfContents, {
          articleTitle: "Example article",
          wikiPageId: "123",
          summaryText: "Lead summary with enough text to estimate a duration.",
          sections: [],
          playback: playback(),
          fallbackVoiceNotice:
            "High demand is using Curio Garden’s fallback voice for this article. Audio will keep playing.",
          onListenSection: () => {},
          onListenSummary: () => {},
          onPlayAll: () => {},
          onStopPlayAll: () => {},
          playbackRate: 1,
        }),
      ),
    );

    expect(markup).toContain("role=\"status\"");
    expect(markup).toContain("aria-live=\"polite\"");
    expect(markup).toContain(
      "High demand is using Curio Garden’s fallback voice for this article. Audio will keep playing.",
    );
  });
});
