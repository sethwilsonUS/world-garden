import { describe, expect, it } from "vitest";
import {
  formatTimeLeft,
  getPlayAllSecondsRemaining,
  getSectionNavigation,
} from "./article-section-navigation";

const content = (sectionKey: string) => ({
  sectionKey,
  individuallyPlayable: true,
});
const leadIn = (sectionKey: string) => ({
  sectionKey,
  individuallyPlayable: false,
});

// Summary, a parent heading spoken as a lead-in, its first subsection, then
// two more sections with text.
const tracks = [
  content("summary"),
  leadIn("section-0"),
  content("section-1"),
  content("section-2"),
  content("section-3"),
];

describe("getSectionNavigation", () => {
  it("counts content sections and points at their neighbours", () => {
    expect(getSectionNavigation(tracks, "section-2")).toEqual({
      position: { current: 3, total: 4 },
      previousIndex: 2,
      previousStartIndex: 1,
      nextIndex: 4,
    });
  });

  it("has nothing before the first section or after the last", () => {
    expect(getSectionNavigation(tracks, "summary")).toMatchObject({
      position: { current: 1, total: 4 },
      previousIndex: null,
      previousStartIndex: null,
      nextIndex: 2,
    });
    expect(getSectionNavigation(tracks, "section-3")).toMatchObject({
      position: { current: 4, total: 4 },
      previousIndex: 3,
      previousStartIndex: 3,
      nextIndex: null,
    });
  });

  it("treats a heading lead-in as part of the section it introduces", () => {
    expect(getSectionNavigation(tracks, "section-0")).toEqual({
      position: { current: 2, total: 4 },
      previousIndex: 0,
      previousStartIndex: 0,
      nextIndex: 2,
    });
  });

  it("starts Play all from a section's lead-in when moving back to it", () => {
    expect(getSectionNavigation(tracks, "section-1").previousStartIndex).toBe(
      0,
    );
    expect(getSectionNavigation(tracks, "section-2").previousStartIndex).toBe(
      1,
    );
  });

  it("returns no position when nothing or an unknown track is loaded", () => {
    const empty = {
      position: null,
      previousIndex: null,
      previousStartIndex: null,
      nextIndex: null,
    };
    expect(getSectionNavigation(tracks, null)).toEqual(empty);
    expect(getSectionNavigation(tracks, "section-99")).toEqual(empty);
    expect(getSectionNavigation([leadIn("section-0")], "section-0")).toEqual(
      empty,
    );
  });
});

describe("getPlayAllSecondsRemaining", () => {
  const timed = [
    { sectionKey: "summary", text: "" },
    { sectionKey: "section-0", text: "" },
    { sectionKey: "section-1", text: "one two three four five" },
  ];
  const durations = { summary: 60, "section-0": 120 };

  it("adds the rest of the current track to every queued track", () => {
    expect(
      getPlayAllSecondsRemaining({
        tracks: timed,
        sectionKey: "summary",
        currentTime: 15,
        duration: 60,
        durations,
        playbackRate: 1,
      }),
    ).toBe(45 + 120 + 2);
  });

  it("reports wall-clock time at the current speed", () => {
    expect(
      getPlayAllSecondsRemaining({
        tracks: timed,
        sectionKey: "section-0",
        currentTime: 20,
        duration: 120,
        durations,
        playbackRate: 2,
      }),
    ).toBe((100 + 2) / 2);
  });

  it("estimates a track that has not reported its duration yet", () => {
    expect(
      getPlayAllSecondsRemaining({
        tracks: timed,
        sectionKey: "section-0",
        currentTime: 0,
        duration: Number.NaN,
        durations,
        playbackRate: 1,
      }),
    ).toBe(120 + 2);
  });

  it("returns null when the track is not part of the article", () => {
    expect(
      getPlayAllSecondsRemaining({
        tracks: timed,
        sectionKey: null,
        currentTime: 0,
        duration: 0,
        playbackRate: 1,
      }),
    ).toBeNull();
  });
});

describe("formatTimeLeft", () => {
  it("rounds to whole minutes in plain words", () => {
    expect(formatTimeLeft(59)).toBe("less than a minute left");
    expect(formatTimeLeft(60)).toBe("about 1 minute left");
    expect(formatTimeLeft(31 * 60 + 20)).toBe("about 31 minutes left");
    expect(formatTimeLeft(60 * 60)).toBe("about 1 hour left");
    expect(formatTimeLeft(65 * 60)).toBe("about 1 hour 5 minutes left");
    expect(formatTimeLeft(Number.NaN)).toBe("less than a minute left");
  });
});
