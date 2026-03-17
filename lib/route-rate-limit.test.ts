import { describe, expect, it } from "vitest";
import { buildRouteQuotaKey, getRequestIpAddress } from "./route-rate-limit";

describe("getRequestIpAddress", () => {
  it("prefers the first forwarded IP when multiple addresses are present", () => {
    const headers = new Headers({
      "x-forwarded-for": "203.0.113.10, 70.41.3.18, 150.172.238.178",
    });

    expect(getRequestIpAddress(headers)).toBe("203.0.113.10");
  });

  it("falls back through the known proxy headers", () => {
    const headers = new Headers({
      "cf-connecting-ip": "198.51.100.24",
    });

    expect(getRequestIpAddress(headers)).toBe("198.51.100.24");
  });
});

describe("buildRouteQuotaKey", () => {
  it("uses the scope and a stable hashed client identifier", () => {
    const key = buildRouteQuotaKey({
      scope: "did-you-know-daily-audio-sync",
      ipAddress: "203.0.113.10",
    });

    expect(key).toMatch(
      /^route-quota:did-you-know-daily-audio-sync:[a-f0-9]{32}$/,
    );
  });
});
