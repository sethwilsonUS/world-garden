import { NextRequest } from "next/server";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { StoredOnThisDayShareCard } from "@/lib/on-this-day-share-card-store";

const { getStoredShareCardMock } = vi.hoisted(() => ({
  getStoredShareCardMock: vi.fn<
    (monthDay: string) => Promise<StoredOnThisDayShareCard | null>
  >(async () => null),
}));

vi.mock("@/lib/on-this-day-share-card-store", () => ({
  getStoredOnThisDayShareCard: getStoredShareCardMock,
}));

import { dynamic, GET } from "./route";

describe("/api/on-this-day/share-card-credits route", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    getStoredShareCardMock.mockResolvedValue(null);
  });

  it("exports literal force-dynamic runtime config", () => {
    expect(dynamic).toBe("force-dynamic");
  });

  it("returns 400 when day parameter is missing or invalid", async () => {
    const missing = await GET(
      new NextRequest("https://curiogarden.org/api/on-this-day/share-card-credits"),
    );
    expect(missing.status).toBe(400);
    expect(missing.headers.get("cache-control")).toBe("no-store");

    const invalid = await GET(
      new NextRequest(
        "https://curiogarden.org/api/on-this-day/share-card-credits?day=february-30",
      ),
    );
    expect(invalid.status).toBe(400);
    expect(getStoredShareCardMock).not.toHaveBeenCalled();
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

  it("returns stored plate attribution metadata and public cache headers for MM-DD and calendar slugs", async () => {
    const storedCard: StoredOnThisDayShareCard = {
      monthDay: "10-18",
      version: 1,
      storageId: "storage-10-18",
      mimeType: "image/jpeg",
      width: 1200,
      height: 630,
      byteSize: 151_423,
      generatedAt: 1_780_000_000_000,
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
      plates: storedCard.plates,
    });
  });

  it("returns 503 with no-store headers when Convex lookup fails", async () => {
    const errorSpy = vi.spyOn(console, "error").mockImplementation(() => {});
    getStoredShareCardMock.mockRejectedValueOnce(new Error("Convex down"));

    try {
      const response = await GET(
        new NextRequest(
          "https://curiogarden.org/api/on-this-day/share-card-credits?day=03-15",
        ),
      );
      expect(response.status).toBe(503);
      expect(response.headers.get("cache-control")).toBe("no-store");
      expect(errorSpy).toHaveBeenCalled();
    } finally {
      errorSpy.mockRestore();
    }
  });
});
