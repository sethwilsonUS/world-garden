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

describe("renderArticleAudioArtworkResponse", () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("fetches Wikimedia artwork with Curio Garden's User-Agent header", async () => {
    const fetchSpy = vi.spyOn(globalThis, "fetch").mockResolvedValue(
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

    expect(response.status).toBe(200);
    expect(response.headers.get("content-type")).toContain("image/png");
    expect(fetchSpy).toHaveBeenCalledWith(
      imageUrl,
      expect.objectContaining({
        cache: "no-store",
        signal: expect.any(AbortSignal),
        headers: expect.objectContaining({
          "User-Agent": ARTWORK_IMAGE_USER_AGENT,
        }),
      }),
    );
  });

  it("falls back cleanly when the Wikimedia image fetch returns HTTP 429", async () => {
    const fetchSpy = vi
      .spyOn(globalThis, "fetch")
      .mockResolvedValue(new Response("Too many requests", { status: 429 }));

    const response = await renderArticleAudioArtworkResponse({
      title: "Ada Lovelace",
      imageUrl:
        "https://upload.wikimedia.org/wikipedia/commons/4/4c/Ada_Lovelace.png",
    });

    expect(fetchSpy).toHaveBeenCalledTimes(1);
    expect(response.status).toBe(200);
    expect(response.headers.get("content-type")).toContain("image/png");
  });
});
