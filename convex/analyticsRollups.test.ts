import { describe, expect, it } from "vitest";

import {
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
