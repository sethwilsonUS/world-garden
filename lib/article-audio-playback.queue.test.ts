import { describe, expect, it } from "vitest";
import type { Section } from "./data-context";
import {
  buildPlayAllQueue,
  createIdleAudioPlayback,
  getAudioRetryTarget,
  type AudioPlaybackState,
} from "./article-audio-playback";

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

describe("getAudioRetryTarget", () => {
  const playback = (
    overrides: Partial<AudioPlaybackState>,
  ): AudioPlaybackState => ({
    ...createIdleAudioPlayback(),
    status: "error",
    ...overrides,
  });

  it("retries the section that failed", () => {
    expect(
      getAudioRetryTarget(
        playback({
          sectionKey: "section-2",
          sectionIdx: 2,
          label: "Later years \u2014 Example",
        }),
        "Example",
      ),
    ).toEqual({
      sectionKey: "section-2",
      sectionIdx: 2,
      label: "Later years \u2014 Example",
      ariaLabel: "Try generating audio for Later years \u2014 Example again",
    });
  });

  it("keeps summary failures on the summary", () => {
    expect(
      getAudioRetryTarget(
        playback({
          sectionKey: "summary",
          label: "Example \u2014 Summary",
        }),
        "Example",
      ),
    ).toEqual({
      sectionKey: "summary",
      sectionIdx: null,
      label: "Example \u2014 Summary",
      ariaLabel: "Try generating summary audio again",
    });
  });

  it("does not treat a non-error section playback as the failed target", () => {
    expect(
      getAudioRetryTarget(
        playback({
          status: "paused",
          sectionKey: "section-0",
          sectionIdx: 0,
          label: "History \u2014 Example",
        }),
        "Example",
      ),
    ).toEqual({
      sectionKey: "summary",
      sectionIdx: null,
      label: "Example \u2014 Summary",
      ariaLabel: "Try generating summary audio again",
    });
  });
});
