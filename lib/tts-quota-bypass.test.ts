import { afterEach, describe, expect, it } from "vitest";
import {
  createAudioCacheSaveAttestation,
  createAudioCacheUploadAttestation,
  getTtsQuotaBypassHeaders,
  TTS_QUOTA_BYPASS_HEADER,
} from "./tts-quota-bypass";
import {
  AUDIO_CACHE_SAVE_ATTESTATION_SCOPE,
  AUDIO_CACHE_UPLOAD_ATTESTATION_SCOPE,
  buildAudioCacheSaveAttestationPayload,
  buildAudioCacheUploadAttestationPayload,
} from "./audio-cache-attestation";
import { verifyServerAttestation } from "./server-attestation";

describe("getTtsQuotaBypassHeaders", () => {
  afterEach(() => {
    delete process.env.TTS_QUOTA_BYPASS_SECRET;
  });

  it("returns no headers when no trusted secret is configured", () => {
    expect(getTtsQuotaBypassHeaders()).toBeUndefined();
  });

  it("returns the trusted bypass header when configured", () => {
    process.env.TTS_QUOTA_BYPASS_SECRET = "internal-secret";

    expect(getTtsQuotaBypassHeaders()).toEqual({
      [TTS_QUOTA_BYPASS_HEADER]: "internal-secret",
    });
  });
});

describe("audio cache attestations", () => {
  afterEach(() => {
    delete process.env.TTS_QUOTA_BYPASS_SECRET;
  });

  it("fails clearly when the shared server secret is missing", async () => {
    await expect(createAudioCacheUploadAttestation()).rejects.toThrow(
      "TTS_QUOTA_BYPASS_SECRET must be configured",
    );
  });

  it("signs upload and payload-bound save operations", async () => {
    process.env.TTS_QUOTA_BYPASS_SECRET = "internal-secret";
    const savePayload = {
      articleId: "article-1",
      sectionKey: "summary",
      sourceHash: "source-1",
      storageId: "storage-1",
      ttsNormVersion: "ttsNorm:2",
      ttsCacheKey: "tts:edge:profile",
      provider: "edge",
      durationSeconds: 8,
    };

    const [uploadAttestation, saveAttestation] = await Promise.all([
      createAudioCacheUploadAttestation(),
      createAudioCacheSaveAttestation(savePayload),
    ]);

    await expect(
      verifyServerAttestation({
        attestation: uploadAttestation,
        scope: AUDIO_CACHE_UPLOAD_ATTESTATION_SCOPE,
        payload: buildAudioCacheUploadAttestationPayload(),
        secret: "internal-secret",
      }),
    ).resolves.toBe(true);
    await expect(
      verifyServerAttestation({
        attestation: saveAttestation,
        scope: AUDIO_CACHE_SAVE_ATTESTATION_SCOPE,
        payload: buildAudioCacheSaveAttestationPayload(savePayload),
        secret: "internal-secret",
      }),
    ).resolves.toBe(true);
    await expect(
      verifyServerAttestation({
        attestation: saveAttestation,
        scope: AUDIO_CACHE_SAVE_ATTESTATION_SCOPE,
        payload: buildAudioCacheSaveAttestationPayload({
          ...savePayload,
          storageId: "attacker-storage",
        }),
        secret: "internal-secret",
      }),
    ).resolves.toBe(false);
  });
});
