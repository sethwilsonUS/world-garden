import { describe, expect, it } from "vitest";

import {
  addRollupCounts,
  assertValidDeliveryExpiry,
  assertValidRollupCount,
} from "./analyticsRollups";

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

  it("adds aggregate counts while the result remains safe", () => {
    expect(addRollupCounts(4, 6)).toBe(10);
    expect(addRollupCounts(Number.MAX_SAFE_INTEGER - 1, 1)).toBe(
      Number.MAX_SAFE_INTEGER,
    );
  });

  it("rejects aggregate count overflow and invalid existing counts", () => {
    for (const [existingCount, incomingCount] of [
      [Number.MAX_SAFE_INTEGER, 1],
      [Number.MAX_SAFE_INTEGER - 1, 2],
      [0.5, 1],
      [-1, 1],
      [Number.NaN, 1],
    ] satisfies Array<[number, number]>) {
      expect(() => addRollupCounts(existingCount, incomingCount)).toThrow(
        "Rollup count overflow",
      );
    }
  });

  it("accepts delivery expiry timestamps in a bounded future window", () => {
    const now = 1_800_000_000_000;

    expect(() => assertValidDeliveryExpiry(now + 1, now)).not.toThrow();
    expect(() =>
      assertValidDeliveryExpiry(now + 7 * 24 * 60 * 60 * 1000, now),
    ).not.toThrow();
  });

  it("rejects stale, fractional, and overly distant delivery expiries", () => {
    const now = 1_800_000_000_000;

    for (const deliveryExpiresAt of [
      now,
      now - 1,
      now + 0.5,
      Number.NaN,
      now + 7 * 24 * 60 * 60 * 1000 + 1,
    ]) {
      expect(() => assertValidDeliveryExpiry(deliveryExpiresAt, now)).toThrow(
        "deliveryExpiresAt must be a future Unix ms timestamp within 7 days",
      );
    }
  });
});
