import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { verifyServerAttestation } from "./server-attestation";
import {
  getRouteQuotaAttestationPayload,
  ROUTE_QUOTA_ATTESTATION_SCOPE,
} from "./route-quota-attestation";
import {
  type ConsumeTtsQuota,
  TTS_QUOTA_BYPASS_HEADER,
  resolveOpenAiTtsQuota,
} from "./tts-quota";

const fetchMutation = vi.hoisted(() => vi.fn());

vi.mock("convex/nextjs", () => ({ fetchMutation }));

const headersFor = (entries: Record<string, string> = {}) =>
  new Headers({
    "x-forwarded-for": "203.0.113.10",
    ...entries,
  });

const originalSecret = process.env.TTS_QUOTA_BYPASS_SECRET;

beforeEach(() => {
  vi.clearAllMocks();
});

afterEach(() => {
  if (originalSecret === undefined) delete process.env.TTS_QUOTA_BYPASS_SECRET;
  else process.env.TTS_QUOTA_BYPASS_SECRET = originalSecret;
});

describe("resolveOpenAiTtsQuota", () => {
  it("allows OpenAI when burst and daily windows are under quota", async () => {
    const consumeQuota = vi.fn<ConsumeTtsQuota>(async () => ({
      allowed: true,
      remaining: 119,
      resetAt: Date.now() + 1000,
    }));

    const decision = await resolveOpenAiTtsQuota({
      headers: headersFor(),
      provider: "openai",
      consumeQuota,
    });

    expect(decision).toEqual({
      mode: "public",
      exceeded: false,
    });
    expect(consumeQuota).toHaveBeenCalledTimes(2);
    expect(consumeQuota.mock.calls.map(([call]) => call.scope)).toEqual([
      "tts-openai-public-burst",
      "tts-openai-public-daily",
    ]);
  });

  it("attests both distributed quota windows before calling Convex", async () => {
    process.env.TTS_QUOTA_BYPASS_SECRET = "tts-quota-test-secret";
    fetchMutation.mockResolvedValue({
      allowed: true,
      remaining: 10,
      resetAt: Date.now() + 1_000,
    });

    await expect(
      resolveOpenAiTtsQuota({
        headers: headersFor(),
        provider: "openai",
      }),
    ).resolves.toEqual({ mode: "public", exceeded: false });
    expect(fetchMutation).toHaveBeenCalledTimes(2);

    for (const [, args] of fetchMutation.mock.calls) {
      expect(args).not.toHaveProperty("now");
      await expect(
        verifyServerAttestation({
          attestation: args.attestation,
          scope: ROUTE_QUOTA_ATTESTATION_SCOPE,
          payload: getRouteQuotaAttestationPayload(args),
          secret: "tts-quota-test-secret",
        }),
      ).resolves.toBe(true);
    }
  });

  it("routes to quota fallback when the burst window is exhausted", async () => {
    const consumeQuota = vi.fn(async () => ({
      allowed: false,
      remaining: 0,
      resetAt: Date.now() + 1000,
    }));

    const decision = await resolveOpenAiTtsQuota({
      headers: headersFor(),
      provider: "openai",
      consumeQuota,
    });

    expect(decision).toEqual({
      mode: "public",
      exceeded: true,
      exceededWindow: "burst",
      fallbackReason: "openai_quota",
    });
    expect(consumeQuota).toHaveBeenCalledTimes(1);
  });

  it("routes to quota fallback when the daily window is exhausted", async () => {
    const consumeQuota = vi
      .fn()
      .mockResolvedValueOnce({
        allowed: true,
        remaining: 100,
        resetAt: Date.now() + 1000,
      })
      .mockResolvedValueOnce({
        allowed: false,
        remaining: 0,
        resetAt: Date.now() + 1000,
      });

    const decision = await resolveOpenAiTtsQuota({
      headers: headersFor(),
      provider: "openai",
      consumeQuota,
    });

    expect(decision).toEqual({
      mode: "public",
      exceeded: true,
      exceededWindow: "daily",
      fallbackReason: "openai_quota",
    });
  });

  it("skips quota for explicit Edge requests", async () => {
    const consumeQuota = vi.fn();

    const decision = await resolveOpenAiTtsQuota({
      headers: headersFor(),
      provider: "edge",
      consumeQuota,
    });

    expect(decision).toEqual({
      mode: "edge_requested",
      exceeded: false,
    });
    expect(consumeQuota).not.toHaveBeenCalled();
  });

  it("skips quota when the trusted bypass header matches the secret", async () => {
    process.env.TTS_QUOTA_BYPASS_SECRET = "trust-me";
    const consumeQuota = vi.fn();

    const decision = await resolveOpenAiTtsQuota({
      headers: headersFor({ [TTS_QUOTA_BYPASS_HEADER]: "trust-me" }),
      provider: "openai",
      consumeQuota,
    });

    expect(decision).toEqual({
      mode: "bypass",
      exceeded: false,
    });
    expect(consumeQuota).not.toHaveBeenCalled();

    delete process.env.TTS_QUOTA_BYPASS_SECRET;
  });

  it("routes to quota fallback when quota storage cannot be checked", async () => {
    const consumeQuota = vi.fn(async () => {
      throw new Error("Convex unavailable");
    });

    const decision = await resolveOpenAiTtsQuota({
      headers: headersFor(),
      provider: "openai",
      consumeQuota,
    });

    expect(decision).toEqual({
      mode: "public",
      exceeded: true,
      fallbackReason: "openai_quota",
      quotaError: "Convex unavailable",
    });
  });

  it("fails closed to Edge when the attestation secret is unavailable", async () => {
    delete process.env.TTS_QUOTA_BYPASS_SECRET;
    const decision = await resolveOpenAiTtsQuota({
      headers: headersFor(),
      provider: "openai",
    });

    expect(decision).toEqual({
      mode: "public",
      exceeded: true,
      fallbackReason: "openai_quota",
      quotaError: expect.stringContaining(
        "TTS_QUOTA_BYPASS_SECRET must be configured",
      ),
    });
    expect(fetchMutation).not.toHaveBeenCalled();
  });
});
