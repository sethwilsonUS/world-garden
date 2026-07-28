import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { TodayWikipediaData } from "./today-snapshot";
import { getTtsMetadata, getTtsProfile } from "./tts-profile";

const mocks = vi.hoisted(() => ({
  fetchAction: vi.fn(),
  fetchMutation: vi.fn(),
  fetchQuery: vi.fn(),
  uploadBlobToConvexStorage: vi.fn(),
  generateTtsAudioWithMetadata: vi.fn(),
  createAudioCacheReadAttestation: vi.fn(),
  createAudioCacheSaveAttestation: vi.fn(),
  createAudioCacheUploadAttestation: vi.fn(),
  getTrustedTtsGenerationHeaders: vi.fn(),
  recordAudioCacheReadResultBestEffort: vi.fn(),
  recordAudioCacheWriteFailureBestEffort: vi.fn(),
  createAudioCacheLedgerAssetKey: vi.fn(),
}));

vi.mock("convex/nextjs", () => ({
  fetchAction: mocks.fetchAction,
  fetchMutation: mocks.fetchMutation,
  fetchQuery: mocks.fetchQuery,
}));
vi.mock("@/convex/lib/storageUpload", () => ({
  uploadBlobToConvexStorage: mocks.uploadBlobToConvexStorage,
}));
vi.mock("@/lib/tts-client", () => ({
  generateTtsAudioWithMetadata: mocks.generateTtsAudioWithMetadata,
}));
vi.mock("@/lib/tts-quota-bypass", () => ({
  createAudioCacheReadAttestation: mocks.createAudioCacheReadAttestation,
  createAudioCacheSaveAttestation: mocks.createAudioCacheSaveAttestation,
  createAudioCacheUploadAttestation: mocks.createAudioCacheUploadAttestation,
  getTrustedTtsGenerationHeaders: mocks.getTrustedTtsGenerationHeaders,
}));
vi.mock("@/lib/audio-cache-ledger", () => ({
  recordAudioCacheReadResultBestEffort:
    mocks.recordAudioCacheReadResultBestEffort,
  recordAudioCacheWriteFailureBestEffort:
    mocks.recordAudioCacheWriteFailureBestEffort,
}));
vi.mock("@/lib/audio-cache-ledger-key", () => ({
  createAudioCacheLedgerAssetKey: mocks.createAudioCacheLedgerAssetKey,
}));

import { warmHomepageArticleSummaries } from "./homepage-audio-warm";

const edgeMetadata = getTtsMetadata(getTtsProfile("edge"));
const snapshot: TodayWikipediaData = {
  tfa: {
    title: "Legacy",
    extract: "",
    featuredDate: null,
    wikiPageId: "1",
  },
  trending: [],
  didYouKnow: [],
  inTheNews: [],
  pictureOfDay: null,
  onThisDay: [],
  trendingDate: null,
  trendingSource: null,
  trendingSourceType: null,
  trendingIsStale: false,
  feedDate: "2026-07-10",
  snapshotFeedDate: "2026-07-10",
  snapshotGeneratedAt: 1,
  snapshotIsStale: false,
};
const article = {
  _id: "article-1",
  title: "Legacy",
  revisionId: "revision-1",
  narrationVersion: 1,
  summary: "A sufficiently long legacy article summary.",
};

describe("homepage summary audio production adapter", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.unstubAllEnvs();
    vi.unstubAllGlobals();
    vi.stubEnv("TTS_QUOTA_BYPASS_SECRET", "server-secret");
    mocks.fetchAction.mockResolvedValue(article);
    mocks.fetchMutation.mockResolvedValue({
      urls: {},
      metadata: {},
      durations: {},
      byteLengths: {},
    });
    mocks.fetchQuery.mockResolvedValue({
      urls: {},
      metadata: {},
      durations: {},
      byteLengths: {},
    });
    mocks.createAudioCacheReadAttestation.mockResolvedValue({
      issuedAt: 1,
      expiresAt: 2,
      nonce: "read",
      signature: "signature",
    });
    mocks.createAudioCacheUploadAttestation.mockResolvedValue({
      issuedAt: 1,
      expiresAt: 2,
      nonce: "upload",
      signature: "signature",
    });
    mocks.createAudioCacheSaveAttestation.mockResolvedValue({
      issuedAt: 1,
      expiresAt: 2,
      nonce: "save",
      signature: "signature",
    });
    mocks.getTrustedTtsGenerationHeaders.mockResolvedValue({});
    mocks.generateTtsAudioWithMetadata.mockResolvedValue({
      blob: new Blob(["audio"], { type: "audio/mpeg" }),
      metadata: edgeMetadata,
    });
    mocks.uploadBlobToConvexStorage.mockResolvedValue("storage-1");
    mocks.recordAudioCacheReadResultBestEffort.mockResolvedValue(undefined);
    mocks.recordAudioCacheWriteFailureBestEffort.mockResolvedValue(undefined);
    mocks.createAudioCacheLedgerAssetKey.mockReturnValue(
      "00000000-0000-4000-8000-000000000001",
    );
  });

  afterEach(() => {
    vi.unstubAllEnvs();
    vi.unstubAllGlobals();
  });

  it("falls back to the public Edge cache read when the attestation secret is missing", async () => {
    vi.stubEnv("TTS_QUOTA_BYPASS_SECRET", "");
    mocks.createAudioCacheReadAttestation.mockRejectedValue(
      new Error("TTS_QUOTA_BYPASS_SECRET must be configured"),
    );
    mocks.fetchQuery.mockResolvedValue({
      urls: { summary: "https://audio.test/legacy.mp3" },
      metadata: { summary: edgeMetadata },
      durations: { summary: 12 },
      byteLengths: {},
    });
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => new Response("audio", { status: 200 })),
    );

    const result = await warmHomepageArticleSummaries({
      baseUrl: "https://curiogarden.org",
      snapshot,
    });

    expect(result).toMatchObject({
      status: "completed",
      reused: 1,
      generated: 0,
      failed: 0,
    });
    expect(mocks.fetchQuery).toHaveBeenCalledOnce();
    expect(mocks.fetchMutation).not.toHaveBeenCalled();
  });

  it("does not attribute upload setup failures to the cache record write", async () => {
    mocks.createAudioCacheUploadAttestation.mockRejectedValue(
      new Error("upload attestation unavailable"),
    );

    const result = await warmHomepageArticleSummaries({
      baseUrl: "https://curiogarden.org",
      snapshot,
    });

    expect(result.failed).toBe(1);
    expect(mocks.recordAudioCacheWriteFailureBestEffort).not.toHaveBeenCalled();
  });

  it("attributes a saveSectionAudioRecord failure to the cache record write", async () => {
    mocks.fetchMutation
      .mockResolvedValueOnce({
        urls: {},
        metadata: {},
        durations: {},
        byteLengths: {},
      })
      .mockResolvedValueOnce("https://upload.test/audio")
      .mockRejectedValueOnce(new Error("save failed"));

    const result = await warmHomepageArticleSummaries({
      baseUrl: "https://curiogarden.org",
      snapshot,
    });

    expect(result.failed).toBe(1);
    expect(mocks.recordAudioCacheWriteFailureBestEffort).toHaveBeenCalledWith({
      ledgerAssetKey: "00000000-0000-4000-8000-000000000001",
      source: "featured_audio_warm",
      provider: "edge",
    });
  });
});
