import { describe, expect, it } from "vitest";

import { assertValidRollupCount } from "./analyticsRollups";

describe("analytics rollups", () => {
  it("accepts positive safe integer counts", () => {
    expect(() => assertValidRollupCount(1)).not.toThrow();
    expect(() =>
      assertValidRollupCount(Number.MAX_SAFE_INTEGER),
    ).not.toThrow();
  });

  it("rejects non-positive, fractional, and unsafe counts", () => {
    for (const count of [0, -1, 0.5, Number.NaN, Number.MAX_SAFE_INTEGER + 1]) {
      expect(() => assertValidRollupCount(count)).toThrow(
        "Rollup counts must be positive integers",
      );
    }
  });
});
