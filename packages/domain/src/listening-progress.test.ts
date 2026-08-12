import { describe, expect, it } from "vitest";

import {
  detectContinuousPlaybackWindow,
  mergeHeardRanges,
  normalizeResumeCursor,
  RESUME_CURSOR_LIMITS,
  resumeCursorMatchesTarget,
} from "./index";

const validResumeCursorSource = () => ({
  wikiPageId: "42",
  revisionId: "99",
  narrationVersion: 3,
  mode: "all",
  sectionKey: "summary",
  positionSeconds: 14,
  durationSeconds: 90,
});

describe("shared listening progress", () => {
  it("exposes heard-range merging through the platform-neutral domain", () => {
    expect(
      mergeHeardRanges([
        { startSecond: 5, endSecond: 7 },
        { startSecond: 0, endSecond: 3 },
        { startSecond: 2, endSecond: 5 },
      ]),
    ).toEqual([{ startSecond: 0, endSecond: 7 }]);
  });

  it.each([
    ["NaN", Number.NaN],
    ["positive infinity", Number.POSITIVE_INFINITY],
    ["negative infinity", Number.NEGATIVE_INFINITY],
    ["zero", 0],
    ["a negative value", -1],
  ])("rejects %s as a playback rate", (_label, playbackRate) => {
    expect(
      detectContinuousPlaybackWindow({
        previousTime: 4,
        currentTime: 4.5,
        elapsedMs: 1_000,
        playbackRate,
      }),
    ).toBeNull();
  });

  it("normalizes a client resume cursor into one canonical immutable value", () => {
    const cursor = normalizeResumeCursor({
      wikiPageId: "00042",
      revisionId: "00099",
      narrationVersion: 3,
      mode: "all",
      sectionKey: "section-7",
      positionSeconds: 14,
      durationSeconds: 90,
    });

    expect(cursor).toEqual({
      wikiPageId: "42",
      revisionId: "99",
      narrationVersion: 3,
      mode: "all",
      sectionKey: "section-7",
      positionSeconds: 14,
      durationSeconds: 90,
    });
    expect(Object.isFrozen(cursor)).toBe(true);
  });

  it("canonicalizes negative zero at the start of an item", () => {
    const cursor = normalizeResumeCursor({
      ...validResumeCursorSource(),
      positionSeconds: -0,
    });

    expect(cursor?.positionSeconds).toBe(0);
  });

  it("accepts each exact resume-cursor upper bound", () => {
    expect(
      normalizeResumeCursor({
        wikiPageId: "9".repeat(20),
        revisionId: "8".repeat(20),
        narrationVersion: RESUME_CURSOR_LIMITS.maxNarrationVersion,
        mode: "single",
        sectionKey: `section-${RESUME_CURSOR_LIMITS.maxSectionIndex}`,
        positionSeconds: RESUME_CURSOR_LIMITS.maxDurationSeconds - 1,
        durationSeconds: RESUME_CURSOR_LIMITS.maxDurationSeconds,
      }),
    ).not.toBeNull();
  });

  it("accepts each exact resume-cursor lower bound", () => {
    expect(
      normalizeResumeCursor({
        ...validResumeCursorSource(),
        narrationVersion: 1,
        mode: "single",
        sectionKey: "section-0",
        positionSeconds: 0,
        durationSeconds: 1,
      }),
    ).not.toBeNull();
  });

  it.each([
    [
      "narrationVersion",
      { narrationVersion: RESUME_CURSOR_LIMITS.maxNarrationVersion + 1 },
    ],
    [
      "sectionKey",
      { sectionKey: `section-${RESUME_CURSOR_LIMITS.maxSectionIndex + 1}` },
    ],
    [
      "durationSeconds",
      { durationSeconds: RESUME_CURSOR_LIMITS.maxDurationSeconds + 1 },
    ],
  ])("rejects a resume cursor over the %s limit", (_field, override) => {
    expect(
      normalizeResumeCursor({ ...validResumeCursorSource(), ...override }),
    ).toBeNull();
  });

  it.each([
    ["non-object", null],
    ["numeric wikiPageId", { wikiPageId: 42 }],
    ["zero wikiPageId", { wikiPageId: "0" }],
    ["oversized wikiPageId", { wikiPageId: "1".repeat(21) }],
    ["non-numeric revisionId", { revisionId: "nine" }],
    ["zero narrationVersion", { narrationVersion: 0 }],
    ["fractional narrationVersion", { narrationVersion: 1.5 }],
    [
      "non-finite narrationVersion",
      { narrationVersion: Number.POSITIVE_INFINITY },
    ],
    ["unknown mode", { mode: "playlist" }],
    ["non-canonical sectionKey", { sectionKey: "section-01" }],
    ["negative positionSeconds", { positionSeconds: -1 }],
    ["fractional positionSeconds", { positionSeconds: 1.5 }],
    ["non-finite positionSeconds", { positionSeconds: Number.NaN }],
    ["zero durationSeconds", { durationSeconds: 0 }],
    ["fractional durationSeconds", { durationSeconds: 90.5 }],
    [
      "non-finite durationSeconds",
      { durationSeconds: Number.POSITIVE_INFINITY },
    ],
    ["position at duration", { positionSeconds: 90 }],
  ])("rejects an invalid %s", (_label, source) => {
    const candidate =
      source === null ? source : { ...validResumeCursorSource(), ...source };

    expect(normalizeResumeCursor(candidate)).toBeNull();
  });

  it.each(["updatedAt", "cursorVersion"])(
    "rejects the non-client %s field",
    (field) => {
      expect(
        normalizeResumeCursor({
          ...validResumeCursorSource(),
          [field]: 1_786_467_600_000,
        }),
      ).toBeNull();
    },
  );

  it("matches a cursor only to its exact article narration target", () => {
    const cursor = normalizeResumeCursor(validResumeCursorSource());

    expect(
      resumeCursorMatchesTarget(cursor!, {
        wikiPageId: "42",
        revisionId: "99",
        narrationVersion: 3,
      }),
    ).toBe(true);
    expect(
      resumeCursorMatchesTarget(cursor!, {
        wikiPageId: "42",
        revisionId: "100",
        narrationVersion: 3,
      }),
    ).toBe(false);
    expect(
      resumeCursorMatchesTarget(cursor!, {
        wikiPageId: "43",
        revisionId: "99",
        narrationVersion: 3,
      }),
    ).toBe(false);
    expect(
      resumeCursorMatchesTarget(cursor!, {
        wikiPageId: "42",
        revisionId: "99",
        narrationVersion: 4,
      }),
    ).toBe(false);
  });
});
