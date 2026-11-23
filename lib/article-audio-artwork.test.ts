import { afterEach, describe, expect, it, vi } from "vitest";
import { ARTWORK_IMAGE_USER_AGENT } from "./artwork-image";
import { renderArticleAudioArtworkResponse } from "./article-audio-artwork";

const SAMPLE_PNG_BYTES = Uint8Array.from([
  0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0x00, 0x00, 0x00, 0x0d,
  0x49, 0x48, 0x44, 0x52, 0x00, 0x00, 0x00, 0x01, 0x00, 0x00, 0x00, 0x01,
  0x08, 0x06, 0x00, 0x00, 0x00, 0x1f, 0x15, 0xc4, 0x89, 0x00, 0x00, 0x00,
  0x0a, 0x49, 0x44, 0x41, 0x54, 0x78, 0x9c, 0x63, 0x00, 0x01, 0x00, 0x00,
  0x05, 0x00, 0x01, 0x0d, 0x0a, 0x2d, 0xb4, 0x00, 0x00, 0x00, 0x00, 0x49,
  0x45, 0x4e, 0x44, 0xae, 0x42, 0x60, 0x82,
]);

const PNG_SIGNATURE = [0x89, 0x50, 0x4e, 0x47];

const mockHttpFetch = (reply: () => Response) => {
  const realFetch = globalThis.fetch;
  const httpCalls: Array<{ url: string; init?: RequestInit }> = [];

  vi.spyOn(globalThis, "fetch").mockImplementation(async (input, init) => {
    const url = String(input);
    if (url.startsWith("data:")) {
      return await realFetch(input, init);
    }
    httpCalls.push({ url, init });
    return reply();
  });

  return httpCalls;
};

describe("renderArticleAudioArtworkResponse", () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("fetches Wikimedia artwork with Curio Garden's User-Agent header and renders a PNG", async () => {
    const httpCalls = mockHttpFetch(
      () =>
        new Response(SAMPLE_PNG_BYTES, {
          status: 200,
          headers: { "content-type": "image/png" },
        }),
    );

    const imageUrl =
      "https://upload.wikimedia.org/wikipedia/commons/4/4c/Ada_Lovelace.png";
    const response = await renderArticleAudioArtworkResponse({
      title: "Ada Lovelace",
      summary: "English mathematician and writer.",
      imageUrl,
    });
    const bytes = new Uint8Array(await response.arrayBuffer());

    expect(response.status).toBe(200);
    expect(response.headers.get("content-type")).toContain("image/png");
    expect(Array.from(bytes.slice(0, 4))).toEqual(PNG_SIGNATURE);
    expect(httpCalls).toHaveLength(1);
    expect(httpCalls[0]?.url).toBe(imageUrl);
    expect(httpCalls[0]?.init).toEqual(
      expect.objectContaining({
        cache: "no-store",
        signal: expect.any(AbortSignal),
        headers: expect.objectContaining({
          "User-Agent": ARTWORK_IMAGE_USER_AGENT,
        }),
      }),
    );
  }, 60_000);

  it("falls back cleanly to a rendered PNG when the Wikimedia image fetch returns HTTP 429", async () => {
    const httpCalls = mockHttpFetch(
      () => new Response("Too many requests", { status: 429 }),
    );

    const response = await renderArticleAudioArtworkResponse({
      title: "Ada Lovelace",
      imageUrl:
        "https://upload.wikimedia.org/wikipedia/commons/4/4c/Ada_Lovelace.png",
    });
    const bytes = new Uint8Array(await response.arrayBuffer());

    expect(httpCalls).toHaveLength(1);
    expect(response.status).toBe(200);
    expect(response.headers.get("content-type")).toContain("image/png");
    expect(Array.from(bytes.slice(0, 4))).toEqual(PNG_SIGNATURE);
  }, 60_000);
});
