import { describe, expect, it } from "vitest";
import {
  createServerAttestation,
  verifyServerAttestation,
} from "./server-attestation";

describe("server attestations", () => {
  const secret = "test-server-secret";
  const payload = ["article-id", "summary", "source-hash"];

  it("verifies a fresh, scope-bound, payload-bound attestation", async () => {
    const attestation = await createServerAttestation({
      scope: "audio-cache:save",
      payload,
      secret,
      now: 1_000,
      nonce: "nonce-a",
    });

    await expect(
      verifyServerAttestation({
        attestation,
        scope: "audio-cache:save",
        payload,
        secret,
        now: 1_001,
      }),
    ).resolves.toBe(true);
  });

  it("rejects tampered payloads and cross-scope replay", async () => {
    const attestation = await createServerAttestation({
      scope: "audio-cache:save",
      payload,
      secret,
      now: 1_000,
      nonce: "nonce-b",
    });

    await expect(
      verifyServerAttestation({
        attestation,
        scope: "audio-cache:save",
        payload: [...payload, "tampered"],
        secret,
        now: 1_001,
      }),
    ).resolves.toBe(false);
    await expect(
      verifyServerAttestation({
        attestation,
        scope: "route-quota:consume",
        payload,
        secret,
        now: 1_001,
      }),
    ).resolves.toBe(false);
  });

  it("rejects expired and implausibly long-lived attestations", async () => {
    const expired = await createServerAttestation({
      scope: "audio-cache:upload",
      payload: [],
      secret,
      now: 1_000,
      ttlMs: 50,
      nonce: "nonce-c",
    });
    const tooLong = await createServerAttestation({
      scope: "audio-cache:upload",
      payload: [],
      secret,
      now: 1_000,
      ttlMs: 10 * 60_000,
      nonce: "nonce-d",
    });

    await expect(
      verifyServerAttestation({
        attestation: expired,
        scope: "audio-cache:upload",
        payload: [],
        secret,
        now: 1_051,
      }),
    ).resolves.toBe(false);
    await expect(
      verifyServerAttestation({
        attestation: tooLong,
        scope: "audio-cache:upload",
        payload: [],
        secret,
        now: 1_001,
      }),
    ).resolves.toBe(false);
  });

  it("fails closed when the shared secret or signature is missing", async () => {
    const attestation = await createServerAttestation({
      scope: "audio-cache:upload",
      payload: [],
      secret,
      now: 1_000,
      nonce: "nonce-e",
    });

    await expect(
      verifyServerAttestation({
        attestation,
        scope: "audio-cache:upload",
        payload: [],
        secret: undefined,
        now: 1_001,
      }),
    ).resolves.toBe(false);
    await expect(
      verifyServerAttestation({
        attestation: { ...attestation, signature: "" },
        scope: "audio-cache:upload",
        payload: [],
        secret,
        now: 1_001,
      }),
    ).resolves.toBe(false);
  });
});
