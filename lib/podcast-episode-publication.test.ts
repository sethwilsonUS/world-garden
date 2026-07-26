import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { FetchAndCacheResult } from "@/convex/articles";
import {
  ARTICLE_SECTION_NARRATION_VERSION,
  buildArticleNarrationHash,
} from "./section-narration";
import { getTtsMetadata, getTtsProfile } from "./tts-profile";
import { verifyPublicAudioWriteAttestation } from "./public-audio-write-attestation";

const mocks = vi.hoisted(() => ({
  addMp3MetadataToBlob: vi.fn(),
  concatenateMp3Blobs: vi.fn(),
  createAudioCacheSaveAttestation: vi.fn(),
  createAudioCacheUploadAttestation: vi.fn(),
  fetchAction: vi.fn(),
  fetchMutation: vi.fn(),
  fetchQuery: vi.fn(),
  generateTtsAudioWithMetadata: vi.fn(),
  getEdgeTtsGenerationHeaders: vi.fn(),
  getTodayWikipediaData: vi.fn(),
  renderFeaturedPodcastArtworkPng: vi.fn(),
}));

vi.mock("node:crypto", async (importOriginal) => ({
  ...(await importOriginal<typeof import("node:crypto")>()),
  randomUUID: () => "11111111-1111-4111-8111-111111111111",
}));

vi.mock("convex/nextjs", () => ({
  fetchAction: mocks.fetchAction,
  fetchMutation: mocks.fetchMutation,
  fetchQuery: mocks.fetchQuery,
}));

vi.mock("@/lib/audio-metadata", () => ({
  addMp3MetadataToBlob: mocks.addMp3MetadataToBlob,
  concatenateMp3Blobs: mocks.concatenateMp3Blobs,
}));

vi.mock("@/lib/featured-podcast-artwork", () => ({
  FEATURED_EPISODE_ARTWORK_VERSION: 2,
  renderFeaturedPodcastArtworkPng: mocks.renderFeaturedPodcastArtworkPng,
}));

vi.mock("@/lib/today-snapshot", () => ({
  getTodayWikipediaData: mocks.getTodayWikipediaData,
}));

vi.mock("@/lib/tts-client", () => ({
  generateTtsAudioWithMetadata: mocks.generateTtsAudioWithMetadata,
}));

vi.mock("@/lib/tts-quota-bypass", () => ({
  createAudioCacheSaveAttestation: mocks.createAudioCacheSaveAttestation,
  createAudioCacheUploadAttestation: mocks.createAudioCacheUploadAttestation,
  getEdgeTtsGenerationHeaders: mocks.getEdgeTtsGenerationHeaders,
}));

import { syncFeaturedPodcastEpisode } from "./podcast-episode";

const article = {
  _id: "article-1" as never,
  wikiPageId: "123",
  title: "Featured article",
  language: "en",
  revisionId: "456",
  narrationVersion: ARTICLE_SECTION_NARRATION_VERSION,
  lastEdited: "2026-07-26T00:00:00Z",
  summary: "A concise featured article summary for the podcast.",
  contentText: "unused",
  thumbnailUrl: "https://images.example.test/featured.jpg",
  sections: [],
} satisfies FetchAndCacheResult;

const edgeMetadata = getTtsMetadata(getTtsProfile("edge"));
const owner = "11111111-1111-4111-8111-111111111111";

const getAttestedWriteArgs = async (
  callIndex: number,
  operation:
    | "claim-job"
    | "finalize-job"
    | "generate-upload-url"
    | "save-record",
) => {
  const mutationArgs = mocks.fetchMutation.mock.calls[callIndex]?.[1] as
    | (Record<string, unknown> & {
        attestation?: Parameters<
          typeof verifyPublicAudioWriteAttestation
        >[0]["attestation"];
      })
    | undefined;
  expect(mutationArgs).toBeDefined();
  const { attestation, ...writeArgs } = mutationArgs ?? {};
  await expect(
    verifyPublicAudioWriteAttestation({
      pipeline: "featured",
      operation,
      args: writeArgs,
      attestation,
    }),
  ).resolves.toBe(true);
  return writeArgs;
};

const createAudioResponse = () =>
  new Response(new Blob(["cached audio"], { type: "audio/mpeg" }), {
    status: 200,
    headers: { "Content-Type": "audio/mpeg" },
  });

const createAssetUploadResponse = (
  init: RequestInit | undefined,
  suffix: string,
): Response => {
  const contentType = new Headers(init?.headers).get("Content-Type");
  if (contentType === "audio/mpeg") {
    return Response.json({ storageId: `audio-storage-${suffix}` });
  }
  if (contentType === "image/png") {
    return Response.json({ storageId: `artwork-storage-${suffix}` });
  }
  return new Response(null, { status: 415 });
};

beforeEach(() => {
  vi.stubEnv("TTS_QUOTA_BYPASS_SECRET", "publication-secret");
  Object.values(mocks).forEach((mock) => mock.mockReset());
  mocks.getTodayWikipediaData.mockResolvedValue({
    feedDate: "2026-07-26",
    tfa: {
      title: article.title,
      extract: article.summary,
      featuredDate: "2026-07-26T00:00:00.000Z",
    },
  });
  mocks.fetchAction.mockResolvedValue(article);
  mocks.concatenateMp3Blobs.mockResolvedValue(
    new Blob(["combined audio"], { type: "audio/mpeg" }),
  );
  mocks.addMp3MetadataToBlob.mockImplementation(async (blob: Blob) => blob);
  mocks.renderFeaturedPodcastArtworkPng.mockResolvedValue({
    data: new Uint8Array([1, 2, 3]),
    mimeType: "image/png",
  });
  mocks.createAudioCacheSaveAttestation.mockResolvedValue({
    signature: "save-attestation",
  });
  mocks.createAudioCacheUploadAttestation.mockResolvedValue({
    signature: "upload-attestation",
  });
  mocks.getEdgeTtsGenerationHeaders.mockReturnValue({
    "x-vercel-protection-bypass": "preview-secret",
  });
  vi.spyOn(console, "info").mockImplementation(() => undefined);
  vi.spyOn(console, "error").mockImplementation(() => undefined);
});

afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
});

describe("syncFeaturedPodcastEpisode publication attestations", () => {
  it("uses destination-scoped Edge headers for generated section audio", async () => {
    const baseUrl = "https://curio.example.test";
    const generationHeaders = {
      "x-vercel-protection-bypass": "preview-secret",
    };
    mocks.fetchQuery
      .mockResolvedValueOnce(null)
      .mockResolvedValueOnce({ urls: {}, metadata: {} })
      .mockResolvedValueOnce({ _id: "episode-1", status: "ready" });
    mocks.fetchMutation
      .mockResolvedValueOnce({ claimed: true, attempts: 1 })
      .mockResolvedValueOnce("pending-episode")
      .mockResolvedValueOnce("https://upload.example.test/section")
      .mockResolvedValueOnce("section-record")
      .mockResolvedValueOnce("https://upload.example.test/assets")
      .mockResolvedValueOnce("https://upload.example.test/assets")
      .mockResolvedValueOnce("episode-1")
      .mockResolvedValueOnce({ updated: true });
    mocks.generateTtsAudioWithMetadata.mockResolvedValue({
      blob: new Blob(["generated audio"], { type: "audio/mpeg" }),
      metadata: edgeMetadata,
    });
    vi.stubGlobal(
      "fetch",
      vi.fn(async (input: string | URL | Request, init?: RequestInit) => {
        const url = String(input);
        if (url === "https://upload.example.test/section") {
          return Response.json({ storageId: "section-storage-1" });
        }
        if (url === "https://upload.example.test/assets") {
          return createAssetUploadResponse(init, "generated");
        }
        return new Response(null, { status: 404 });
      }),
    );

    await expect(
      syncFeaturedPodcastEpisode({ baseUrl }),
    ).resolves.toMatchObject({ status: "created", generatedSectionCount: 1 });
    expect(mocks.getEdgeTtsGenerationHeaders).toHaveBeenCalledWith(baseUrl);
    expect(mocks.generateTtsAudioWithMetadata).toHaveBeenCalledWith(
      expect.objectContaining({ provider: "edge" }),
      { apiBaseUrl: baseUrl, headers: generationHeaders },
    );
  });

  it("attests every claim, upload, save, and finalize write on a new episode", async () => {
    mocks.fetchQuery
      .mockResolvedValueOnce(null)
      .mockResolvedValueOnce({
        urls: { summary: "https://cache.example.test/summary.mp3" },
        metadata: { summary: edgeMetadata },
      })
      .mockResolvedValueOnce({ _id: "episode-1", status: "ready" });
    mocks.fetchMutation
      .mockResolvedValueOnce({ claimed: true, attempts: 1 })
      .mockResolvedValueOnce("pending-episode")
      .mockResolvedValueOnce("https://upload.example.test/assets")
      .mockResolvedValueOnce("https://upload.example.test/assets")
      .mockResolvedValueOnce("episode-1")
      .mockResolvedValueOnce({ updated: true });
    vi.stubGlobal(
      "fetch",
      vi.fn(async (input: string | URL | Request, init?: RequestInit) => {
        const url = String(input);
        if (url === "https://cache.example.test/summary.mp3") {
          return createAudioResponse();
        }
        if (url === "https://upload.example.test/assets") {
          return createAssetUploadResponse(init, "1");
        }
        return new Response(null, { status: 404 });
      }),
    );

    await expect(
      syncFeaturedPodcastEpisode({ baseUrl: "https://curio.example.test" }),
    ).resolves.toMatchObject({ status: "created" });

    expect(mocks.fetchMutation).toHaveBeenCalledTimes(6);
    await expect(getAttestedWriteArgs(0, "claim-job")).resolves.toEqual({
      featuredDate: "2026-07-26",
      articleId: "article-1",
      owner,
      leaseMs: 8 * 60 * 1000,
    });
    await expect(getAttestedWriteArgs(1, "save-record")).resolves.toMatchObject(
      {
        featuredDate: "2026-07-26",
        articleId: "article-1",
        owner,
        status: "pending",
        provider: "edge",
      },
    );
    await expect(
      getAttestedWriteArgs(2, "generate-upload-url"),
    ).resolves.toEqual({});
    await expect(
      getAttestedWriteArgs(3, "generate-upload-url"),
    ).resolves.toEqual({});
    await expect(getAttestedWriteArgs(4, "save-record")).resolves.toMatchObject(
      {
        featuredDate: "2026-07-26",
        storageId: "audio-storage-1",
        artworkStorageId: "artwork-storage-1",
        owner,
        status: "ready",
        provider: "edge",
      },
    );
    await expect(getAttestedWriteArgs(5, "finalize-job")).resolves.toEqual({
      featuredDate: "2026-07-26",
      articleId: "article-1",
      owner,
      status: "ready",
      lastError: undefined,
    });
    expect(mocks.generateTtsAudioWithMetadata).not.toHaveBeenCalled();
  });

  it("attests failed finalization and the failed episode record", async () => {
    mocks.fetchQuery.mockResolvedValueOnce(null).mockResolvedValueOnce({
      urls: { summary: "https://cache.example.test/summary.mp3" },
      metadata: { summary: edgeMetadata },
    });
    mocks.fetchMutation
      .mockResolvedValueOnce({ claimed: true, attempts: 1 })
      .mockResolvedValueOnce("pending-episode")
      .mockResolvedValueOnce("failed-episode")
      .mockResolvedValueOnce({ updated: true });
    mocks.concatenateMp3Blobs.mockRejectedValue(new Error("concat exploded"));
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => createAudioResponse()),
    );

    await expect(
      syncFeaturedPodcastEpisode({ baseUrl: "https://curio.example.test" }),
    ).rejects.toThrow("concat exploded");

    expect(mocks.fetchMutation).toHaveBeenCalledTimes(4);
    await expect(getAttestedWriteArgs(2, "save-record")).resolves.toMatchObject(
      {
        featuredDate: "2026-07-26",
        articleId: "article-1",
        owner,
        status: "failed",
        provider: "edge",
      },
    );
    await expect(
      getAttestedWriteArgs(3, "finalize-job"),
    ).resolves.toMatchObject({
      featuredDate: "2026-07-26",
      articleId: "article-1",
      owner,
      status: "failed",
      lastError: expect.stringContaining("concat exploded"),
    });
  });

  it("attests artwork-regeneration uploads and replacement save", async () => {
    const narrationHash = buildArticleNarrationHash(article);
    const existingEpisode = {
      _id: "episode-1",
      status: "ready",
      articleId: "article-1",
      wikiPageId: article.wikiPageId,
      title: article.title,
      artworkVersion: 1,
      audioUrl: "https://cache.example.test/episode.mp3",
      narrationHash,
      durationSeconds: 24,
      ...edgeMetadata,
    };
    mocks.fetchQuery
      .mockResolvedValueOnce(existingEpisode)
      .mockResolvedValueOnce({ ...existingEpisode, artworkVersion: 2 });
    mocks.fetchMutation
      .mockResolvedValueOnce({ claimed: true, attempts: 1 })
      .mockResolvedValueOnce("https://upload.example.test/assets")
      .mockResolvedValueOnce("https://upload.example.test/assets")
      .mockResolvedValueOnce("episode-1")
      .mockResolvedValueOnce({ updated: true });
    vi.stubGlobal(
      "fetch",
      vi.fn(async (input: string | URL | Request, init?: RequestInit) => {
        const url = String(input);
        if (url === existingEpisode.audioUrl) return createAudioResponse();
        if (url === "https://upload.example.test/assets") {
          return createAssetUploadResponse(init, "2");
        }
        return new Response(null, { status: 404 });
      }),
    );

    await expect(
      syncFeaturedPodcastEpisode({
        baseUrl: "https://curio.example.test",
        regenArt: true,
      }),
    ).resolves.toMatchObject({
      status: "created",
      publication: { regeneratedArtwork: true },
    });

    expect(mocks.fetchMutation).toHaveBeenCalledTimes(5);
    await expect(
      getAttestedWriteArgs(1, "generate-upload-url"),
    ).resolves.toEqual({});
    await expect(
      getAttestedWriteArgs(2, "generate-upload-url"),
    ).resolves.toEqual({});
    await expect(getAttestedWriteArgs(3, "save-record")).resolves.toMatchObject(
      {
        storageId: "audio-storage-2",
        artworkStorageId: "artwork-storage-2",
        artworkVersion: 2,
        owner,
        status: "ready",
      },
    );
    await expect(
      getAttestedWriteArgs(4, "finalize-job"),
    ).resolves.toMatchObject({ status: "ready", owner });
  });

  it("fails the workflow when the ready job can no longer be finalized", async () => {
    const existingEpisode = {
      _id: "episode-1",
      status: "ready",
      articleId: "article-1",
      wikiPageId: article.wikiPageId,
      title: article.title,
      artworkVersion: 1,
      audioUrl: "https://cache.example.test/episode.mp3",
      narrationHash: buildArticleNarrationHash(article),
      durationSeconds: 24,
      ...edgeMetadata,
    };
    mocks.fetchQuery.mockResolvedValueOnce(existingEpisode);
    mocks.fetchMutation
      .mockResolvedValueOnce({ claimed: true, attempts: 1 })
      .mockResolvedValueOnce("https://upload.example.test/assets")
      .mockResolvedValueOnce("https://upload.example.test/assets")
      .mockResolvedValueOnce("episode-1")
      .mockResolvedValueOnce({ updated: false });
    vi.stubGlobal(
      "fetch",
      vi.fn(async (input: string | URL | Request, init?: RequestInit) => {
        const url = String(input);
        if (url === existingEpisode.audioUrl) return createAudioResponse();
        if (url === "https://upload.example.test/assets") {
          return createAssetUploadResponse(init, "lost");
        }
        return new Response(null, { status: 404 });
      }),
    );

    await expect(
      syncFeaturedPodcastEpisode({
        baseUrl: "https://curio.example.test",
        regenArt: true,
      }),
    ).rejects.toThrow(
      "Featured podcast job lease was lost before finalization",
    );
  });

  it("preserves a usable exact-Edge prior episode when artwork repair fails", async () => {
    const existingEpisode = {
      _id: "episode-1",
      status: "ready",
      articleId: "article-1",
      wikiPageId: article.wikiPageId,
      title: article.title,
      artworkVersion: 1,
      audioUrl: "https://cache.example.test/episode.mp3",
      narrationHash: buildArticleNarrationHash(article),
      durationSeconds: 24,
      ...edgeMetadata,
    };
    mocks.fetchQuery.mockResolvedValueOnce(existingEpisode);
    mocks.fetchMutation
      .mockResolvedValueOnce({ claimed: true, attempts: 1 })
      .mockResolvedValueOnce({ updated: true });
    mocks.renderFeaturedPodcastArtworkPng.mockRejectedValue(
      new Error("artwork renderer unavailable"),
    );
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => createAudioResponse()),
    );

    await expect(
      syncFeaturedPodcastEpisode({
        baseUrl: "https://curio.example.test",
        regenArt: true,
      }),
    ).rejects.toThrow("artwork renderer unavailable");

    expect(mocks.fetchMutation).toHaveBeenCalledTimes(2);
    await expect(
      getAttestedWriteArgs(1, "finalize-job"),
    ).resolves.toMatchObject({
      owner,
      status: "failed",
    });
  });

  it("regenerates audio instead of trusting spoofed metadata during artwork repair", async () => {
    const narrationHash = buildArticleNarrationHash(article);
    const existingEpisode = {
      _id: "episode-1",
      status: "ready",
      articleId: "article-1",
      wikiPageId: article.wikiPageId,
      title: article.title,
      artworkVersion: 1,
      audioUrl: "https://cache.example.test/spoofed-episode.mp3",
      narrationHash,
      durationSeconds: 24,
      ...edgeMetadata,
      provider: "openai",
    };
    mocks.fetchQuery
      .mockResolvedValueOnce(existingEpisode)
      .mockResolvedValueOnce({
        urls: { summary: "https://cache.example.test/summary.mp3" },
        metadata: { summary: edgeMetadata },
      })
      .mockResolvedValueOnce({
        ...existingEpisode,
        ...edgeMetadata,
        artworkVersion: 2,
      });
    mocks.fetchMutation
      .mockResolvedValueOnce({ claimed: true, attempts: 1 })
      .mockResolvedValueOnce("pending-episode")
      .mockResolvedValueOnce("https://upload.example.test/assets")
      .mockResolvedValueOnce("https://upload.example.test/assets")
      .mockResolvedValueOnce("episode-1")
      .mockResolvedValueOnce({ updated: true });
    const fetchMock = vi.fn(
      async (input: string | URL | Request, init?: RequestInit) => {
        const url = String(input);
        if (url === "https://cache.example.test/summary.mp3") {
          return createAudioResponse();
        }
        if (url === "https://upload.example.test/assets") {
          return createAssetUploadResponse(init, "3");
        }
        return new Response(null, { status: 404 });
      },
    );
    vi.stubGlobal("fetch", fetchMock);

    await expect(
      syncFeaturedPodcastEpisode({
        baseUrl: "https://curio.example.test",
        regenArt: true,
      }),
    ).resolves.toMatchObject({
      status: "created",
      reusedSectionCount: 1,
      totalSectionCount: 1,
      publication: { repairedExisting: true, regeneratedArtwork: false },
    });
    expect(fetchMock).not.toHaveBeenCalledWith(
      existingEpisode.audioUrl,
      expect.anything(),
    );
    await expect(getAttestedWriteArgs(1, "save-record")).resolves.toMatchObject(
      {
        ...edgeMetadata,
        owner,
        status: "pending",
      },
    );
    await expect(getAttestedWriteArgs(4, "save-record")).resolves.toMatchObject(
      { ...edgeMetadata, owner },
    );
  });

  it.each([
    [
      "spoofed metadata",
      {
        audioUrl: "https://cache.example.test/spoofed-episode.mp3",
        voiceId: "alloy",
      },
    ],
    ["missing audio", { audioUrl: null }],
  ] as const)(
    "marks a ready episode with $condition failed when Edge repair fails",
    async (_condition, incompatibleFields) => {
      const existingEpisode = {
        _id: "episode-1",
        status: "ready",
        articleId: "article-1",
        wikiPageId: article.wikiPageId,
        title: article.title,
        artworkVersion: 1,
        narrationHash: buildArticleNarrationHash(article),
        durationSeconds: 24,
        ...edgeMetadata,
        ...incompatibleFields,
      };
      mocks.fetchQuery
        .mockResolvedValueOnce(existingEpisode)
        .mockResolvedValueOnce({
          urls: { summary: "https://cache.example.test/summary.mp3" },
          metadata: { summary: edgeMetadata },
        });
      mocks.fetchMutation
        .mockResolvedValueOnce({ claimed: true, attempts: 1 })
        .mockResolvedValueOnce("pending-episode")
        .mockResolvedValueOnce("failed-episode")
        .mockResolvedValueOnce({ updated: true });
      mocks.concatenateMp3Blobs.mockRejectedValue(
        new Error("repair concatenation failed"),
      );
      vi.stubGlobal(
        "fetch",
        vi.fn(async () => createAudioResponse()),
      );

      await expect(
        syncFeaturedPodcastEpisode({
          baseUrl: "https://curio.example.test",
          regenArt: true,
        }),
      ).rejects.toThrow("repair concatenation failed");

      expect(mocks.fetchMutation).toHaveBeenCalledTimes(4);
      await expect(
        getAttestedWriteArgs(1, "save-record"),
      ).resolves.toMatchObject({
        ...edgeMetadata,
        owner,
        status: "pending",
      });
      await expect(
        getAttestedWriteArgs(2, "save-record"),
      ).resolves.toMatchObject({
        ...edgeMetadata,
        owner,
        status: "failed",
      });
      await expect(
        getAttestedWriteArgs(3, "finalize-job"),
      ).resolves.toMatchObject({
        owner,
        status: "failed",
        lastError: expect.stringContaining("repair concatenation failed"),
      });
    },
  );
});
