import { afterEach, describe, expect, it } from "vitest";
import {
  createAudioCacheReadAttestation,
  createAudioCacheSaveAttestation,
  createAudioCacheUploadAttestation,
  getEdgeTtsGenerationHeaders,
  getTrustedTtsGenerationHeaders,
  getTtsQuotaBypassHeaders,
  TTS_QUOTA_BYPASS_HEADER,
} from "./tts-quota-bypass";
import {
  AUDIO_CACHE_READ_ATTESTATION_SCOPE,
  AUDIO_CACHE_SAVE_ATTESTATION_SCOPE,
  AUDIO_CACHE_UPLOAD_ATTESTATION_SCOPE,
  buildAudioCacheReadAttestationPayload,
  buildAudioCacheSaveAttestationPayload,
  buildAudioCacheUploadAttestationPayload,
} from "./audio-cache-attestation";
import { verifyServerAttestation } from "./server-attestation";
import { verifyTtsQuotaBypassHeaderValue } from "./tts-quota-bypass-attestation";
import {
  resolveTtsAiCostSource,
  TTS_AI_COST_SOURCE_ATTESTATION_HEADER,
  TTS_AI_COST_SOURCE_HEADER,
} from "./tts-source-attestation";

describe("getTtsQuotaBypassHeaders", () => {
  afterEach(() => {
    delete process.env.TTS_QUOTA_BYPASS_SECRET;
    delete process.env.VERCEL_AUTOMATION_BYPASS_SECRET;
  });

  it("returns no headers when no trusted secret is configured", async () => {
    await expect(
      getTtsQuotaBypassHeaders("https://curiogarden.org"),
    ).resolves.toBeUndefined();
  });

  it("returns a short-lived bypass attestation when configured", async () => {
    process.env.TTS_QUOTA_BYPASS_SECRET = "internal-secret";
    process.env.VERCEL_AUTOMATION_BYPASS_SECRET = "preview-secret";

    const headers = await getTtsQuotaBypassHeaders("https://curiogarden.org");
    const headerValue = headers?.[TTS_QUOTA_BYPASS_HEADER];

    expect(headerValue).toBeTypeOf("string");
    expect(headerValue).not.toContain("internal-secret");
    expect(headers?.["x-vercel-protection-bypass"]).toBe("preview-secret");
    await expect(
      verifyTtsQuotaBypassHeaderValue(headerValue, {
        secret: "internal-secret",
      }),
    ).resolves.toBe(true);
  });

  it("does not attach trusted headers to an untrusted destination", async () => {
    process.env.TTS_QUOTA_BYPASS_SECRET = "internal-secret";
    process.env.VERCEL_AUTOMATION_BYPASS_SECRET = "preview-secret";

    await expect(
      getTtsQuotaBypassHeaders("https://attacker.example"),
    ).rejects.toThrow("untrusted origin");
    await expect(
      getTrustedTtsGenerationHeaders(
        "https://attacker.example",
        "featured_podcast",
      ),
    ).rejects.toThrow("untrusted origin");
    expect(() =>
      getEdgeTtsGenerationHeaders("https://attacker.example"),
    ).toThrow("untrusted origin");
  });

  it("gives Edge generation only the deployment-protection header", () => {
    process.env.TTS_QUOTA_BYPASS_SECRET = "internal-secret";
    process.env.VERCEL_AUTOMATION_BYPASS_SECRET = "preview-secret";

    expect(getEdgeTtsGenerationHeaders("https://curiogarden.org")).toEqual({
      "x-vercel-protection-bypass": "preview-secret",
    });
  });

  it("attests a bounded source without granting Edge generation quota authority", async () => {
    process.env.TTS_QUOTA_BYPASS_SECRET = "internal-secret";
    process.env.VERCEL_AUTOMATION_BYPASS_SECRET = "preview-secret";

    const headers = await getTrustedTtsGenerationHeaders(
      "https://curiogarden.org",
      "featured_podcast",
    );

    expect(headers).toMatchObject({
      "x-vercel-protection-bypass": "preview-secret",
      [TTS_AI_COST_SOURCE_HEADER]: "featured_podcast",
    });
    expect(headers).not.toHaveProperty(TTS_QUOTA_BYPASS_HEADER);
    expect(headers?.[TTS_AI_COST_SOURCE_ATTESTATION_HEADER]).toBeTypeOf(
      "string",
    );
    await expect(
      resolveTtsAiCostSource(new Headers(headers), {
        secret: "internal-secret",
      }),
    ).resolves.toBe("featured_podcast");
  });

  it("adds quota authority when a trusted OpenAI background job requests it", async () => {
    process.env.TTS_QUOTA_BYPASS_SECRET = "internal-secret";

    const headers = await getTrustedTtsGenerationHeaders(
      "https://curiogarden.org",
      "trending_podcast",
      { bypassOpenAiQuota: true },
    );

    await expect(
      verifyTtsQuotaBypassHeaderValue(headers[TTS_QUOTA_BYPASS_HEADER], {
        secret: "internal-secret",
      }),
    ).resolves.toBe(true);
    await expect(
      resolveTtsAiCostSource(new Headers(headers), {
        secret: "internal-secret",
      }),
    ).resolves.toBe("trending_podcast");
  });

  it("fails open to an untrusted source claim when source signing is unavailable", async () => {
    const headers = await getTrustedTtsGenerationHeaders(
      "https://curiogarden.org",
      "picture_of_day",
    );

    expect(headers).toEqual({
      [TTS_AI_COST_SOURCE_HEADER]: "picture_of_day",
    });
    await expect(resolveTtsAiCostSource(new Headers(headers))).resolves.toBe(
      "unknown",
    );
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
      ttsNormVersion: "ttsNorm:3",
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

  it("signs a payload-bound server cache read", async () => {
    process.env.TTS_QUOTA_BYPASS_SECRET = "internal-secret";
    const readPayload = {
      articleId: "article-1",
      ttsNormVersion: "ttsNorm:3",
      ttsCacheKey: "tts:openai:profile:ttsNorm:3",
      sourceHashes: [{ sectionKey: "summary", sourceHash: "source-1" }],
    };

    const attestation = await createAudioCacheReadAttestation(readPayload);

    await expect(
      verifyServerAttestation({
        attestation,
        scope: AUDIO_CACHE_READ_ATTESTATION_SCOPE,
        payload: buildAudioCacheReadAttestationPayload(readPayload),
        secret: "internal-secret",
      }),
    ).resolves.toBe(true);
    await expect(
      verifyServerAttestation({
        attestation,
        scope: AUDIO_CACHE_READ_ATTESTATION_SCOPE,
        payload: buildAudioCacheReadAttestationPayload({
          ...readPayload,
          sourceHashes: [
            { sectionKey: "summary", sourceHash: "attacker-source" },
          ],
        }),
        secret: "internal-secret",
      }),
    ).resolves.toBe(false);
  });
});
