import { describe, expect, it } from "vitest";
import {
  detectContinuousPlaybackWindow,
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
