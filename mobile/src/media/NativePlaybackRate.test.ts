import {
  DEFAULT_NATIVE_PLAYBACK_RATE,
  formatNativePlaybackRate,
  getNextNativePlaybackRate,
  NATIVE_PLAYBACK_RATES,
  parseNativePlaybackRate,
} from "./NativePlaybackRate";

describe("native playback rates", () => {
  it("exposes the reviewed cross-platform rates with normal speed as the default", () => {
    expect(NATIVE_PLAYBACK_RATES).toEqual([0.5, 0.75, 1, 1.25, 1.5, 1.75, 2]);
    expect(DEFAULT_NATIVE_PLAYBACK_RATE).toBe(1);
  });

  it.each(NATIVE_PLAYBACK_RATES)(
    "accepts the exact reviewed persisted value %s",
    (rate) => {
      expect(parseNativePlaybackRate(String(rate))).toBe(rate);
    },
  );

  it("rejects absent, malformed, or unsupported persisted values", () => {
    expect(parseNativePlaybackRate(null)).toBeNull();
    expect(parseNativePlaybackRate("2.5")).toBeNull();
    expect(parseNativePlaybackRate("1.5x")).toBeNull();
    expect(parseNativePlaybackRate(" 1.5 ")).toBeNull();
  });

  it.each([
    [0.5, 0.75],
    [0.75, 1],
    [1, 1.25],
    [1.25, 1.5],
    [1.5, 1.75],
    [1.75, 2],
    [2, 0.5],
  ] as const)("cycles %s to %s", (current, next) => {
    expect(getNextNativePlaybackRate(current)).toBe(next);
  });

  it("formats visible and spoken rate values without trailing decimals", () => {
    expect(formatNativePlaybackRate(0.75)).toBe("0.75x");
    expect(formatNativePlaybackRate(1)).toBe("1x");
    expect(formatNativePlaybackRate(2)).toBe("2x");
  });
});
