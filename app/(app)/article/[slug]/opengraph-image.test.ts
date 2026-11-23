import { afterEach, describe, expect, it, vi } from "vitest";
import { ARTWORK_IMAGE_USER_AGENT } from "@/lib/artwork-image";
import OgImage from "./opengraph-image";
import TwitterImage from "./twitter-image";

const SAMPLE_PNG_BYTES = Uint8Array.from([
  0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0x00, 0x00, 0x00, 0x0d,
  0x49, 0x48, 0x44, 0x52, 0x00, 0x00, 0x00, 0x01, 0x00, 0x00, 0x00, 0x01,
  0x08, 0x06, 0x00, 0x00, 0x00, 0x1f, 0x15, 0xc4, 0x89, 0x00, 0x00, 0x00,
  0x0a, 0x49, 0x44, 0x41, 0x54, 0x78, 0x9c, 0x63, 0x00, 0x01, 0x00, 0x00,
  0x05, 0x00, 0x01, 0x0d, 0x0a, 0x2d, 0xb4, 0x00, 0x00, 0x00, 0x00, 0x49,
  0x45, 0x4e, 0x44, 0xae, 0x42, 0x60, 0x82,
]);

const PNG_SIGNATURE = [0x89, 0x50, 0x4e, 0x47];

const mockOgFetch = (
  thumbnailUrl: string,
  thumbnailResponse: Response,
) => {
  const realFetch = globalThis.fetch;
  const httpCalls: Array<{ url: string; init?: RequestInit }> = [];

  vi.spyOn(globalThis, "fetch").mockImplementation(async (input, init) => {
    const url = String(input);
    if (url.startsWith("data:")) {
      return await realFetch(input, init);
    }
    httpCalls.push({ url, init });
    if (url.includes("/page/summary/")) {
      return new Response(
        JSON.stringify({
          title: "Ada Lovelace",
          extract: "English mathematician and writer.",
          thumbnail: { source: thumbnailUrl },
        }),
        {
          status: 200,
          headers: { "content-type": "application/json" },
        },
      );
    }
    if (url === thumbnailUrl) {
      return thumbnailResponse;
    }
    throw new Error(`Unexpected HTTP fetch in OpenGraph test: ${url}`);
  });

  return httpCalls;
};

describe("article OpenGraph and Twitter image generation", () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("pre-fetches Wikimedia thumbnails with Curio Garden's User-Agent and renders a PNG", async () => {
    const thumbnailUrl =
      "https://upload.wikimedia.org/wikipedia/commons/4/4c/Ada_Lovelace.png";
    const httpCalls = mockOgFetch(
      thumbnailUrl,
      new Response(SAMPLE_PNG_BYTES, {
        status: 200,
        headers: { "content-type": "image/png" },
      }),
    );

    expect(TwitterImage).toBe(OgImage);

    const response = await OgImage({
      params: Promise.resolve({ slug: "Ada_Lovelace" }),
    });
    const bytes = new Uint8Array(await response.arrayBuffer());

    expect(response.status).toBe(200);
    expect(Array.from(bytes.slice(0, 4))).toEqual(PNG_SIGNATURE);
    // Only the summary lookup and our pre-fetch should hit HTTP; Satori must
    // not perform an anonymous third fetch for the raw Wikimedia URL.
    expect(httpCalls).toHaveLength(2);
    expect(httpCalls[1]?.url).toBe(thumbnailUrl);
    expect(httpCalls[1]?.init).toEqual(
      expect.objectContaining({
        cache: "no-store",
        signal: expect.any(AbortSignal),
        headers: expect.objectContaining({
          "User-Agent": ARTWORK_IMAGE_USER_AGENT,
        }),
      }),
    );
  });

  it("renders the fallback card cleanly when Wikimedia returns 429 for the thumbnail", async () => {
    const thumbnailUrl =
      "https://upload.wikimedia.org/wikipedia/commons/4/4c/Ada_Lovelace.png";
    const httpCalls = mockOgFetch(
      thumbnailUrl,
      new Response("Too many requests", { status: 429 }),
    );

    const response = await OgImage({
      params: Promise.resolve({ slug: "Ada_Lovelace" }),
    });
    const bytes = new Uint8Array(await response.arrayBuffer());

    expect(response.status).toBe(200);
    expect(Array.from(bytes.slice(0, 4))).toEqual(PNG_SIGNATURE);
    expect(httpCalls).toHaveLength(2);
  });
});
