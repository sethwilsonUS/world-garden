import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { verifyPublicAudioWriteAttestation } from "./public-audio-write-attestation";

const { fetchMutationMock, fetchQueryMock } = vi.hoisted(() => ({
  fetchMutationMock: vi.fn(),
  fetchQueryMock: vi.fn(),
}));

vi.mock("convex/nextjs", () => ({
  fetchMutation: fetchMutationMock,
  fetchQuery: fetchQueryMock,
}));

import { getOrCreatePodcastShowArtworkUrl } from "./podcast-show-artwork-cache";

beforeEach(() => {
  vi.stubEnv("TTS_QUOTA_BYPASS_SECRET", "publication-secret");
  fetchMutationMock.mockReset();
  fetchQueryMock.mockReset();
});

afterEach(() => {
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
});

describe("getOrCreatePodcastShowArtworkUrl", () => {
  it("attests the exact upload and show-asset writes", async () => {
    fetchQueryMock
      .mockResolvedValueOnce(null)
      .mockResolvedValueOnce({
        storageId: "storage-1",
        mimeType: "image/png",
        version: 2,
        artworkUrl: "https://cdn.example.test/trending.png",
      });
    fetchMutationMock
      .mockResolvedValueOnce("https://upload.example.test")
      .mockResolvedValueOnce("asset-1");
    const fetchMock = vi.fn(async () =>
      Response.json({ storageId: "storage-1" }),
    );
    vi.stubGlobal("fetch", fetchMock);

    await expect(
      getOrCreatePodcastShowArtworkUrl({
        slug: "trending",
        render: async () => ({
          data: new Uint8Array([1, 2, 3]),
          mimeType: "image/png",
        }),
      }),
    ).resolves.toBe("https://cdn.example.test/trending.png");

    expect(fetchMutationMock).toHaveBeenCalledTimes(2);
    const uploadMutationArgs = fetchMutationMock.mock.calls[0]?.[1] as {
      attestation?: Parameters<
        typeof verifyPublicAudioWriteAttestation
      >[0]["attestation"];
    };
    await expect(
      verifyPublicAudioWriteAttestation({
        pipeline: "featured",
        operation: "generate-upload-url",
        args: {},
        attestation: uploadMutationArgs.attestation,
      }),
    ).resolves.toBe(true);

    const saveMutationArgs = fetchMutationMock.mock.calls[1]?.[1] as Record<
      string,
      unknown
    > & {
      attestation?: Parameters<
        typeof verifyPublicAudioWriteAttestation
      >[0]["attestation"];
    };
    const { attestation, ...writeArgs } = saveMutationArgs;
    expect(writeArgs).toEqual({
      slug: "trending",
      storageId: "storage-1",
      mimeType: "image/png",
      version: 2,
    });
    await expect(
      verifyPublicAudioWriteAttestation({
        pipeline: "featured",
        operation: "save-show-asset",
        args: writeArgs,
        attestation,
      }),
    ).resolves.toBe(true);
  });
});
