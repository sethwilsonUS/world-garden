import { describe, expect, it } from "vitest";
import {
  buildAudioCacheSaveAttestationPayload,
  buildAudioCacheUploadAttestationPayload,
  type AudioCacheSaveAttestationPayload,
} from "./audio-cache-attestation";

describe("audio cache attestation payloads", () => {
  it("uses a stable upload operation payload", () => {
    expect(buildAudioCacheUploadAttestationPayload()).toEqual(["sectionAudio"]);
  });

  it("binds every persisted cache field in a stable order", () => {
    expect(
      buildAudioCacheSaveAttestationPayload({
        articleId: "article-1",
        sectionKey: "summary",
        sourceHash: "source-1",
        storageId: "storage-1",
        ttsNormVersion: "ttsNorm:2",
        ttsCacheKey: "tts:edge:profile",
        provider: "edge",
        model: "edge-tts",
        voiceId: "en-US-AriaNeural",
        promptVersion: "edge-default",
        durationSeconds: 12,
      }),
    ).toEqual([
      "article-1",
      "summary",
      "source-1",
      "storage-1",
      "ttsNorm:2",
      "tts:edge:profile",
      "edge",
      "edge-tts",
      "en-US-AriaNeural",
      "edge-default",
      12,
    ]);
  });

  it("represents absent optional metadata explicitly", () => {
    expect(
      buildAudioCacheSaveAttestationPayload({
        articleId: "article-1",
        sectionKey: "summary",
        sourceHash: "source-1",
        storageId: "storage-1",
        ttsNormVersion: "ttsNorm:2",
        ttsCacheKey: "tts:edge:profile",
      }).slice(-5),
    ).toEqual([null, null, null, null, null]);
  });

  it("changes the signed payload when any persisted field changes", () => {
    const original = {
      articleId: "article-1",
      sectionKey: "summary",
      sourceHash: "source-1",
      storageId: "storage-1",
      ttsNormVersion: "ttsNorm:2",
      ttsCacheKey: "tts:edge:profile",
      provider: "edge",
      model: "edge-tts",
      voiceId: "en-US-AriaNeural",
      promptVersion: "edge-default",
      durationSeconds: 12,
    } satisfies AudioCacheSaveAttestationPayload;
    const signedPayload = buildAudioCacheSaveAttestationPayload(original);
    const changes: Array<Partial<AudioCacheSaveAttestationPayload>> = [
      { articleId: "article-2" },
      { sectionKey: "section-0" },
      { sourceHash: "source-2" },
      { storageId: "storage-2" },
      { ttsNormVersion: "ttsNorm:3" },
      { ttsCacheKey: "tts:openai:profile" },
      { provider: "openai" },
      { model: "different-model" },
      { voiceId: "different-voice" },
      { promptVersion: "different-prompt" },
      { durationSeconds: 13 },
    ];

    for (const change of changes) {
      expect(
        buildAudioCacheSaveAttestationPayload({ ...original, ...change }),
      ).not.toEqual(signedPayload);
    }
  });
});
