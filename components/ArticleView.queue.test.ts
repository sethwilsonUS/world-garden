import { describe, expect, it } from "vitest";
import type { Section } from "@/lib/data-context";
import type { ContextBlock } from "@/lib/article-context-types";
import {
  buildPlayAllQueue,
  formatContextAudioPlaybackLabel,
  getAudioRetryAriaLabel,
  getContextAudioFallbackLabel,
} from "./ArticleView";

const source = {
  label: "Wikipedia",
  url: "https://en.wikipedia.org/wiki/Example",
  accessedAt: "2026-07-13T00:00:00.000Z",
};

const contextBlock = (
  id: string,
  section: { index: string; title: string },
  order: number,
): ContextBlock => ({
  id,
  kind: "timeline",
  title: id,
  takeaway: "Takeaway",
  spokenSummary: `Spoken summary for ${id}.`,
  longDescription: `Long description for ${id}.`,
  section,
  order,
  sources: [source],
  provenance: {
    articleUrl: source.url,
    articleRevisionUrl: `${source.url}?oldid=1`,
    sourceHash: `${id}-hash-1234567890`,
    extractorVersion: "1.0.0",
    descriptionMethod: "deterministic",
  },
  timeline: { chronological: true, events: [] },
});

describe("buildPlayAllQueue", () => {
  it("snapshots context summaries after the summary and associated prose", () => {
    const sections: Section[] = [
      {
        title: "History",
        level: 2,
        content: "A prose history with enough information to narrate.",
        audioMode: "full",
        audioReason: "eligible",
      },
      {
        title: "Results",
        level: 2,
        content: "Year Result\n2020 10",
        audioMode: "unavailable",
        audioReason: "table_like",
      },
    ];
    const context = [
      contextBlock("lead-map", { index: "__summary__", title: "Summary" }, 1),
      contextBlock("history-timeline", { index: "1", title: "History" }, 2),
      contextBlock("results-chart", { index: "2", title: "Results" }, 3),
      contextBlock("unmatched", { index: "99", title: "Appendix" }, 4),
    ];

    const queue = buildPlayAllQueue(sections, "Example", context);

    expect(queue.map((item) => item.sectionKey)).toEqual([
      "summary",
      "context-summary-lead-map-lead-map-has",
      "section-0",
      "context-summary-history-timeline-history-time",
      "context-summary-results-chart-results-char",
      "context-summary-unmatched-unmatched-ha",
    ]);
    expect(queue[4].sectionIdx).toBeNull();
    expect(queue[1].label).toBe(
      "lead-map — Context summary for Example",
    );
  });

  it("does not duplicate a block matched by both section index and title", () => {
    const sections: Section[] = [
      {
        title: "History",
        level: 2,
        content: "Narratable history.",
        audioMode: "full",
        audioReason: "eligible",
      },
    ];
    const context = [contextBlock("history", { index: "1", title: "History" }, 1)];

    expect(buildPlayAllQueue(sections, "Example", context)).toHaveLength(3);
  });

  it("distinguishes context summaries and descriptions in playback labels", () => {
    const summaryKey = "context-summary-map-hash";
    const descriptionKey = "context-description-map-hash";

    expect(
      formatContextAudioPlaybackLabel("Map", "Example", "summary"),
    ).toBe("Map — Context summary for Example");
    expect(
      formatContextAudioPlaybackLabel("Map", "Example", "description"),
    ).toBe("Map — Context description for Example");
    expect(getContextAudioFallbackLabel("Example", summaryKey)).toBe(
      "Example — Context summary",
    );
    expect(getContextAudioFallbackLabel("Example", descriptionKey)).toBe(
      "Example — Context description",
    );
    expect(getAudioRetryAriaLabel(summaryKey)).toBe(
      "Try generating context summary audio again",
    );
    expect(getAudioRetryAriaLabel(descriptionKey)).toBe(
      "Try generating context description audio again",
    );
  });
});
