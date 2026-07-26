import { afterEach, describe, expect, it } from "vitest";
import {
  createTtsQuotaBypassHeaderValue,
  verifyTtsQuotaBypassHeaderValue,
} from "./tts-quota-bypass-attestation";

describe("TTS quota bypass attestations", () => {
  afterEach(() => {
    delete process.env.TTS_QUOTA_BYPASS_SECRET;
  });

  it("uses a short-lived signed value instead of sending the root secret", async () => {
    process.env.TTS_QUOTA_BYPASS_SECRET = "internal-secret";

    const value = await createTtsQuotaBypassHeaderValue();

    expect(value).not.toContain("internal-secret");
    await expect(
      verifyTtsQuotaBypassHeaderValue(value, {
        secret: "internal-secret",
      }),
    ).resolves.toBe(true);
    await expect(
      verifyTtsQuotaBypassHeaderValue(value, {
        secret: "wrong-secret",
      }),
    ).resolves.toBe(false);
  });

  it("rejects malformed and expired header values", async () => {
    process.env.TTS_QUOTA_BYPASS_SECRET = "internal-secret";
    const value = await createTtsQuotaBypassHeaderValue({
      now: 1_000,
      ttlMs: 100,
      nonce: "test-nonce",
    });

    await expect(
      verifyTtsQuotaBypassHeaderValue(value, {
        secret: "internal-secret",
        now: 1_101,
      }),
    ).resolves.toBe(false);
    await expect(
      verifyTtsQuotaBypassHeaderValue("internal-secret", {
        secret: "internal-secret",
      }),
    ).resolves.toBe(false);
    await expect(
      verifyTtsQuotaBypassHeaderValue("{not-json", {
        secret: "internal-secret",
      }),
    ).resolves.toBe(false);
  });
});
