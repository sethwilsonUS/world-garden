import sharp from "sharp";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { ON_THIS_DAY_SHARE_CARD_VERSION } from "@/lib/on-this-day-share-card";
import type { StoredOnThisDayShareCard } from "@/lib/on-this-day-share-card-store";

const {
  notFoundMock,
  shouldUseSnapshotCacheMock,
  getStoredShareCardMock,
} = vi.hoisted(() => ({
  notFoundMock: vi.fn(() => {
    throw new Error("NEXT_NOT_FOUND");
  }),
  shouldUseSnapshotCacheMock: vi.fn<() => boolean>(() => false),
  getStoredShareCardMock: vi.fn<
    (monthDay: string) => Promise<StoredOnThisDayShareCard | null>
  >(async () => null),
}));

vi.mock("next/navigation", () => ({
  notFound: notFoundMock,
}));

vi.mock("@/lib/on-this-day-snapshot", () => ({
  shouldUseOnThisDaySnapshotCache: shouldUseSnapshotCacheMock,
}));

vi.mock("@/lib/on-this-day-share-card-store", () => ({
  getStoredOnThisDayShareCard: getStoredShareCardMock,
}));

import OgImage, {
  alt as ogAlt,
  contentType as ogContentType,
  dynamic as ogDynamic,
  size as ogSize,
} from "./opengraph-image";
import TwitterImage, {
  alt as twitterAlt,
  contentType as twitterContentType,
  dynamic as twitterDynamic,
  size as twitterSize,
} from "./twitter-image";

const JPEG_SOI_SIGNATURE = [0xff, 0xd8, 0xff];
const ORIGINAL_FETCH = globalThis.fetch;

const stubStoredBlobFetch = (
  handler: (input: RequestInfo | URL, init?: RequestInit) => Promise<Response>,
) => {
  const fetchSpy = vi.fn(
    async (input: RequestInfo | URL, init?: RequestInit): Promise<Response> => {
      const url =
        typeof input === "string"
          ? input
          : input instanceof URL
            ? input.toString()
            : input.url;
      if (url.startsWith("https://convex.example.com/")) {
        return await handler(input, init);
      }
      return await ORIGINAL_FETCH(input, init);
    },
  );
  vi.stubGlobal("fetch", fetchSpy);
  return fetchSpy;
};

const createStoredCard = (
  overrides: Partial<StoredOnThisDayShareCard> = {},
): StoredOnThisDayShareCard => ({
  monthDay: "10-18",
  version: ON_THIS_DAY_SHARE_CARD_VERSION,
  storageId: "kg2storedcard123",
  mimeType: "image/jpeg",
  width: 1200,
  height: 630,
  byteSize: 120_000,
  generatedAt: 1_760_000_000_000,
  plates: [
    {
      year: 1867,
      articleTitle: "Alaska Purchase",
      imageUrl: "https://upload.wikimedia.org/wikipedia/commons/alaska.jpg",
      licenseName: "Public domain",
    },
  ],
  imageUrl: "https://convex.example.com/api/storage/kg2storedcard123",
  ...overrides,
});

describe("On This Day calendar day OpenGraph and Twitter images", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    shouldUseSnapshotCacheMock.mockReturnValue(false);
    getStoredShareCardMock.mockResolvedValue(null);
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  it("declares literal force-dynamic, image/jpeg, and 1200x630 exports on both routes", () => {
    expect(TwitterImage).toBe(OgImage);
    expect(ogDynamic).toBe("force-dynamic");
    expect(twitterDynamic).toBe("force-dynamic");
    expect(ogContentType).toBe("image/jpeg");
    expect(twitterContentType).toBe("image/jpeg");
    expect(ogSize).toEqual({ width: 1200, height: 630 });
    expect(twitterSize).toEqual({ width: 1200, height: 630 });
    expect(ogAlt).toContain("On This Day");
    expect(twitterAlt).toBe(ogAlt);
  });

  it("streams stored Convex JPEG bytes when a current-version share card exists", async () => {
    shouldUseSnapshotCacheMock.mockReturnValue(true);
    const storedCard = createStoredCard();
    getStoredShareCardMock.mockResolvedValue(storedCard);

    const fakeStoredJpeg = new Uint8Array([0xff, 0xd8, 0xff, 0xe0, 0x00, 0x10]);
    const fetchMock = stubStoredBlobFetch(
      async () =>
        new Response(fakeStoredJpeg, {
          status: 200,
          headers: { "Content-Type": "image/jpeg" },
        }),
    );

    const response = await OgImage({
      params: Promise.resolve({ day: "october-18" }),
    });
    const bytes = new Uint8Array(await response.arrayBuffer());

    expect(getStoredShareCardMock).toHaveBeenCalledWith("10-18");
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(fetchMock).toHaveBeenCalledWith(
      storedCard.imageUrl,
      expect.objectContaining({ cache: "no-store" }),
    );
    expect(response.status).toBe(200);
    expect(response.headers.get("content-type")).toBe("image/jpeg");
    expect(response.headers.get("cache-control")).toBe(
      "public, max-age=86400, s-maxage=604800, stale-while-revalidate=2592000",
    );
    expect(Array.from(bytes)).toEqual(Array.from(fakeStoredJpeg));
  });

  it("falls back to instant timeline JPEG on stored card version mismatch without fetching blob", async () => {
    shouldUseSnapshotCacheMock.mockReturnValue(true);
    getStoredShareCardMock.mockResolvedValue(
      createStoredCard({ version: ON_THIS_DAY_SHARE_CARD_VERSION + 99 }),
    );
    const storedBlobSpy = vi.fn(
      async () => new Response("should not be called", { status: 500 }),
    );
    stubStoredBlobFetch(storedBlobSpy);

    const response = await OgImage({
      params: Promise.resolve({ day: "october-18" }),
    });
    const bytes = new Uint8Array(await response.arrayBuffer());
    const metadata = await sharp(bytes).metadata();

    expect(storedBlobSpy).not.toHaveBeenCalled();
    expect(response.status).toBe(200);
    expect(response.headers.get("content-type")).toBe("image/jpeg");
    expect(response.headers.get("cache-control")).toBe(
      "public, max-age=300, s-maxage=900",
    );
    expect(Array.from(bytes.slice(0, 3))).toEqual(JPEG_SOI_SIGNATURE);
    expect(metadata.format).toBe("jpeg");
    expect(metadata.width).toBe(1200);
    expect(metadata.height).toBe(630);
  }, 20_000);

  it("falls back to instant timeline JPEG when Convex storage blob fetch fails", async () => {
    shouldUseSnapshotCacheMock.mockReturnValue(true);
    getStoredShareCardMock.mockResolvedValue(createStoredCard());

    const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});
    const storedBlobSpy = vi.fn(
      async () => new Response("Storage error", { status: 503 }),
    );
    stubStoredBlobFetch(storedBlobSpy);

    const response = await OgImage({
      params: Promise.resolve({ day: "october-18" }),
    });
    const bytes = new Uint8Array(await response.arrayBuffer());
    const metadata = await sharp(bytes).metadata();

    expect(storedBlobSpy).toHaveBeenCalledTimes(1);
    expect(warnSpy).toHaveBeenCalled();
    expect(response.status).toBe(200);
    expect(response.headers.get("content-type")).toBe("image/jpeg");
    expect(response.headers.get("cache-control")).toBe(
      "public, max-age=300, s-maxage=900",
    );
    expect(Array.from(bytes.slice(0, 3))).toEqual(JPEG_SOI_SIGNATURE);
    expect(metadata.format).toBe("jpeg");
    expect(metadata.width).toBe(1200);
    expect(metadata.height).toBe(630);
  }, 20_000);

  it("falls back to instant timeline JPEG when Convex lookup throws", async () => {
    shouldUseSnapshotCacheMock.mockReturnValue(true);
    getStoredShareCardMock.mockRejectedValue(new Error("Convex unavailable"));
    const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});

    const response = await OgImage({
      params: Promise.resolve({ day: "march-5" }),
    });
    const bytes = new Uint8Array(await response.arrayBuffer());
    const metadata = await sharp(bytes).metadata();

    expect(warnSpy).toHaveBeenCalled();
    expect(response.status).toBe(200);
    expect(response.headers.get("content-type")).toBe("image/jpeg");
    expect(response.headers.get("cache-control")).toBe(
      "public, max-age=300, s-maxage=900",
    );
    expect(metadata.width).toBe(1200);
    expect(metadata.height).toBe(630);
  }, 20_000);

  it("renders local-mode timeline fallback JPEG without querying Convex (including February 29)", async () => {
    shouldUseSnapshotCacheMock.mockReturnValue(false);

    const response = await OgImage({
      params: Promise.resolve({ day: "february-29" }),
    });
    const bytes = new Uint8Array(await response.arrayBuffer());
    const metadata = await sharp(bytes).metadata();

    expect(getStoredShareCardMock).not.toHaveBeenCalled();
    expect(response.status).toBe(200);
    expect(response.headers.get("content-type")).toBe("image/jpeg");
    expect(response.headers.get("cache-control")).toBe(
      "public, max-age=300, s-maxage=900",
    );
    expect(Array.from(bytes.slice(0, 3))).toEqual(JPEG_SOI_SIGNATURE);
    expect(metadata.format).toBe("jpeg");
    expect(metadata.width).toBe(1200);
    expect(metadata.height).toBe(630);
  }, 20_000);

  it("calls notFound() for invalid calendar day slugs", async () => {
    await expect(
      OgImage({
        params: Promise.resolve({ day: "february-30" }),
      }),
    ).rejects.toThrow("NEXT_NOT_FOUND");
    expect(notFoundMock).toHaveBeenCalledTimes(1);
    expect(getStoredShareCardMock).not.toHaveBeenCalled();
  });
});
