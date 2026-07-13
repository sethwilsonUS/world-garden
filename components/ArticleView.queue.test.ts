import { describe, expect, it } from "vitest";
import type { Section } from "@/lib/data-context";
import { buildPlayAllQueue } from "./ArticleView";

describe("buildPlayAllQueue", () => {
  it("queues only the summary and audio-suitable article sections", () => {
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

    const queue = buildPlayAllQueue(sections, "Example");

    expect(queue).toEqual([
      {
        sectionKey: "summary",
        label: "Example — Summary",
        sectionIdx: null,
      },
      {
        sectionKey: "section-0",
        label: "History — Example",
        sectionIdx: 0,
      },
    ]);
    expect(JSON.stringify(queue)).not.toContain("context-");
  });

  it("keeps Play All summary-only when no article section supports audio", () => {
    const sections: Section[] = [
      {
        title: "Results",
        level: 2,
        content: "Year Result\n2020 10",
        audioMode: "unavailable",
        audioReason: "table_like",
      },
    ];

    expect(buildPlayAllQueue(sections, "Example")).toEqual([
      {
        sectionKey: "summary",
        label: "Example — Summary",
        sectionIdx: null,
      },
    ]);
  });
});
