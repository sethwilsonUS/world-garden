import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { anyApi } from "convex/server";
import type { Id } from "../convex/_generated/dataModel";
import {
  deleteUnreferencedShareCardBlob,
  generateShareCardUploadUrl,
  getShareCardByMonthDay,
  listShareCardStatuses,
  saveShareCard,
} from "../convex/onThisDay";
import { registeredInvoker } from "../convex/testing/registeredFunctions";
import {
  createPublicAudioWriteAttestation,
  verifyPublicAudioWriteAttestation,
} from "./public-audio-write-attestation";

const { fetchMutationMock, fetchQueryMock } = vi.hoisted(() => ({
  fetchMutationMock: vi.fn(),
  fetchQueryMock: vi.fn(),
}));

vi.mock("convex/nextjs", () => ({
  fetchMutation: fetchMutationMock,
  fetchQuery: fetchQueryMock,
}));

import {
  getStoredOnThisDayShareCard,
  listStoredOnThisDayShareCardStatuses,
  uploadAndSaveOnThisDayShareCard,
  type OnThisDayShareCardStatus,
  type StoredOnThisDayShareCard,
  type StoredOnThisDayShareCardPlate,
} from "./on-this-day-share-card-store";

const samplePlates: StoredOnThisDayShareCardPlate[] = [
  {
    year: 1969,
    articleTitle: "Apollo 11",
    imageUrl: "https://upload.wikimedia.org/wikipedia/commons/apollo.jpg",
    licenseName: "Public domain",
    creator: "NASA",
    sourceUrl: "https://commons.wikimedia.org/wiki/File:Apollo_11.jpg",
  },
  {
    articleTitle: "Undated Plate",
    imageUrl: "https://upload.wikimedia.org/wikipedia/commons/undated.jpg",
  },
];

beforeEach(() => {
  fetchMutationMock.mockReset();
  fetchQueryMock.mockReset();
});

afterEach(() => {
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe("on-this-day-share-card-store", () => {
  describe("local-mode and unconfigured Convex no-op reads", () => {
    it("returns null for getStoredOnThisDayShareCard when NEXT_PUBLIC_LOCAL_MODE is true", async () => {
      vi.stubEnv("NEXT_PUBLIC_LOCAL_MODE", "true");
      vi.stubEnv("NEXT_PUBLIC_CONVEX_URL", "https://example.convex.cloud");

      await expect(getStoredOnThisDayShareCard("10-18")).resolves.toBeNull();
      expect(fetchQueryMock).not.toHaveBeenCalled();
    });

    it("returns null for getStoredOnThisDayShareCard when NEXT_PUBLIC_CONVEX_URL is missing", async () => {
      vi.stubEnv("NEXT_PUBLIC_LOCAL_MODE", "false");
      vi.stubEnv("NEXT_PUBLIC_CONVEX_URL", "");

      await expect(getStoredOnThisDayShareCard("10-18")).resolves.toBeNull();
      expect(fetchQueryMock).not.toHaveBeenCalled();
    });

    it("returns [] for listStoredOnThisDayShareCardStatuses when NEXT_PUBLIC_LOCAL_MODE is true", async () => {
      vi.stubEnv("NEXT_PUBLIC_LOCAL_MODE", "true");
      vi.stubEnv("NEXT_PUBLIC_CONVEX_URL", "https://example.convex.cloud");

      await expect(listStoredOnThisDayShareCardStatuses()).resolves.toEqual([]);
      expect(fetchQueryMock).not.toHaveBeenCalled();
    });

    it("returns [] for listStoredOnThisDayShareCardStatuses when NEXT_PUBLIC_CONVEX_URL is missing", async () => {
      vi.stubEnv("NEXT_PUBLIC_LOCAL_MODE", "false");
      vi.stubEnv("NEXT_PUBLIC_CONVEX_URL", "");

      await expect(listStoredOnThisDayShareCardStatuses()).resolves.toEqual([]);
      expect(fetchQueryMock).not.toHaveBeenCalled();
    });
  });

  describe("Convex query retrieval and status listing", () => {
    it("retrieves a stored share card from Convex by monthDay", async () => {
      vi.stubEnv("NEXT_PUBLIC_LOCAL_MODE", "false");
      vi.stubEnv("NEXT_PUBLIC_CONVEX_URL", "https://example.convex.cloud");

      const stored: StoredOnThisDayShareCard = {
        monthDay: "10-18",
        version: 1,
        storageId: "storage-10-18",
        mimeType: "image/jpeg",
        width: 1200,
        height: 630,
        byteSize: 128_450,
        generatedAt: 1_780_000_000_000,
        snapshotCheckedAt: 1_779_999_000_000,
        plates: samplePlates,
        imageUrl: "https://cdn.example.test/share-card-10-18.jpg",
      };
      fetchQueryMock.mockResolvedValueOnce(stored);

      await expect(getStoredOnThisDayShareCard("10-18")).resolves.toEqual(
        stored,
      );
      expect(fetchQueryMock).toHaveBeenCalledWith(
        anyApi.onThisDay.getShareCardByMonthDay,
        { monthDay: "10-18" },
      );
    });

    it("normalizes undefined query results to null", async () => {
      vi.stubEnv("NEXT_PUBLIC_LOCAL_MODE", "false");
      vi.stubEnv("NEXT_PUBLIC_CONVEX_URL", "https://example.convex.cloud");
      fetchQueryMock.mockResolvedValueOnce(undefined);

      await expect(getStoredOnThisDayShareCard("02-29")).resolves.toBeNull();
    });

    it("lists share card statuses from Convex", async () => {
      vi.stubEnv("NEXT_PUBLIC_LOCAL_MODE", "false");
      vi.stubEnv("NEXT_PUBLIC_CONVEX_URL", "https://example.convex.cloud");

      const statuses: OnThisDayShareCardStatus[] = [
        {
          monthDay: "01-01",
          version: 1,
          generatedAt: 1_780_000_000_000,
          byteSize: 112_000,
          plateCount: 5,
          hasBlob: true,
        },
        {
          monthDay: "10-18",
          version: 1,
          generatedAt: 1_780_000_010_000,
          byteSize: 134_200,
          plateCount: 5,
          hasBlob: false,
        },
      ];
      fetchQueryMock.mockResolvedValueOnce(statuses);

      await expect(listStoredOnThisDayShareCardStatuses()).resolves.toEqual(
        statuses,
      );
      expect(fetchQueryMock).toHaveBeenCalledWith(
        anyApi.onThisDay.listShareCardStatuses,
        {},
      );
    });

    it("normalizes null status listing response to []", async () => {
      vi.stubEnv("NEXT_PUBLIC_LOCAL_MODE", "false");
      vi.stubEnv("NEXT_PUBLIC_CONVEX_URL", "https://example.convex.cloud");
      fetchQueryMock.mockResolvedValueOnce(null);

      await expect(listStoredOnThisDayShareCardStatuses()).resolves.toEqual([]);
    });
  });

  describe("upload + attestation + save flow", () => {
    it("attests generateShareCardUploadUrl and saveShareCard, uploads the blob, and returns the result", async () => {
      vi.stubEnv("NEXT_PUBLIC_LOCAL_MODE", "false");
      vi.stubEnv("NEXT_PUBLIC_CONVEX_URL", "https://example.convex.cloud");
      vi.stubEnv("TTS_QUOTA_BYPASS_SECRET", "publication-secret");

      fetchMutationMock
        .mockResolvedValueOnce("https://upload.example.test/share-card")
        .mockResolvedValueOnce({
          monthDay: "10-18",
          version: 1,
          storageId: "storage-new-10-18",
          replaced: true,
        });

      const fetchMock = vi.fn(async () =>
        Response.json({ storageId: "storage-new-10-18" }),
      );
      vi.stubGlobal("fetch", fetchMock);

      const bytes = new Uint8Array([0xff, 0xd8, 0xff, 0xe0, 0x00, 0x10]);
      const result = await uploadAndSaveOnThisDayShareCard({
        monthDay: "10-18",
        version: 1,
        data: bytes,
        mimeType: "image/jpeg",
        width: 1200,
        height: 630,
        generatedAt: 1_780_000_000_000,
        snapshotCheckedAt: 1_779_999_500_000,
        plates: [
          {
            year: 1969,
            articleTitle: "Apollo 11",
            imageUrl:
              "https://upload.wikimedia.org/wikipedia/commons/apollo.jpg",
            licenseName: "Public domain",
            creator: undefined,
            sourceUrl: undefined,
          },
        ],
      });

      expect(result).toEqual({
        monthDay: "10-18",
        version: 1,
        storageId: "storage-new-10-18",
        replaced: true,
      });

      expect(fetchMutationMock).toHaveBeenCalledTimes(2);
      expect(fetchMutationMock.mock.calls[0]?.[0]).toEqual(
        anyApi.onThisDay.generateShareCardUploadUrl,
      );
      const uploadMutationArgs = fetchMutationMock.mock.calls[0]?.[1] as {
        attestation?: Parameters<
          typeof verifyPublicAudioWriteAttestation
        >[0]["attestation"];
      };
      await expect(
        verifyPublicAudioWriteAttestation({
          pipeline: "on-this-day",
          operation: "generate-upload-url",
          args: {},
          attestation: uploadMutationArgs.attestation,
        }),
      ).resolves.toBe(true);

      expect(fetchMock).toHaveBeenCalledTimes(1);
      expect(fetchMock).toHaveBeenCalledWith(
        "https://upload.example.test/share-card",
        expect.objectContaining({
          method: "POST",
          headers: { "Content-Type": "image/jpeg" },
        }),
      );

      expect(fetchMutationMock.mock.calls[1]?.[0]).toEqual(
        anyApi.onThisDay.saveShareCard,
      );
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
        monthDay: "10-18",
        version: 1,
        storageId: "storage-new-10-18",
        mimeType: "image/jpeg",
        width: 1200,
        height: 630,
        byteSize: bytes.byteLength,
        generatedAt: 1_780_000_000_000,
        snapshotCheckedAt: 1_779_999_500_000,
        plates: [
          {
            year: 1969,
            articleTitle: "Apollo 11",
            imageUrl:
              "https://upload.wikimedia.org/wikipedia/commons/apollo.jpg",
            licenseName: "Public domain",
          },
        ],
      });
      await expect(
        verifyPublicAudioWriteAttestation({
          pipeline: "on-this-day",
          operation: "save-show-asset",
          args: writeArgs,
          attestation,
        }),
      ).resolves.toBe(true);
    });

    it("omits optional snapshotCheckedAt when undefined", async () => {
      vi.stubEnv("NEXT_PUBLIC_LOCAL_MODE", "false");
      vi.stubEnv("NEXT_PUBLIC_CONVEX_URL", "https://example.convex.cloud");
      vi.stubEnv("TTS_QUOTA_BYPASS_SECRET", "publication-secret");

      fetchMutationMock
        .mockResolvedValueOnce("https://upload.example.test/share-card")
        .mockResolvedValueOnce({
          monthDay: "04-12",
          version: 1,
          storageId: "storage-04-12",
          replaced: false,
        });
      vi.stubGlobal(
        "fetch",
        vi.fn(async () => Response.json({ storageId: "storage-04-12" })),
      );

      await uploadAndSaveOnThisDayShareCard({
        monthDay: "04-12",
        version: 1,
        data: new Uint8Array([1, 2, 3, 4]),
        mimeType: "image/jpeg",
        width: 1200,
        height: 630,
        generatedAt: 1_780_000_000_000,
        plates: [],
      });

      const saveMutationArgs = fetchMutationMock.mock.calls[1]?.[1] as Record<
        string,
        unknown
      >;
      expect("snapshotCheckedAt" in saveMutationArgs).toBe(false);
    });
  });

  describe("error handling", () => {
    it("throws when uploading in local mode or without NEXT_PUBLIC_CONVEX_URL", async () => {
      vi.stubEnv("NEXT_PUBLIC_LOCAL_MODE", "true");
      vi.stubEnv("NEXT_PUBLIC_CONVEX_URL", "https://example.convex.cloud");

      await expect(
        uploadAndSaveOnThisDayShareCard({
          monthDay: "10-18",
          version: 1,
          data: new Uint8Array([1, 2, 3]),
          mimeType: "image/jpeg",
          width: 1200,
          height: 630,
          generatedAt: 1_780_000_000_000,
          plates: samplePlates,
        }),
      ).rejects.toThrow("Convex storage is disabled");
      expect(fetchMutationMock).not.toHaveBeenCalled();
    });

    it("throws when image data is empty", async () => {
      vi.stubEnv("NEXT_PUBLIC_LOCAL_MODE", "false");
      vi.stubEnv("NEXT_PUBLIC_CONVEX_URL", "https://example.convex.cloud");
      vi.stubEnv("TTS_QUOTA_BYPASS_SECRET", "publication-secret");

      await expect(
        uploadAndSaveOnThisDayShareCard({
          monthDay: "10-18",
          version: 1,
          data: new Uint8Array([]),
          mimeType: "image/jpeg",
          width: 1200,
          height: 630,
          generatedAt: 1_780_000_000_000,
          plates: samplePlates,
        }),
      ).rejects.toThrow("empty");
      expect(fetchMutationMock).not.toHaveBeenCalled();
    });

    it("throws when Convex upload URL mutation returns an empty value", async () => {
      vi.stubEnv("NEXT_PUBLIC_LOCAL_MODE", "false");
      vi.stubEnv("NEXT_PUBLIC_CONVEX_URL", "https://example.convex.cloud");
      vi.stubEnv("TTS_QUOTA_BYPASS_SECRET", "publication-secret");
      fetchMutationMock.mockResolvedValueOnce("");

      await expect(
        uploadAndSaveOnThisDayShareCard({
          monthDay: "10-18",
          version: 1,
          data: new Uint8Array([1, 2, 3]),
          mimeType: "image/jpeg",
          width: 1200,
          height: 630,
          generatedAt: 1_780_000_000_000,
          plates: samplePlates,
        }),
      ).rejects.toThrow("did not return an upload URL");
    });

    it("throws when Convex storage HTTP upload responds non-OK", async () => {
      vi.stubEnv("NEXT_PUBLIC_LOCAL_MODE", "false");
      vi.stubEnv("NEXT_PUBLIC_CONVEX_URL", "https://example.convex.cloud");
      vi.stubEnv("TTS_QUOTA_BYPASS_SECRET", "publication-secret");
      fetchMutationMock.mockResolvedValueOnce("https://upload.example.test");
      vi.stubGlobal(
        "fetch",
        vi.fn(async () => new Response("bad gateway", { status: 502 })),
      );

      await expect(
        uploadAndSaveOnThisDayShareCard({
          monthDay: "10-18",
          version: 1,
          data: new Uint8Array([1, 2, 3]),
          mimeType: "image/jpeg",
          width: 1200,
          height: 630,
          generatedAt: 1_780_000_000_000,
          plates: samplePlates,
        }),
      ).rejects.toThrow("Convex storage upload failed: 502");
      expect(fetchMutationMock).toHaveBeenCalledTimes(1);
    });

    it("throws when Convex storage upload JSON omits storageId", async () => {
      vi.stubEnv("NEXT_PUBLIC_LOCAL_MODE", "false");
      vi.stubEnv("NEXT_PUBLIC_CONVEX_URL", "https://example.convex.cloud");
      vi.stubEnv("TTS_QUOTA_BYPASS_SECRET", "publication-secret");
      fetchMutationMock.mockResolvedValueOnce("https://upload.example.test");
      vi.stubGlobal(
        "fetch",
        vi.fn(async () => Response.json({})),
      );

      await expect(
        uploadAndSaveOnThisDayShareCard({
          monthDay: "10-18",
          version: 1,
          data: new Uint8Array([1, 2, 3]),
          mimeType: "image/jpeg",
          width: 1200,
          height: 630,
          generatedAt: 1_780_000_000_000,
          plates: samplePlates,
        }),
      ).rejects.toThrow("did not return a storageId");
      expect(fetchMutationMock).toHaveBeenCalledTimes(1);
    });

    it("retries saveShareCard reusing the uploaded storageId and succeeds without deleting the blob", async () => {
      vi.stubEnv("NEXT_PUBLIC_LOCAL_MODE", "false");
      vi.stubEnv("NEXT_PUBLIC_CONVEX_URL", "https://example.convex.cloud");
      vi.stubEnv("TTS_QUOTA_BYPASS_SECRET", "publication-secret");

      fetchMutationMock
        .mockResolvedValueOnce("https://upload.example.test/share-card")
        .mockRejectedValueOnce(new Error("transient network blip"))
        .mockResolvedValueOnce({
          monthDay: "10-18",
          version: 1,
          storageId: "storage-reused",
          replaced: false,
          rejectedStaleVersion: false,
        });
      const fetchMock = vi.fn(async () =>
        Response.json({ storageId: "storage-reused" }),
      );
      vi.stubGlobal("fetch", fetchMock);

      const result = await uploadAndSaveOnThisDayShareCard({
        monthDay: "10-18",
        version: 1,
        data: new Uint8Array([1, 2, 3, 4]),
        mimeType: "image/jpeg",
        width: 1200,
        height: 630,
        generatedAt: 1_780_000_000_000,
        plates: samplePlates,
      });

      expect(result).toEqual({
        monthDay: "10-18",
        version: 1,
        storageId: "storage-reused",
        replaced: false,
        rejectedStaleVersion: false,
      });
      expect(fetchMock).toHaveBeenCalledTimes(1);
      expect(fetchMutationMock).toHaveBeenCalledTimes(3);
      expect(fetchMutationMock.mock.calls[1]?.[0]).toEqual(
        anyApi.onThisDay.saveShareCard,
      );
      expect(fetchMutationMock.mock.calls[2]?.[0]).toEqual(
        anyApi.onThisDay.saveShareCard,
      );
      expect(
        (fetchMutationMock.mock.calls[2]?.[1] as { storageId?: string })
          .storageId,
      ).toBe("storage-reused");
    });

    it("retries saveShareCard, deletes unreferenced blob on exhaustion, and throws", async () => {
      vi.stubEnv("NEXT_PUBLIC_LOCAL_MODE", "false");
      vi.stubEnv("NEXT_PUBLIC_CONVEX_URL", "https://example.convex.cloud");
      vi.stubEnv("TTS_QUOTA_BYPASS_SECRET", "publication-secret");
      fetchMutationMock
        .mockResolvedValueOnce("https://upload.example.test")
        .mockResolvedValueOnce(null)
        .mockResolvedValueOnce(null)
        .mockResolvedValueOnce(null)
        .mockResolvedValueOnce({ deleted: true });
      vi.stubGlobal(
        "fetch",
        vi.fn(async () => Response.json({ storageId: "storage-1" })),
      );

      await expect(
        uploadAndSaveOnThisDayShareCard({
          monthDay: "10-18",
          version: 1,
          data: new Uint8Array([1, 2, 3]),
          mimeType: "image/jpeg",
          width: 1200,
          height: 630,
          generatedAt: 1_780_000_000_000,
          plates: samplePlates,
        }),
      ).rejects.toThrow("saveShareCard did not return a valid result");

      expect(fetchMutationMock).toHaveBeenCalledTimes(5);
      expect(fetchMutationMock.mock.calls[4]?.[0]).toEqual(
        anyApi.onThisDay.deleteUnreferencedShareCardBlob,
      );
      const cleanupArgs = fetchMutationMock.mock.calls[4]?.[1] as {
        storageId: string;
        attestation?: Parameters<
          typeof verifyPublicAudioWriteAttestation
        >[0]["attestation"];
      };
      expect(cleanupArgs.storageId).toBe("storage-1");
      await expect(
        verifyPublicAudioWriteAttestation({
          pipeline: "on-this-day",
          operation: "finalize-job",
          args: { storageId: "storage-1" },
          attestation: cleanupArgs.attestation,
        }),
      ).resolves.toBe(true);
    });

    it("still rethrows original saveShareCard error when best-effort blob cleanup fails", async () => {
      vi.stubEnv("NEXT_PUBLIC_LOCAL_MODE", "false");
      vi.stubEnv("NEXT_PUBLIC_CONVEX_URL", "https://example.convex.cloud");
      vi.stubEnv("TTS_QUOTA_BYPASS_SECRET", "publication-secret");
      const warnSpy = vi
        .spyOn(console, "warn")
        .mockImplementation(() => undefined);

      fetchMutationMock
        .mockResolvedValueOnce("https://upload.example.test")
        .mockRejectedValueOnce(new Error("save failed"))
        .mockRejectedValueOnce(new Error("save failed"))
        .mockRejectedValueOnce(new Error("save failed"))
        .mockRejectedValueOnce(new Error("cleanup failed"));
      vi.stubGlobal(
        "fetch",
        vi.fn(async () => Response.json({ storageId: "storage-orphan" })),
      );

      await expect(
        uploadAndSaveOnThisDayShareCard({
          monthDay: "10-18",
          version: 1,
          data: new Uint8Array([1, 2, 3]),
          mimeType: "image/jpeg",
          width: 1200,
          height: 630,
          generatedAt: 1_780_000_000_000,
          plates: samplePlates,
        }),
      ).rejects.toThrow("save failed");
      expect(warnSpy).toHaveBeenCalledWith(
        expect.stringContaining("storage-orphan"),
        expect.any(Error),
      );
    });

    it("propagates Convex query errors on read", async () => {
      vi.stubEnv("NEXT_PUBLIC_LOCAL_MODE", "false");
      vi.stubEnv("NEXT_PUBLIC_CONVEX_URL", "https://example.convex.cloud");
      fetchQueryMock.mockRejectedValueOnce(new Error("Convex offline"));

      await expect(getStoredOnThisDayShareCard("10-18")).rejects.toThrow(
        "Convex offline",
      );
    });
  });

  describe("Convex onThisDay share card functions", () => {
    it("resolves imageUrl in getShareCardByMonthDay and returns null when missing", async () => {
      const handler = registeredInvoker(getShareCardByMonthDay);
      const getUrl = vi.fn(async () => "https://storage.convex.test/card.jpg");

      await expect(
        handler(
          {
            db: {
              query: vi.fn(() => ({
                withIndex: vi.fn(() => ({
                  first: vi.fn(async () => ({
                    _id: "card-doc-1",
                    monthDay: "10-18",
                    version: 1,
                    storageId: "storage-1" as Id<"_storage">,
                    mimeType: "image/jpeg",
                    width: 1200,
                    height: 630,
                    byteSize: 123_456,
                    generatedAt: 1_780_000_000_000,
                    snapshotCheckedAt: 1_779_999_000_000,
                    plates: samplePlates,
                  })),
                })),
              })),
            },
            storage: { getUrl },
          },
          { monthDay: "10-18" },
        ),
      ).resolves.toEqual({
        monthDay: "10-18",
        version: 1,
        storageId: "storage-1",
        mimeType: "image/jpeg",
        width: 1200,
        height: 630,
        byteSize: 123_456,
        generatedAt: 1_780_000_000_000,
        snapshotCheckedAt: 1_779_999_000_000,
        plates: samplePlates,
        imageUrl: "https://storage.convex.test/card.jpg",
      });
      expect(getUrl).toHaveBeenCalledWith("storage-1");

      await expect(
        handler(
          {
            db: {
              query: vi.fn(() => ({
                withIndex: vi.fn(() => ({
                  first: vi.fn(async () => null),
                })),
              })),
            },
            storage: { getUrl },
          },
          { monthDay: "02-29" },
        ),
      ).resolves.toBeNull();
    });

    it("returns compact status summaries with hasBlob in listShareCardStatuses", async () => {
      const handler = registeredInvoker(listShareCardStatuses);
      const getUrl = vi
        .fn()
        .mockResolvedValueOnce("https://storage.convex.test/10-18.jpg")
        .mockResolvedValueOnce(null);

      await expect(
        handler(
          {
            db: {
              query: vi.fn(() => ({
                withIndex: vi.fn(() => ({
                  collect: vi.fn(async () => [
                    {
                      monthDay: "10-18",
                      version: 1,
                      storageId: "storage-present" as Id<"_storage">,
                      generatedAt: 1_780_000_000_000,
                      byteSize: 123_456,
                      plates: samplePlates,
                    },
                    {
                      monthDay: "10-19",
                      version: 1,
                      storageId: "storage-missing" as Id<"_storage">,
                      generatedAt: 1_780_000_010_000,
                      byteSize: 120_000,
                      plates: samplePlates,
                    },
                  ]),
                })),
              })),
            },
            storage: { getUrl },
          },
          {},
        ),
      ).resolves.toEqual([
        {
          monthDay: "10-18",
          version: 1,
          generatedAt: 1_780_000_000_000,
          byteSize: 123_456,
          plateCount: 2,
          hasBlob: true,
        },
        {
          monthDay: "10-19",
          version: 1,
          generatedAt: 1_780_000_010_000,
          byteSize: 120_000,
          plateCount: 2,
          hasBlob: false,
        },
      ]);
      expect(getUrl).toHaveBeenCalledWith("storage-present");
      expect(getUrl).toHaveBeenCalledWith("storage-missing");
    });

    it("attests generateShareCardUploadUrl and returns Convex storage upload URL", async () => {
      vi.stubEnv("TTS_QUOTA_BYPASS_SECRET", "publication-secret");
      const handler = registeredInvoker(generateShareCardUploadUrl);
      const attestation = await createPublicAudioWriteAttestation({
        pipeline: "on-this-day",
        operation: "generate-upload-url",
        args: {},
      });

      const generateUploadUrl = vi.fn(
        async () => "https://upload.convex.test/signed",
      );
      await expect(
        handler({ storage: { generateUploadUrl } }, { attestation }),
      ).resolves.toBe("https://upload.convex.test/signed");
      expect(generateUploadUrl).toHaveBeenCalledTimes(1);
    });

    it("inserts a new share card and replaces an existing one while deleting superseded blobs cleanly", async () => {
      vi.stubEnv("TTS_QUOTA_BYPASS_SECRET", "publication-secret");
      const handler = registeredInvoker(saveShareCard);
      const writeArgs = {
        monthDay: "10-18",
        version: 1,
        storageId: "storage-v2" as Id<"_storage">,
        mimeType: "image/jpeg",
        width: 1200,
        height: 630,
        byteSize: 140_000,
        generatedAt: 1_780_000_000_000,
        snapshotCheckedAt: 1_779_999_000_000,
        plates: samplePlates,
      };
      const attestation = await createPublicAudioWriteAttestation({
        pipeline: "on-this-day",
        operation: "save-show-asset",
        args: writeArgs,
      });

      // Insert path
      const insert = vi.fn(async () => "new-card-id");
      const deleteStorage = vi.fn(async () => undefined);
      await expect(
        handler(
          {
            db: {
              query: vi.fn(() => ({
                withIndex: vi.fn(() => ({
                  first: vi.fn(async () => null),
                })),
              })),
              insert,
              patch: vi.fn(),
            },
            storage: { delete: deleteStorage },
          },
          { ...writeArgs, attestation },
        ),
      ).resolves.toEqual({
        monthDay: "10-18",
        version: 1,
        storageId: "storage-v2",
        replaced: false,
        rejectedStaleVersion: false,
      });
      expect(insert).toHaveBeenCalledWith("onThisDayShareCards", writeArgs);
      expect(deleteStorage).not.toHaveBeenCalled();

      // Replace path with missing old blob (must warn and still succeed)
      const patch = vi.fn(async () => undefined);
      const failingDelete = vi.fn(async () => {
        throw new Error("blob already deleted");
      });
      const warnSpy = vi
        .spyOn(console, "warn")
        .mockImplementation(() => undefined);

      await expect(
        handler(
          {
            db: {
              query: vi.fn(() => ({
                withIndex: vi.fn(() => ({
                  first: vi.fn(async () => ({
                    _id: "existing-card-id",
                    monthDay: "10-18",
                    version: 1,
                    storageId: "storage-v1" as Id<"_storage">,
                  })),
                })),
              })),
              insert: vi.fn(),
              patch,
            },
            storage: { delete: failingDelete },
          },
          { ...writeArgs, attestation },
        ),
      ).resolves.toEqual({
        monthDay: "10-18",
        version: 1,
        storageId: "storage-v2",
        replaced: true,
        rejectedStaleVersion: false,
      });
      expect(patch).toHaveBeenCalledWith("existing-card-id", writeArgs);
      expect(failingDelete).toHaveBeenCalledWith("storage-v1");
      expect(warnSpy).toHaveBeenCalledWith(
        expect.stringContaining("storage-v1"),
        expect.any(Error),
      );

      // Replace path with identical storageId (must NOT delete active blob)
      const sameBlobDelete = vi.fn(async () => undefined);
      await expect(
        handler(
          {
            db: {
              query: vi.fn(() => ({
                withIndex: vi.fn(() => ({
                  first: vi.fn(async () => ({
                    _id: "existing-card-id",
                    monthDay: "10-18",
                    version: 1,
                    storageId: "storage-v2" as Id<"_storage">,
                  })),
                })),
              })),
              insert: vi.fn(),
              patch: vi.fn(async () => undefined),
            },
            storage: { delete: sameBlobDelete },
          },
          { ...writeArgs, attestation },
        ),
      ).resolves.toEqual({
        monthDay: "10-18",
        version: 1,
        storageId: "storage-v2",
        replaced: true,
        rejectedStaleVersion: false,
      });
      expect(sameBlobDelete).not.toHaveBeenCalled();

      // Replace path where deleting superseded blob succeeds cleanly
      const cleanDelete = vi.fn(async () => undefined);
      warnSpy.mockClear();
      await expect(
        handler(
          {
            db: {
              query: vi.fn(() => ({
                withIndex: vi.fn(() => ({
                  first: vi.fn(async () => ({
                    _id: "existing-card-id",
                    monthDay: "10-18",
                    version: 1,
                    storageId: "storage-v1" as Id<"_storage">,
                  })),
                })),
              })),
              insert: vi.fn(),
              patch: vi.fn(async () => undefined),
            },
            storage: { delete: cleanDelete },
          },
          { ...writeArgs, attestation },
        ),
      ).resolves.toEqual({
        monthDay: "10-18",
        version: 1,
        storageId: "storage-v2",
        replaced: true,
        rejectedStaleVersion: false,
      });
      expect(cleanDelete).toHaveBeenCalledWith("storage-v1");
      expect(warnSpy).not.toHaveBeenCalled();
    });

    it("rejects lower-version saveShareCard writes without overwriting existing card and cleans up stale uploaded blob", async () => {
      vi.stubEnv("TTS_QUOTA_BYPASS_SECRET", "publication-secret");
      const handler = registeredInvoker(saveShareCard);
      const writeArgs = {
        monthDay: "10-18",
        version: 1,
        storageId: "storage-stale-v1" as Id<"_storage">,
        mimeType: "image/jpeg",
        width: 1200,
        height: 630,
        byteSize: 120_000,
        generatedAt: 1_780_000_000_000,
        plates: samplePlates,
      };
      const attestation = await createPublicAudioWriteAttestation({
        pipeline: "on-this-day",
        operation: "save-show-asset",
        args: writeArgs,
      });

      const patch = vi.fn();
      const deleteStorage = vi.fn(async () => undefined);

      await expect(
        handler(
          {
            db: {
              query: vi.fn(() => ({
                withIndex: vi.fn(() => ({
                  first: vi.fn(async () => ({
                    _id: "existing-v2-id",
                    monthDay: "10-18",
                    version: 2,
                    storageId: "storage-current-v2" as Id<"_storage">,
                  })),
                })),
              })),
              insert: vi.fn(),
              patch,
            },
            storage: { delete: deleteStorage },
          },
          { ...writeArgs, attestation },
        ),
      ).resolves.toEqual({
        monthDay: "10-18",
        version: 2,
        storageId: "storage-current-v2",
        replaced: false,
        rejectedStaleVersion: true,
      });
      expect(patch).not.toHaveBeenCalled();
      expect(deleteStorage).toHaveBeenCalledTimes(1);
      expect(deleteStorage).toHaveBeenCalledWith("storage-stale-v1");

      // Same storageId on lower version must NOT delete the active blob
      const deleteSame = vi.fn();
      await expect(
        handler(
          {
            db: {
              query: vi.fn(() => ({
                withIndex: vi.fn(() => ({
                  first: vi.fn(async () => ({
                    _id: "existing-v2-id",
                    monthDay: "10-18",
                    version: 2,
                    storageId: "storage-stale-v1" as Id<"_storage">,
                  })),
                })),
              })),
              insert: vi.fn(),
              patch: vi.fn(),
            },
            storage: { delete: deleteSame },
          },
          { ...writeArgs, attestation },
        ),
      ).resolves.toEqual({
        monthDay: "10-18",
        version: 2,
        storageId: "storage-stale-v1",
        replaced: false,
        rejectedStaleVersion: true,
      });
      expect(deleteSame).not.toHaveBeenCalled();
    });

    it("deletes only unreferenced blobs in deleteUnreferencedShareCardBlob", async () => {
      vi.stubEnv("TTS_QUOTA_BYPASS_SECRET", "publication-secret");
      const handler = registeredInvoker(deleteUnreferencedShareCardBlob);
      const storageId = "storage-orphan" as Id<"_storage">;
      const attestation = await createPublicAudioWriteAttestation({
        pipeline: "on-this-day",
        operation: "finalize-job",
        args: { storageId },
      });

      // Unreferenced -> deletes blob
      const deleteOrphan = vi.fn(async () => undefined);
      await expect(
        handler(
          {
            db: {
              query: vi.fn(() => ({
                withIndex: vi.fn(() => ({
                  collect: vi.fn(async () => [
                    { storageId: "storage-other" as Id<"_storage"> },
                  ]),
                })),
              })),
            },
            storage: { delete: deleteOrphan },
          },
          { storageId, attestation },
        ),
      ).resolves.toEqual({ deleted: true });
      expect(deleteOrphan).toHaveBeenCalledWith(storageId);

      // Referenced -> preserves blob
      const deleteReferenced = vi.fn(async () => undefined);
      await expect(
        handler(
          {
            db: {
              query: vi.fn(() => ({
                withIndex: vi.fn(() => ({
                  collect: vi.fn(async () => [{ storageId }]),
                })),
              })),
            },
            storage: { delete: deleteReferenced },
          },
          { storageId, attestation },
        ),
      ).resolves.toEqual({ deleted: false });
      expect(deleteReferenced).not.toHaveBeenCalled();

      // Storage error -> warns and returns { deleted: false }
      const warnSpy = vi
        .spyOn(console, "warn")
        .mockImplementation(() => undefined);
      await expect(
        handler(
          {
            db: {
              query: vi.fn(() => ({
                withIndex: vi.fn(() => ({
                  collect: vi.fn(async () => []),
                })),
              })),
            },
            storage: {
              delete: vi.fn(async () => {
                throw new Error("storage missing");
              }),
            },
          },
          { storageId, attestation },
        ),
      ).resolves.toEqual({ deleted: false });
      expect(warnSpy).toHaveBeenCalled();
    });

    it("rejects saveShareCard when attestation is invalid", async () => {
      vi.stubEnv("TTS_QUOTA_BYPASS_SECRET", "publication-secret");
      const handler = registeredInvoker(saveShareCard);

      await expect(
        handler(
          {
            db: { query: vi.fn(), insert: vi.fn(), patch: vi.fn() },
            storage: { delete: vi.fn() },
          },
          {
            monthDay: "10-18",
            version: 1,
            storageId: "storage-v1" as Id<"_storage">,
            mimeType: "image/jpeg",
            width: 1200,
            height: 630,
            byteSize: 1000,
            generatedAt: 1_780_000_000_000,
            plates: [],
            attestation: {
              issuedAt: Date.now(),
              expiresAt: Date.now() + 60_000,
              nonce: "bad-nonce",
              signature: "invalid-signature",
            },
          },
        ),
      ).rejects.toThrow("server attestation");
    });
  });
});
