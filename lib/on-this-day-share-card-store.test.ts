import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { anyApi } from "convex/server";
import type { Id } from "../convex/_generated/dataModel";
import {
  deleteUnreferencedShareCardBlob,
  generateShareCardUploadUrl,
  getShareCardByMonthDay,
  getShareCardCreditsByRevision,
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
  computeShareCardCreditRevisionId,
  getStoredOnThisDayShareCard,
  getStoredOnThisDayShareCardCreditsByRevision,
  isValidShareCardCreditRevisionId,
  listStoredOnThisDayShareCardStatuses,
  SHARE_CARD_CREDIT_REVISION_ID_PATTERN,
  uploadAndSaveOnThisDayShareCard,
  type OnThisDayShareCardStatus,
  type StoredOnThisDayShareCard,
  type StoredOnThisDayShareCardCreditRevision,
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
      const expectedPlates = [
        {
          year: 1969,
          articleTitle: "Apollo 11",
          imageUrl:
            "https://upload.wikimedia.org/wikipedia/commons/apollo.jpg",
          licenseName: "Public domain",
        },
      ];
      const expectedRevisionId = computeShareCardCreditRevisionId({
        monthDay: "10-18",
        version: 1,
        plates: expectedPlates,
      });
      expect(expectedRevisionId).toMatch(/^[a-f0-9]{16}$/u);
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
        creditRevisionId: expectedRevisionId,
        plates: expectedPlates,
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

    it("preserves a valid supplied creditRevisionId and rejects invalid ones before requesting an upload URL", async () => {
      vi.stubEnv("NEXT_PUBLIC_LOCAL_MODE", "false");
      vi.stubEnv("NEXT_PUBLIC_CONVEX_URL", "https://example.convex.cloud");
      vi.stubEnv("TTS_QUOTA_BYPASS_SECRET", "publication-secret");

      expect(SHARE_CARD_CREDIT_REVISION_ID_PATTERN.test("custom_rev-01")).toBe(
        true,
      );
      expect(isValidShareCardCreditRevisionId("REV_123")).toBe(false);
      expect(isValidShareCardCreditRevisionId("short")).toBe(false);

      await expect(
        uploadAndSaveOnThisDayShareCard({
          monthDay: "10-18",
          version: 1,
          data: new Uint8Array([1, 2, 3]),
          mimeType: "image/jpeg",
          width: 1200,
          height: 630,
          generatedAt: 1_780_000_000_000,
          creditRevisionId: "REV_123",
          plates: samplePlates,
        }),
      ).rejects.toThrow("Invalid creditRevisionId");
      expect(fetchMutationMock).not.toHaveBeenCalled();

      fetchMutationMock
        .mockResolvedValueOnce("https://upload.example.test/share-card")
        .mockResolvedValueOnce({
          monthDay: "10-18",
          version: 1,
          storageId: "storage-custom-rev",
          replaced: false,
          rejectedStaleVersion: false,
        });
      vi.stubGlobal(
        "fetch",
        vi.fn(async () => Response.json({ storageId: "storage-custom-rev" })),
      );

      await uploadAndSaveOnThisDayShareCard({
        monthDay: "10-18",
        version: 1,
        data: new Uint8Array([1, 2, 3]),
        mimeType: "image/jpeg",
        width: 1200,
        height: 630,
        generatedAt: 1_780_000_000_000,
        creditRevisionId: "  custom_rev-01  ",
        plates: samplePlates,
      });

      const saveArgs = fetchMutationMock.mock.calls[1]?.[1] as {
        creditRevisionId?: string;
      };
      expect(saveArgs.creditRevisionId).toBe("custom_rev-01");
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
                    creditRevisionId: "a1b2c3d4e5f60708",
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
        creditRevisionId: "a1b2c3d4e5f60708",
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
      const getUrl = vi.fn(async () => "https://storage.convex.test/v2.jpg");
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
            storage: { delete: deleteStorage, getUrl },
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
      expect(insert).toHaveBeenCalledWith("onThisDayShareCards", {
        ...writeArgs,
        creditRevisionId: undefined,
      });
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
            storage: { delete: failingDelete, getUrl },
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
      expect(patch).toHaveBeenCalledWith("existing-card-id", {
        ...writeArgs,
        creditRevisionId: undefined,
      });
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
            storage: { delete: sameBlobDelete, getUrl },
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
            storage: { delete: cleanDelete, getUrl },
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

    it("throws when args.storageId no longer exists in storage without patching or deleting existing card", async () => {
      vi.stubEnv("TTS_QUOTA_BYPASS_SECRET", "publication-secret");
      const handler = registeredInvoker(saveShareCard);
      const writeArgs = {
        monthDay: "10-18",
        version: 1,
        storageId: "storage-vanished" as Id<"_storage">,
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
      const insert = vi.fn();
      const deleteStorage = vi.fn();
      const getUrl = vi.fn(async () => null);

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
                    storageId: "storage-healthy" as Id<"_storage">,
                  })),
                })),
              })),
              insert,
              patch,
            },
            storage: { delete: deleteStorage, getUrl },
          },
          { ...writeArgs, attestation },
        ),
      ).rejects.toThrow("no longer exists");

      expect(getUrl).toHaveBeenCalledWith("storage-vanished");
      expect(patch).not.toHaveBeenCalled();
      expect(insert).not.toHaveBeenCalled();
      expect(deleteStorage).not.toHaveBeenCalled();
    });

    it("stores append-only credit revisions that survive subsequent card replacements and supports revision queries", async () => {
      vi.stubEnv("TTS_QUOTA_BYPASS_SECRET", "publication-secret");
      vi.stubEnv("NEXT_PUBLIC_LOCAL_MODE", "false");
      vi.stubEnv("NEXT_PUBLIC_CONVEX_URL", "https://example.convex.cloud");

      const saveHandler = registeredInvoker(saveShareCard);
      const getRevHandler = registeredInvoker(getShareCardCreditsByRevision);

      const cards = new Map<
        string,
        {
          _id: string;
          monthDay: string;
          version: number;
          storageId: Id<"_storage">;
          creditRevisionId?: string;
          plates: StoredOnThisDayShareCardPlate[];
        }
      >();
      const revisions = new Map<string, StoredOnThisDayShareCardCreditRevision>();

      const makeCtx = () => ({
        db: {
          query: vi.fn((table: string) => ({
            withIndex: vi.fn((_idx: string, cb?: (q: { eq: (k: string, v: string) => unknown }) => unknown) => {
              let lookupVal = "";
              cb?.({
                eq: (_field: string, value: string) => {
                  lookupVal = value;
                  return value;
                },
              });
              return {
                first: vi.fn(async () => {
                  if (table === "onThisDayShareCards") {
                    return cards.get(lookupVal) ?? null;
                  }
                  if (table === "onThisDayShareCardCreditRevisions") {
                    return revisions.get(lookupVal) ?? null;
                  }
                  return null;
                }),
              };
            }),
          })),
          insert: vi.fn(async (table: string, doc: Record<string, unknown>) => {
            if (table === "onThisDayShareCards") {
              const monthDay = String(doc.monthDay);
              cards.set(monthDay, {
                _id: `card-${monthDay}`,
                monthDay,
                version: Number(doc.version),
                storageId: doc.storageId as Id<"_storage">,
                creditRevisionId: doc.creditRevisionId as string | undefined,
                plates: doc.plates as StoredOnThisDayShareCardPlate[],
              });
              return `card-${monthDay}`;
            }
            if (table === "onThisDayShareCardCreditRevisions") {
              const revId = String(doc.revisionId);
              revisions.set(revId, {
                revisionId: revId,
                monthDay: String(doc.monthDay),
                version: Number(doc.version),
                generatedAt: Number(doc.generatedAt),
                plates: doc.plates as StoredOnThisDayShareCardPlate[],
              });
              return `rev-${revId}`;
            }
            return "id";
          }),
          patch: vi.fn(async (_id: string, doc: Record<string, unknown>) => {
            const monthDay = String(doc.monthDay);
            cards.set(monthDay, {
              _id,
              monthDay,
              version: Number(doc.version),
              storageId: doc.storageId as Id<"_storage">,
              creditRevisionId: doc.creditRevisionId as string | undefined,
              plates: doc.plates as StoredOnThisDayShareCardPlate[],
            });
          }),
        },
        storage: {
          getUrl: vi.fn(async () => "https://storage.convex.test/blob.jpg"),
          delete: vi.fn(async () => undefined),
        },
      });

      const platesRev1: StoredOnThisDayShareCardPlate[] = [
        {
          year: 2019,
          articleTitle: "First Plate",
          imageUrl: "https://upload.wikimedia.org/wikipedia/commons/a/ab/One.jpg",
          licenseName: "CC BY-SA 4.0",
          creator: "Author One",
        },
      ];
      const rev1 = computeShareCardCreditRevisionId({
        monthDay: "10-18",
        version: 1,
        plates: platesRev1,
      });
      const writeArgs1 = {
        monthDay: "10-18",
        version: 1,
        storageId: "storage-r1" as Id<"_storage">,
        mimeType: "image/jpeg",
        width: 1200,
        height: 630,
        byteSize: 120_000,
        generatedAt: 1_780_000_000_000,
        creditRevisionId: rev1,
        plates: platesRev1,
      };
      const att1 = await createPublicAudioWriteAttestation({
        pipeline: "on-this-day",
        operation: "save-show-asset",
        args: writeArgs1,
      });
      await saveHandler(makeCtx(), { ...writeArgs1, attestation: att1 });

      // Replace card with different plates and rev2
      const platesRev2: StoredOnThisDayShareCardPlate[] = [
        {
          year: 2020,
          articleTitle: "Second Plate",
          imageUrl: "https://upload.wikimedia.org/wikipedia/commons/a/ab/Two.jpg",
          licenseName: "CC BY 4.0",
          creator: "Author Two",
        },
      ];
      const rev2 = computeShareCardCreditRevisionId({
        monthDay: "10-18",
        version: 1,
        plates: platesRev2,
      });
      expect(rev2).not.toBe(rev1);
      const writeArgs2 = {
        monthDay: "10-18",
        version: 1,
        storageId: "storage-r2" as Id<"_storage">,
        mimeType: "image/jpeg",
        width: 1200,
        height: 630,
        byteSize: 125_000,
        generatedAt: 1_780_000_050_000,
        creditRevisionId: rev2,
        plates: platesRev2,
      };
      const att2 = await createPublicAudioWriteAttestation({
        pipeline: "on-this-day",
        operation: "save-show-asset",
        args: writeArgs2,
      });
      await saveHandler(makeCtx(), { ...writeArgs2, attestation: att2 });

      // BOTH rev1 and rev2 remain readable after card replacement!
      await expect(
        getRevHandler(makeCtx(), { revisionId: rev1 }),
      ).resolves.toEqual({
        revisionId: rev1,
        monthDay: "10-18",
        version: 1,
        generatedAt: 1_780_000_000_000,
        plates: platesRev1,
      });
      await expect(
        getRevHandler(makeCtx(), { revisionId: rev2 }),
      ).resolves.toEqual({
        revisionId: rev2,
        monthDay: "10-18",
        version: 1,
        generatedAt: 1_780_000_050_000,
        plates: platesRev2,
      });
      await expect(
        getRevHandler(makeCtx(), { revisionId: "missing-rev-123" }),
      ).resolves.toBeNull();

      // Store adapter read helper
      fetchQueryMock.mockResolvedValueOnce(revisions.get(rev1));
      await expect(
        getStoredOnThisDayShareCardCreditsByRevision(rev1),
      ).resolves.toEqual(revisions.get(rev1));
      expect(fetchQueryMock).toHaveBeenCalledWith(
        anyApi.onThisDay.getShareCardCreditsByRevision,
        { revisionId: rev1 },
      );

      vi.stubEnv("NEXT_PUBLIC_LOCAL_MODE", "true");
      await expect(
        getStoredOnThisDayShareCardCreditsByRevision(rev1),
      ).resolves.toBeNull();
    });

    it("rejects reusing an existing creditRevisionId with different metadata and allows identical retries idempotently", async () => {
      vi.stubEnv("TTS_QUOTA_BYPASS_SECRET", "publication-secret");
      const saveHandler = registeredInvoker(saveShareCard);

      const originalPlates: StoredOnThisDayShareCardPlate[] = [
        {
          year: 2019,
          articleTitle: "NASA Astronaut Corps",
          imageUrl:
            "https://upload.wikimedia.org/wikipedia/commons/a/ab/Suits.jpg",
          licenseName: "CC BY-SA 4.0",
          creator: "Author One",
          sourceUrl: "https://commons.wikimedia.org/wiki/File:Suits.jpg",
        },
      ];
      const existingRevisionRow = {
        revisionId: "custom-rev-01",
        monthDay: "10-18",
        version: 1,
        generatedAt: 1_780_000_000_000,
        plates: originalPlates,
      };
      const existingCardRow = {
        _id: "existing-card-id",
        monthDay: "10-18",
        version: 1,
        storageId: "storage-existing" as Id<"_storage">,
        creditRevisionId: "custom-rev-01",
      };

      const makeCollisionCtx = () => {
        const patch = vi.fn(async () => undefined);
        const insert = vi.fn(async () => "inserted-id");
        const deleteStorage = vi.fn(async () => undefined);
        const ctx = {
          db: {
            query: vi.fn((table: string) => ({
              withIndex: vi.fn(() => ({
                first: vi.fn(async () => {
                  if (table === "onThisDayShareCards") return existingCardRow;
                  if (table === "onThisDayShareCardCreditRevisions") {
                    return existingRevisionRow;
                  }
                  return null;
                }),
              })),
            })),
            insert,
            patch,
          },
          storage: {
            getUrl: vi.fn(async () => "https://storage.convex.test/new.jpg"),
            delete: deleteStorage,
          },
        };
        return { ctx, patch, insert, deleteStorage };
      };

      // 1a. Collision on plates -> throws BEFORE patching active card or deleting existing blob
      const differentPlatesArgs = {
        monthDay: "10-18",
        version: 1,
        storageId: "storage-new" as Id<"_storage">,
        mimeType: "image/jpeg",
        width: 1200,
        height: 630,
        byteSize: 125_000,
        generatedAt: 1_780_000_100_000,
        creditRevisionId: "custom-rev-01",
        plates: [
          {
            ...originalPlates[0],
            creator: "Different Creator",
          },
        ],
      };
      const differentPlatesAtt = await createPublicAudioWriteAttestation({
        pipeline: "on-this-day",
        operation: "save-show-asset",
        args: differentPlatesArgs,
      });
      const plateCollision = makeCollisionCtx();
      await expect(
        saveHandler(plateCollision.ctx, {
          ...differentPlatesArgs,
          attestation: differentPlatesAtt,
        }),
      ).rejects.toThrow(
        "Share card credit revision custom-rev-01 already exists with different metadata",
      );
      expect(plateCollision.patch).not.toHaveBeenCalled();
      expect(plateCollision.insert).not.toHaveBeenCalled();
      expect(plateCollision.deleteStorage).not.toHaveBeenCalled();

      // 1b. Collision on monthDay -> throws without mutating
      const differentDayArgs = {
        ...differentPlatesArgs,
        monthDay: "10-19",
        plates: originalPlates,
      };
      const differentDayAtt = await createPublicAudioWriteAttestation({
        pipeline: "on-this-day",
        operation: "save-show-asset",
        args: differentDayArgs,
      });
      const dayCollision = makeCollisionCtx();
      await expect(
        saveHandler(dayCollision.ctx, {
          ...differentDayArgs,
          attestation: differentDayAtt,
        }),
      ).rejects.toThrow("already exists with different metadata");
      expect(dayCollision.patch).not.toHaveBeenCalled();
      expect(dayCollision.deleteStorage).not.toHaveBeenCalled();

      // 1c. Collision on version -> throws without mutating
      const differentVersionArgs = {
        ...differentPlatesArgs,
        version: 2,
        plates: originalPlates,
      };
      const differentVersionAtt = await createPublicAudioWriteAttestation({
        pipeline: "on-this-day",
        operation: "save-show-asset",
        args: differentVersionArgs,
      });
      const versionCollision = makeCollisionCtx();
      await expect(
        saveHandler(versionCollision.ctx, {
          ...differentVersionArgs,
          attestation: differentVersionAtt,
        }),
      ).rejects.toThrow("already exists with different metadata");
      expect(versionCollision.patch).not.toHaveBeenCalled();
      expect(versionCollision.deleteStorage).not.toHaveBeenCalled();

      // 2. Identical retry (same creditRevisionId, monthDay, version, plates) succeeds without duplicating revision row
      const retryArgs = {
        ...differentPlatesArgs,
        plates: originalPlates,
      };
      const retryAtt = await createPublicAudioWriteAttestation({
        pipeline: "on-this-day",
        operation: "save-show-asset",
        args: retryArgs,
      });
      const retryCtx = makeCollisionCtx();
      await expect(
        saveHandler(retryCtx.ctx, { ...retryArgs, attestation: retryAtt }),
      ).resolves.toEqual({
        monthDay: "10-18",
        version: 1,
        storageId: "storage-new",
        replaced: true,
        rejectedStaleVersion: false,
      });
      expect(retryCtx.patch).toHaveBeenCalledTimes(1);
      expect(retryCtx.insert).not.toHaveBeenCalled();
      expect(retryCtx.deleteStorage).toHaveBeenCalledWith("storage-existing");
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
