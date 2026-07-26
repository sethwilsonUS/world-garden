import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";
import { verifyServerAttestation } from "./server-attestation";
import {
  getRouteQuotaAttestationPayload,
  ROUTE_QUOTA_ATTESTATION_SCOPE,
} from "./route-quota-attestation";
import {
  buildRouteQuotaKey,
  enforceRouteQuota,
  getRequestIpAddress,
} from "./route-rate-limit";

const fetchMutation = vi.hoisted(() => vi.fn());

vi.mock("convex/nextjs", () => ({ fetchMutation }));

const originalSecret = process.env.TTS_QUOTA_BYPASS_SECRET;

beforeEach(() => {
  vi.clearAllMocks();
  process.env.TTS_QUOTA_BYPASS_SECRET = "route-quota-test-secret";
});

afterEach(() => {
  if (originalSecret === undefined) delete process.env.TTS_QUOTA_BYPASS_SECRET;
  else process.env.TTS_QUOTA_BYPASS_SECRET = originalSecret;
});

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

describe("enforceRouteQuota", () => {
  it("sends Convex a signed, parameter-bound quota request", async () => {
    fetchMutation.mockResolvedValue({
      allowed: true,
      remaining: 1,
      resetAt: Date.now() + 60_000,
    });
    const req = new NextRequest("https://example.test/api/test", {
      headers: { "x-forwarded-for": "203.0.113.10" },
    });

    await expect(
      enforceRouteQuota({
        req,
        scope: "test-route",
        limit: 2,
        windowMs: 60_000,
        label: "Test route",
      }),
    ).resolves.toBeNull();

    const args = fetchMutation.mock.calls[0]?.[1];
    expect(args).toMatchObject({ limit: 2, windowMs: 60_000 });
    expect(args).toHaveProperty("attestation.signature");
    expect(args).not.toHaveProperty("now");
    await expect(
      verifyServerAttestation({
        attestation: args.attestation,
        scope: ROUTE_QUOTA_ATTESTATION_SCOPE,
        payload: getRouteQuotaAttestationPayload(args),
        secret: "route-quota-test-secret",
      }),
    ).resolves.toBe(true);
  });

  it("fails closed before contacting Convex when the secret is missing", async () => {
    delete process.env.TTS_QUOTA_BYPASS_SECRET;
    const req = new NextRequest("https://example.test/api/test");

    await expect(
      enforceRouteQuota({
        req,
        scope: "test-route",
        limit: 2,
        windowMs: 60_000,
        label: "Test route",
      }),
    ).rejects.toThrow("TTS_QUOTA_BYPASS_SECRET must be configured");
    expect(fetchMutation).not.toHaveBeenCalled();
  });
});
