import { describe, expect, it } from "vitest";
import { createServerAttestation } from "../lib/server-attestation";
import {
  getRouteQuotaAttestationPayload,
  ROUTE_QUOTA_ATTESTATION_SCOPE,
} from "../lib/route-quota-attestation";
import { assertRouteQuotaAttestation } from "./rateLimits";

describe("route quota attestation boundary", () => {
  const parameters = {
    key: "route-quota:tts-openai-public-daily:client-hash",
    limit: 800,
    windowMs: 86_400_000,
  };
  const secret = "shared-test-secret";

  const sign = async () =>
    await createServerAttestation({
      scope: ROUTE_QUOTA_ATTESTATION_SCOPE,
      payload: getRouteQuotaAttestationPayload(parameters),
      secret,
      now: 1_000,
      nonce: "route-quota-test",
    });

  it("accepts a fresh attestation bound to every quota parameter", async () => {
    await expect(
      assertRouteQuotaAttestation(parameters, await sign(), secret, 1_001),
    ).resolves.toBeUndefined();
  });

  it.each([
    ["key", "route-quota:attacker:rotated"],
    ["limit", 80_000],
    ["windowMs", 1],
  ] as const)("rejects a caller-tampered %s", async (field, value) => {
    await expect(
      assertRouteQuotaAttestation(
        { ...parameters, [field]: value },
        await sign(),
        secret,
        1_001,
      ),
    ).rejects.toThrow("Invalid or expired route quota attestation.");
  });

  it("rejects missing secrets and expired attestations", async () => {
    const attestation = await sign();

    await expect(
      assertRouteQuotaAttestation(parameters, attestation, undefined, 1_001),
    ).rejects.toThrow("Invalid or expired route quota attestation.");
    await expect(
      assertRouteQuotaAttestation(parameters, attestation, secret, 61_001),
    ).rejects.toThrow("Invalid or expired route quota attestation.");
  });

  it("rejects invalid quota bounds before touching storage", async () => {
    await expect(
      assertRouteQuotaAttestation(
        { ...parameters, limit: 0 },
        await sign(),
        secret,
        1_001,
      ),
    ).rejects.toThrow("Invalid route quota parameters.");
  });
});
