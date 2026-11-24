import { describe, it, expect } from "vitest";
import {
  MAX_PLAYBACK_RATE,
  MIN_PLAYBACK_RATE,
  describePlaybackRateChange,
  formatRate,
  normalizePlaybackRate,
  stepPlaybackRate,
} from "./usePlaybackRate";

describe("formatRate", () => {
  it("formats whole and fractional rates without floating-point noise", () => {
    expect(formatRate(1)).toBe("1x");
    expect(formatRate(0.5)).toBe("0.5x");
    expect(formatRate(1.25)).toBe("1.25x");
    expect(formatRate(0.1 + 0.2 + 1)).toBe("1.3x");
    expect(formatRate(4)).toBe("4x");
  });
});

describe("normalizePlaybackRate", () => {
  it("accepts every 0.05x step from 0.5x to 4x, including older presets", () => {
    for (const rate of [0.5, 0.75, 1, 1.25, 1.3, 1.75, 2.5, 3, 3.95, 4]) {
      expect(normalizePlaybackRate(rate)).toBe(rate);
    }
    expect(normalizePlaybackRate(1.1 + 0.2)).toBe(1.3);
  });

  it("rejects speeds browsers would mute or that are off the grid", () => {
    for (const rate of [0.45, 4.05, 16, 0, -1, 1.33, Number.NaN, Infinity]) {
      expect(normalizePlaybackRate(rate)).toBeNull();
    }
  });
});

describe("stepPlaybackRate", () => {
  it("moves 0.1x at a time and lands on the 0.1x grid", () => {
    expect(stepPlaybackRate(1, 1)).toBe(1.1);
    expect(stepPlaybackRate(1, -1)).toBe(0.9);
    expect(stepPlaybackRate(1.25, 1)).toBe(1.3);
    expect(stepPlaybackRate(1.25, -1)).toBe(1.2);
    expect(stepPlaybackRate(1.3, 1)).toBe(1.4);
    expect(stepPlaybackRate(2.9, 1)).toBe(3);
  });

  it("walks the whole range in clean steps", () => {
    let rate = MIN_PLAYBACK_RATE;
    const seen = [rate];
    while (rate < MAX_PLAYBACK_RATE) {
      rate = stepPlaybackRate(rate, 1);
      seen.push(rate);
    }
    expect(seen).toHaveLength(36);
    expect(seen.map(formatRate)).not.toContainEqual(
      expect.stringMatching(/\.\d{2,}x$/),
    );
  });

  it("stops at the slowest and fastest speeds", () => {
    expect(stepPlaybackRate(MIN_PLAYBACK_RATE, -1)).toBe(MIN_PLAYBACK_RATE);
    expect(stepPlaybackRate(MAX_PLAYBACK_RATE, 1)).toBe(MAX_PLAYBACK_RATE);
    expect(stepPlaybackRate(3.95, 1)).toBe(MAX_PLAYBACK_RATE);
  });
});

describe("describePlaybackRateChange", () => {
  it("names the new speed, or the limit that stopped the change", () => {
    expect(describePlaybackRateChange(1, 1.1, 1)).toBe("Playback speed 1.1x");
    expect(describePlaybackRateChange(4, 4, 1)).toBe(
      "Already at the fastest speed, 4x",
    );
    expect(describePlaybackRateChange(0.5, 0.5, -1)).toBe(
      "Already at the slowest speed, 0.5x",
    );
  });
});
