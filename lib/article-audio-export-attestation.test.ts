import { afterEach, describe, expect, it } from "vitest";
import {
  ARTICLE_AUDIO_EXPORT_READ_ATTESTATION_SCOPE,
  buildArticleAudioExportReadAttestationPayload,
  createArticleAudioExportReadAttestation,
} from "./article-audio-export-attestation";
import { verifyServerAttestation } from "./server-attestation";

describe("article audio export read attestations", () => {
  afterEach(() => {
    delete process.env.TTS_QUOTA_BYPASS_SECRET;
  });

  it("binds the export ID and exact voice profile", async () => {
    process.env.TTS_QUOTA_BYPASS_SECRET = "internal-secret";
    const payload = {
      exportId: "export-1",
      ttsCacheKey: "tts:openai:profile:ttsNorm:3",
    };
    const attestation = await createArticleAudioExportReadAttestation(payload);

    await expect(
      verifyServerAttestation({
        attestation,
        scope: ARTICLE_AUDIO_EXPORT_READ_ATTESTATION_SCOPE,
        payload: buildArticleAudioExportReadAttestationPayload(payload),
        secret: "internal-secret",
      }),
    ).resolves.toBe(true);
    await expect(
      verifyServerAttestation({
        attestation,
        scope: ARTICLE_AUDIO_EXPORT_READ_ATTESTATION_SCOPE,
        payload: buildArticleAudioExportReadAttestationPayload({
          ...payload,
          exportId: "export-2",
        }),
        secret: "internal-secret",
      }),
    ).resolves.toBe(false);
  });

  it("fails closed when the shared server secret is missing", async () => {
    await expect(
      createArticleAudioExportReadAttestation({
        exportId: "export-1",
        ttsCacheKey: "tts:openai:profile:ttsNorm:3",
      }),
    ).rejects.toThrow("TTS_QUOTA_BYPASS_SECRET must be configured");
  });
});
