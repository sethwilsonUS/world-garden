import { describe, expect, it } from "vitest";
import {
  calculateNewlyHeardSeconds,
  detectContinuousPlaybackWindow,
  getMeaningfulUseQualification,
  mergeHeardRanges,
  normalizeHeardRanges,
  sumHeardRangeSeconds,
} from "./listen-progress";

describe("mergeHeardRanges", () => {
  it("merges overlapping and adjacent ranges", () => {
    expect(
      mergeHeardRanges([
        { startSecond: 0, endSecond: 3 },
        { startSecond: 2, endSecond: 5 },
        { startSecond: 5, endSecond: 7 },
      ]),
    ).toEqual([{ startSecond: 0, endSecond: 7 }]);
  });
});

describe("normalizeHeardRanges", () => {
  it("clamps ranges to the section duration and removes empty entries", () => {
    expect(
      normalizeHeardRanges(
        [
          { startSecond: -1, endSecond: 2.2 },
          { startSecond: 2.2, endSecond: 2.2 },
          { startSecond: 8.4, endSecond: 12.9 },
        ],
        10,
      ),
    ).toEqual([
      { startSecond: 0, endSecond: 3 },
      { startSecond: 8, endSecond: 10 },
    ]);
  });

  it("sums the merged heard seconds", () => {
    const ranges = normalizeHeardRanges(
      [
        { startSecond: 0, endSecond: 3.1 },
        { startSecond: 2.9, endSecond: 6.2 },
      ],
      10,
    );

    expect(sumHeardRangeSeconds(ranges)).toBe(7);
  });
});

describe("calculateNewlyHeardSeconds", () => {
  it("counts only incoming coverage that was not heard before", () => {
    expect(
      calculateNewlyHeardSeconds({
        existingRanges: [{ startSecond: 0, endSecond: 5 }],
        incomingRanges: [{ startSecond: 4, endSecond: 8 }],
        durationSeconds: 10,
      }),
    ).toBe(3);
  });
});

describe("getMeaningfulUseQualification", () => {
  it("qualifies after sixty accumulated unique heard seconds", () => {
    expect(
      getMeaningfulUseQualification([
        {
          durationSeconds: 40,
          heardRanges: [{ startSecond: 0, endSecond: 35 }],
          countsTowardProgress: true,
        },
        {
          durationSeconds: 40,
          heardRanges: [{ startSecond: 10, endSecond: 35 }],
          countsTowardProgress: true,
        },
      ]),
    ).toBe("sixty_unique_heard_seconds");
  });

  it("qualifies at eighty percent of a progress item lasting at least fifteen seconds", () => {
    expect(
      getMeaningfulUseQualification([
        {
          durationSeconds: 20,
          heardRanges: [{ startSecond: 0, endSecond: 16 }],
          countsTowardProgress: true,
        },
      ]),
    ).toBe("eighty_percent_of_item");
  });
});

describe("detectContinuousPlaybackWindow", () => {
  it("counts natural forward playback", () => {
    expect(
      detectContinuousPlaybackWindow({
        previousTime: 4,
        currentTime: 5.1,
        elapsedMs: 1_000,
        playbackRate: 1,
      }),
    ).toEqual({ startSecond: 4, endSecond: 5.1 });
  });

  it("ignores large jumps that look like seeking or skipping", () => {
    expect(
      detectContinuousPlaybackWindow({
        previousTime: 4,
        currentTime: 12,
        elapsedMs: 1_000,
        playbackRate: 1,
      }),
    ).toBeNull();
  });

  it("allows faster playback when the wall-clock delta supports it", () => {
    expect(
      detectContinuousPlaybackWindow({
        previousTime: 4,
        currentTime: 5.9,
        elapsedMs: 1_000,
        playbackRate: 2,
      }),
    ).toEqual({ startSecond: 4, endSecond: 5.9 });
  });
});
