import { describe, it, expect } from "vitest";
import { formatRate, PLAYBACK_RATES } from "./usePlaybackRate";

describe("formatRate", () => {
  it("formats integer rates", () => {
    expect(formatRate(1)).toBe("1x");
    expect(formatRate(2)).toBe("2x");
    expect(formatRate(3)).toBe("3x");
  });

  it("formats fractional rates", () => {
    expect(formatRate(0.5)).toBe("0.5x");
    expect(formatRate(1.5)).toBe("1.5x");
    expect(formatRate(2.5)).toBe("2.5x");
  });

  it("formats all defined playback rates", () => {
    for (const rate of PLAYBACK_RATES) {
      expect(formatRate(rate)).toBe(`${rate}x`);
    }
  });
});

describe("PLAYBACK_RATES", () => {
  it("is sorted in ascending order", () => {
    for (let i = 1; i < PLAYBACK_RATES.length; i++) {
      expect(PLAYBACK_RATES[i]).toBeGreaterThan(PLAYBACK_RATES[i - 1]);
    }
  });

  it("includes 1x (normal speed)", () => {
    expect(PLAYBACK_RATES).toContain(1);
  });

  it("contains only positive numbers", () => {
    for (const rate of PLAYBACK_RATES) {
      expect(rate).toBeGreaterThan(0);
    }
  });
});
