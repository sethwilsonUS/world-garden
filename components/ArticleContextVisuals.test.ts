import { describe, expect, it } from "vitest";
import { getFallbackBarGeometry } from "./ArticleContextVisuals";

describe("article context fallback chart geometry", () => {
  it("anchors positive and negative bars to the same zero baseline", () => {
    const negative = getFallbackBarGeometry(-10, -10, 10);
    const positive = getFallbackBarGeometry(10, -10, 10);

    expect(negative.zeroY).toBeCloseTo(positive.zeroY);
    expect(negative.y).toBeCloseTo(negative.zeroY);
    expect(negative.height).toBeGreaterThan(0);
    expect(positive.y).toBeLessThan(positive.zeroY);
    expect(positive.y + positive.height).toBeCloseTo(positive.zeroY);
  });

  it("places zero at the top when every fallback bar is negative", () => {
    const negative = getFallbackBarGeometry(-5, -10, 0);

    expect(negative.zeroY).toBe(24);
    expect(negative.y).toBe(negative.zeroY);
    expect(negative.height).toBeGreaterThan(0);
  });
});
