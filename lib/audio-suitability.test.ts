import { describe, expect, it } from "vitest";
import {
  attachAudioSuitability,
  classifySectionAudio,
  getAudioReasonLabel,
  hasFullAudio,
} from "./audio-suitability";

describe("classifySectionAudio", () => {
  it("marks short prose as unavailable", () => {
    expect(
      classifySectionAudio({
        title: "Stub",
        content: "Too short.",
      }),
    ).toEqual({
      audioMode: "unavailable",
      audioReason: "too_short",
    });
  });

  it("keeps normal narrative prose fully available", () => {
    expect(
      classifySectionAudio({
        title: "History",
        content:
          "The city grew rapidly during the late nineteenth century. Residents expanded the harbor and rebuilt the market square after a fire.",
      }),
    ).toEqual({
      audioMode: "full",
      audioReason: "eligible",
    });
  });

  it("flags list-like sections", () => {
    expect(
      classifySectionAudio({
        title: "Notable people",
        content: [
          "Ada Lovelace",
          "Alan Turing",
          "Grace Hopper",
          "Donald Knuth",
        ].join("\n"),
      }),
    ).toEqual({
      audioMode: "unavailable",
      audioReason: "list_like",
    });
  });

  it("flags flattened table sections", () => {
    expect(
      classifySectionAudio({
        title: "Results",
        content: [
          "Year  Candidate  Vote",
          "2020  Rivera     51.2%",
          "2022  Patel      49.8%",
        ].join("\n"),
      }),
    ).toEqual({
      audioMode: "unavailable",
      audioReason: "table_like",
    });
  });

  it("flags metadata-heavy headings", () => {
    expect(
      classifySectionAudio({
        title: "Track listing",
        content:
          "Opening theme. Closing theme. Bonus reprise. Deluxe edition remix.",
      }),
    ).toEqual({
      audioMode: "unavailable",
      audioReason: "metadata_heavy",
    });
  });

  it("flags prose-light sections that do not contain enough narrative", () => {
    expect(
      classifySectionAudio({
        title: "Overview",
        content: "An isolated plateau above the river basin with steep cliffs nearby.",
      }),
    ).toEqual({
      audioMode: "unavailable",
      audioReason: "low_prose_density",
    });
  });

  it("does not over-penalize prose that contains years and statistics", () => {
    expect(
      classifySectionAudio({
        title: "History",
        content:
          "In 2020 the population reached 12,400, and in 2024 it rose to 13,050 after two transit expansions. Officials said the increase reflected steady regional growth rather than a one-time event.",
      }),
    ).toEqual({
      audioMode: "full",
      audioReason: "eligible",
    });
  });
});

describe("section audio helpers", () => {
  it("attaches audio suitability metadata to a section", () => {
    expect(
      attachAudioSuitability({
        title: "History",
        level: 2,
        content:
          "The museum opened in 1910. It was expanded in 1955 after a major donation.",
      }),
    ).toMatchObject({
      title: "History",
      level: 2,
      audioMode: "full",
      audioReason: "eligible",
    });
  });

  it("prefers metadata when checking full-audio availability", () => {
    expect(
      hasFullAudio({
        content: "This content is comfortably long enough to pass the fallback.",
        audioMode: "unavailable",
      }),
    ).toBe(false);
  });

  it("provides human-readable labels for accessibility text", () => {
    expect(getAudioReasonLabel("table_like")).toBe("section reads like a table");
  });
});
