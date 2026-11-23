import { NextRequest } from "next/server";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type {
  StoredOnThisDayShareCard,
  StoredOnThisDayShareCardCreditRevision,
} from "@/lib/on-this-day-share-card-store";

const { getStoredShareCardMock, getStoredCreditsByRevisionMock } = vi.hoisted(
  () => ({
    getStoredShareCardMock: vi.fn<
      (monthDay: string) => Promise<StoredOnThisDayShareCard | null>
    >(async () => null),
    getStoredCreditsByRevisionMock: vi.fn<
      (
        revisionId: string,
      ) => Promise<StoredOnThisDayShareCardCreditRevision | null>
    >(async () => null),
  }),
);

vi.mock("@/lib/on-this-day-share-card-store", () => ({
  getStoredOnThisDayShareCard: getStoredShareCardMock,
  getStoredOnThisDayShareCardCreditsByRevision: getStoredCreditsByRevisionMock,
}));

import { dynamic, GET } from "./route";

describe("/api/on-this-day/share-card-credits route", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    getStoredShareCardMock.mockResolvedValue(null);
    getStoredCreditsByRevisionMock.mockResolvedValue(null);
  });

  it("exports literal force-dynamic runtime config", () => {
    expect(dynamic).toBe("force-dynamic");
  });

  it("returns 400 when day/rev parameters are missing or invalid", async () => {
    const missing = await GET(
      new NextRequest(
        "https://curiogarden.org/api/on-this-day/share-card-credits",
      ),
    );
    expect(missing.status).toBe(400);
    expect(missing.headers.get("cache-control")).toBe("no-store");

    const invalidDay = await GET(
      new NextRequest(
        "https://curiogarden.org/api/on-this-day/share-card-credits?day=february-30",
      ),
    );
    expect(invalidDay.status).toBe(400);

    const invalidRevShort = await GET(
      new NextRequest(
        "https://curiogarden.org/api/on-this-day/share-card-credits?rev=abc",
      ),
    );
    expect(invalidRevShort.status).toBe(400);

    const invalidRevChars = await GET(
      new NextRequest(
        "https://curiogarden.org/api/on-this-day/share-card-credits?rev=BAD!REV$123",
      ),
    );
    expect(invalidRevChars.status).toBe(400);

    expect(getStoredShareCardMock).not.toHaveBeenCalled();
    expect(getStoredCreditsByRevisionMock).not.toHaveBeenCalled();
  });

  it("returns 404 when no stored Share Card exists for the requested day", async () => {
    getStoredShareCardMock.mockResolvedValueOnce(null);

    const response = await GET(
      new NextRequest(
        "https://curiogarden.org/api/on-this-day/share-card-credits?day=10-18",
      ),
    );
    expect(response.status).toBe(404);
    expect(response.headers.get("cache-control")).toBe("no-store");
    expect(getStoredShareCardMock).toHaveBeenCalledWith("10-18");
  });

  it("returns stored active card attribution metadata (including creditRevisionId) and public cache headers", async () => {
    const storedCard: StoredOnThisDayShareCard = {
      monthDay: "10-18",
      version: 1,
      storageId: "storage-10-18",
      mimeType: "image/jpeg",
      width: 1200,
      height: 630,
      byteSize: 151_423,
      generatedAt: 1_780_000_000_000,
      creditRevisionId: "a1b2c3d4e5f60708",
      plates: [
        {
          year: 2019,
          articleTitle: "NASA Astronaut Corps",
          imageUrl:
            "https://upload.wikimedia.org/wikipedia/commons/thumb/1/15/NASA_space_suits_at_JSC.jpg/330px-NASA_space_suits_at_JSC.jpg",
          licenseName: "CC BY-SA 4.0",
          creator: "Jane Photographer",
          sourceUrl:
            "https://commons.wikimedia.org/wiki/File:NASA_space_suits_at_JSC.jpg",
        },
        {
          articleTitle: "Undated Plate",
          imageUrl:
            "https://upload.wikimedia.org/wikipedia/commons/a/ab/Undated.jpg",
        },
      ],
      imageUrl: "https://storage.convex.test/10-18.jpg",
    };
    getStoredShareCardMock.mockResolvedValue(storedCard);

    const response = await GET(
      new NextRequest(
        "https://curiogarden.org/api/on-this-day/share-card-credits?day=october-18",
      ),
    );
    expect(response.status).toBe(200);
    expect(response.headers.get("cache-control")).toBe(
      "public, max-age=3600, s-maxage=86400, stale-while-revalidate=604800",
    );
    expect(getStoredShareCardMock).toHaveBeenCalledWith("10-18");
    await expect(response.json()).resolves.toEqual({
      monthDay: "10-18",
      version: 1,
      generatedAt: 1_780_000_000_000,
      creditRevisionId: "a1b2c3d4e5f60708",
      plates: storedCard.plates,
    });
  });

  it("serves immutable revision-pinned credits on ?rev= with immutable cache headers", async () => {
    const storedRevision: StoredOnThisDayShareCardCreditRevision = {
      revisionId: "deadbeef01234567",
      monthDay: "10-18",
      version: 1,
      generatedAt: 1_780_000_000_000,
      plates: [
        {
          year: 1967,
          articleTitle: "Venera 4",
          imageUrl:
            "https://upload.wikimedia.org/wikipedia/commons/a/ab/Venera.jpg",
          licenseName: "CC BY 4.0",
          creator: "Museum Archivist",
          sourceUrl: "https://commons.wikimedia.org/wiki/File:Venera.jpg",
        },
      ],
    };
    getStoredCreditsByRevisionMock.mockResolvedValueOnce(storedRevision);

    const response = await GET(
      new NextRequest(
        "https://curiogarden.org/api/on-this-day/share-card-credits?day=10-18&rev=deadbeef01234567",
      ),
    );
    expect(response.status).toBe(200);
    expect(response.headers.get("cache-control")).toBe(
      "public, max-age=86400, s-maxage=31536000, immutable",
    );
    expect(getStoredCreditsByRevisionMock).toHaveBeenCalledWith(
      "deadbeef01234567",
    );
    expect(getStoredShareCardMock).not.toHaveBeenCalled();
    await expect(response.json()).resolves.toEqual(storedRevision);
  });

  it("returns 404 when ?rev= is missing or does not match an accompanying ?day=", async () => {
    getStoredCreditsByRevisionMock.mockResolvedValueOnce(null);
    const missingRev = await GET(
      new NextRequest(
        "https://curiogarden.org/api/on-this-day/share-card-credits?rev=deadbeef01234567",
      ),
    );
    expect(missingRev.status).toBe(404);
    expect(missingRev.headers.get("cache-control")).toBe("no-store");

    getStoredCreditsByRevisionMock.mockResolvedValueOnce({
      revisionId: "deadbeef01234567",
      monthDay: "10-18",
      version: 1,
      generatedAt: 1_780_000_000_000,
      plates: [],
    });
    const mismatchedDay = await GET(
      new NextRequest(
        "https://curiogarden.org/api/on-this-day/share-card-credits?day=03-15&rev=deadbeef01234567",
      ),
    );
    expect(mismatchedDay.status).toBe(404);
    expect(mismatchedDay.headers.get("cache-control")).toBe("no-store");
  });

  it("returns 503 with no-store headers when Convex lookup fails", async () => {
    const errorSpy = vi.spyOn(console, "error").mockImplementation(() => {});
    getStoredShareCardMock.mockRejectedValueOnce(new Error("Convex down"));
    getStoredCreditsByRevisionMock.mockRejectedValueOnce(
      new Error("Convex down"),
    );

    try {
      const dayResp = await GET(
        new NextRequest(
          "https://curiogarden.org/api/on-this-day/share-card-credits?day=03-15",
        ),
      );
      expect(dayResp.status).toBe(503);
      expect(dayResp.headers.get("cache-control")).toBe("no-store");

      const revResp = await GET(
        new NextRequest(
          "https://curiogarden.org/api/on-this-day/share-card-credits?rev=deadbeef01234567",
        ),
      );
      expect(revResp.status).toBe(503);
      expect(revResp.headers.get("cache-control")).toBe("no-store");
      expect(errorSpy).toHaveBeenCalledTimes(2);
    } finally {
      errorSpy.mockRestore();
    }
  });
});
