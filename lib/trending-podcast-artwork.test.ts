import { afterEach, describe, expect, it, vi } from "vitest";
import { ARTWORK_IMAGE_USER_AGENT } from "./artwork-image";
import {
  formatTrendingArtworkDate,
  renderTrendingPodcastArtworkResponse,
  selectTrendingArtworkTiles,
} from "./trending-podcast-artwork";

const SAMPLE_PNG_BYTES = Uint8Array.from([
  0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0x00, 0x00, 0x00, 0x0d,
  0x49, 0x48, 0x44, 0x52, 0x00, 0x00, 0x00, 0x01, 0x00, 0x00, 0x00, 0x01,
  0x08, 0x06, 0x00, 0x00, 0x00, 0x1f, 0x15, 0xc4, 0x89, 0x00, 0x00, 0x00,
  0x0a, 0x49, 0x44, 0x41, 0x54, 0x78, 0x9c, 0x63, 0x00, 0x01, 0x00, 0x00,
  0x05, 0x00, 0x01, 0x0d, 0x0a, 0x2d, 0xb4, 0x00, 0x00, 0x00, 0x00, 0x49,
  0x45, 0x4e, 0x44, 0xae, 0x42, 0x60, 0x82,
]);

describe("formatTrendingArtworkDate", () => {
  it("formats the trending date for artwork badges", () => {
    expect(formatTrendingArtworkDate("2026-03-07")).toBe("Mar 7, 2026");
  });
});

describe("selectTrendingArtworkTiles", () => {
  it("prefers explicit artwork items and limits output to four tiles", () => {
    expect(
      selectTrendingArtworkTiles(
        [
          { title: "One", imageUrl: "1.png" },
          { title: "Two", imageUrl: "2.png" },
          { title: "Three", imageUrl: "3.png" },
          { title: "Four", imageUrl: "4.png" },
          { title: "Five", imageUrl: "5.png" },
        ],
      ),
    ).toEqual([
      { title: "One", imageUrl: "1.png" },
      { title: "Two", imageUrl: "2.png" },
      { title: "Three", imageUrl: "3.png" },
      { title: "Four", imageUrl: "4.png" },
    ]);
  });

  it("falls back to legacy title and image arrays when artwork items are missing", () => {
    expect(
      selectTrendingArtworkTiles(
        undefined,
        ["One", "Two", "Three", "Four", "Five"],
        ["1.png", "2.png", "3.png", "4.png", "5.png"],
      ),
    ).toEqual([
      { title: "One", imageUrl: "1.png" },
      { title: "Two", imageUrl: "2.png" },
      { title: "Three", imageUrl: "3.png" },
      { title: "Four", imageUrl: "4.png" },
    ]);
  });

  it("falls back to title-only tiles when some image urls are missing", () => {
    expect(
      selectTrendingArtworkTiles(
        undefined,
        ["One", "Two"],
        ["1.png"],
      ),
    ).toEqual([
      { title: "One", imageUrl: "1.png" },
      { title: "Two", imageUrl: undefined },
    ]);
  });
});

describe("renderTrendingPodcastArtworkResponse", () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("sends Curio Garden's User-Agent for collage tiles, degrades gracefully on 429, and renders a PNG", async () => {
    const realFetch = globalThis.fetch;
    const httpCalls: Array<{ url: string; init?: RequestInit }> = [];
    const urlOne =
      "https://upload.wikimedia.org/wikipedia/commons/a/ab/One.png";
    const urlTwo =
      "https://upload.wikimedia.org/wikipedia/commons/b/bc/Two.png";

    vi.spyOn(globalThis, "fetch").mockImplementation(async (input, init) => {
      const url = String(input);
      if (url.startsWith("data:")) {
        return await realFetch(input, init);
      }
      httpCalls.push({ url, init });
      if (url === urlOne) {
        return new Response(SAMPLE_PNG_BYTES, {
          status: 200,
          headers: { "content-type": "image/png" },
        });
      }
      return new Response("Too many requests", { status: 429 });
    });

    const response = await renderTrendingPodcastArtworkResponse({
      trendingDate: "2026-11-22",
      artworkItems: [
        { title: "One", imageUrl: urlOne },
        { title: "Two", imageUrl: urlTwo },
      ],
    });
    const bytes = new Uint8Array(await response.arrayBuffer());

    expect(response.status).toBe(200);
    expect(response.headers.get("content-type")).toContain("image/png");
    expect(Array.from(bytes.slice(0, 4))).toEqual([0x89, 0x50, 0x4e, 0x47]);
    expect(httpCalls).toHaveLength(2);
    expect(httpCalls.map((call) => call.url)).toEqual([urlOne, urlTwo]);
    for (const call of httpCalls) {
      expect(call.init).toEqual(
        expect.objectContaining({
          cache: "no-store",
          signal: expect.any(AbortSignal),
          headers: expect.objectContaining({
            "User-Agent": ARTWORK_IMAGE_USER_AGENT,
          }),
        }),
      );
    }
  }, 20_000);
});
