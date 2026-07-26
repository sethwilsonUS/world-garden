import { afterEach, describe, expect, it } from "vitest";
import {
  buildPublicAudioWriteAttestationPayload,
  createPublicAudioWriteAttestation,
  verifyPublicAudioWriteAttestation,
} from "./public-audio-write-attestation";

describe("public audio write attestations", () => {
  afterEach(() => {
    delete process.env.TTS_QUOTA_BYPASS_SECRET;
  });

  it("binds the pipeline, operation, and complete canonical arguments", async () => {
    process.env.TTS_QUOTA_BYPASS_SECRET = "publication-secret";
    const identity = {
      pipeline: "trending" as const,
      operation: "save-record" as const,
      args: {
        status: "ready",
        nested: { voiceId: "en-US-AriaNeural", provider: "edge" },
        articleTitles: ["Rabbit", "The Shire"],
      },
    };
    const attestation = await createPublicAudioWriteAttestation(identity);

    await expect(
      verifyPublicAudioWriteAttestation({
        ...identity,
        attestation,
        secret: "publication-secret",
      }),
    ).resolves.toBe(true);
    await expect(
      verifyPublicAudioWriteAttestation({
        ...identity,
        args: { ...identity.args, status: "failed" },
        attestation,
        secret: "publication-secret",
      }),
    ).resolves.toBe(false);
    await expect(
      verifyPublicAudioWriteAttestation({
        ...identity,
        pipeline: "featured",
        attestation,
        secret: "publication-secret",
      }),
    ).resolves.toBe(false);
    await expect(
      verifyPublicAudioWriteAttestation({
        ...identity,
        operation: "finalize-job",
        attestation,
        secret: "publication-secret",
      }),
    ).resolves.toBe(false);
  });

  it("uses stable key ordering and omits optional undefined fields", () => {
    expect(
      buildPublicAudioWriteAttestationPayload({
        pipeline: "picture-of-day",
        operation: "save-record",
        args: { z: 1, optional: undefined, nested: { b: 2, a: 1 } },
      }),
    ).toEqual(
      buildPublicAudioWriteAttestationPayload({
        pipeline: "picture-of-day",
        operation: "save-record",
        args: { nested: { a: 1, b: 2 }, z: 1 },
      }),
    );
  });

  it("fails closed without the shared server secret", async () => {
    await expect(
      createPublicAudioWriteAttestation({
        pipeline: "featured",
        operation: "generate-upload-url",
        args: {},
      }),
    ).rejects.toThrow("TTS_QUOTA_BYPASS_SECRET must be configured");
  });
});
