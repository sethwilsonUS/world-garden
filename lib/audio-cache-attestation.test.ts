import { describe, expect, it } from "vitest";
import {
  buildAudioCacheReadAttestationPayload,
  buildAudioCacheSaveAttestationPayload,
  buildAudioCacheUploadAttestationPayload,
  buildAudioCacheWriteFailureAttestationPayload,
  type AudioCacheSaveAttestationPayload,
} from "./audio-cache-attestation";

describe("audio cache attestation payloads", () => {
  it("binds a server cache read to the exact article, profile, and ordered sources", () => {
    expect(
      buildAudioCacheReadAttestationPayload({
        articleId: "article-1",
        ttsNormVersion: "ttsNorm:3",
        ttsCacheKey: "tts:openai:profile:ttsNorm:3",
        sourceHashes: [
          { sectionKey: "summary", sourceHash: "source-1" },
          { sectionKey: "section-0", sourceHash: "source-2" },
        ],
        ledgerSource: "interactive_article",
      }),
    ).toEqual([
      "article-1",
      "ttsNorm:3",
      "tts:openai:profile:ttsNorm:3",
      "interactive_article",
      2,
      "summary",
      "source-1",
      "section-0",
      "source-2",
    ]);
  });

  it("uses a stable upload operation payload", () => {
    expect(buildAudioCacheUploadAttestationPayload()).toEqual(["sectionAudio"]);
  });

  it("binds cache-write failure accounting to an opaque asset and bounded dimensions", () => {
    expect(
      buildAudioCacheWriteFailureAttestationPayload({
        ledgerAssetKey: "00000000-0000-4000-8000-000000000001",
        source: "interactive_article",
        provider: "edge",
      }),
    ).toEqual([
      "00000000-0000-4000-8000-000000000001",
      "interactive_article",
      "edge",
    ]);
  });

  it("binds every persisted cache field in a stable order", () => {
    expect(
      buildAudioCacheSaveAttestationPayload({
        articleId: "article-1",
        sectionKey: "summary",
        sourceHash: "source-1",
        storageId: "storage-1",
        ttsNormVersion: "ttsNorm:3",
        ttsCacheKey: "tts:edge:profile",
        provider: "edge",
        model: "edge-tts",
        voiceId: "en-US-AriaNeural",
        promptVersion: "edge-default",
        durationSeconds: 12,
        byteLength: 2_048,
        ledgerAssetKey: "asset-1",
        expectedExistingLedgerAssetKey: "asset-0",
        ledgerSource: "interactive_article",
      }),
    ).toEqual([
      "article-1",
      "summary",
      "source-1",
      "storage-1",
      "ttsNorm:3",
      "tts:edge:profile",
      "edge",
      "edge-tts",
      "en-US-AriaNeural",
      "edge-default",
      12,
      2_048,
      "asset-1",
      "asset-0",
      "interactive_article",
    ]);
  });

  it("represents absent optional metadata explicitly", () => {
    expect(
      buildAudioCacheSaveAttestationPayload({
        articleId: "article-1",
        sectionKey: "summary",
        sourceHash: "source-1",
        storageId: "storage-1",
        ttsNormVersion: "ttsNorm:3",
        ttsCacheKey: "tts:edge:profile",
      }).slice(-9),
    ).toEqual([null, null, null, null, null, null, null, null, null]);
  });

  it("changes the signed payload when any persisted field changes", () => {
    const original = {
      articleId: "article-1",
      sectionKey: "summary",
      sourceHash: "source-1",
      storageId: "storage-1",
      ttsNormVersion: "ttsNorm:3",
      ttsCacheKey: "tts:edge:profile",
      provider: "edge",
      model: "edge-tts",
      voiceId: "en-US-AriaNeural",
      promptVersion: "edge-default",
      durationSeconds: 12,
      byteLength: 2_048,
      ledgerAssetKey: "asset-1",
      expectedExistingLedgerAssetKey: "asset-0",
      ledgerSource: "interactive_article",
    } satisfies AudioCacheSaveAttestationPayload;
    const signedPayload = buildAudioCacheSaveAttestationPayload(original);
    const changes: Array<Partial<AudioCacheSaveAttestationPayload>> = [
      { articleId: "article-2" },
      { sectionKey: "section-0" },
      { sourceHash: "source-2" },
      { storageId: "storage-2" },
      { ttsNormVersion: "ttsNorm:4" },
      { ttsCacheKey: "tts:openai:profile" },
      { provider: "openai" },
      { model: "different-model" },
      { voiceId: "different-voice" },
      { promptVersion: "different-prompt" },
      { durationSeconds: 13 },
      { byteLength: 4_096 },
      { ledgerAssetKey: "asset-2" },
      { expectedExistingLedgerAssetKey: "asset-prior" },
      { ledgerSource: "featured_podcast" },
    ];

    for (const change of changes) {
      expect(
        buildAudioCacheSaveAttestationPayload({ ...original, ...change }),
      ).not.toEqual(signedPayload);
    }
  });
});
