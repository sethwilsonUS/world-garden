import { afterEach, describe, expect, it, vi } from "vitest";
import { ARTWORK_IMAGE_USER_AGENT } from "./artwork-image";
import {
  formatFeaturedArtworkDate,
  renderFeaturedPodcastArtworkResponse,
} from "./featured-podcast-artwork";

const SAMPLE_PNG_BYTES = Uint8Array.from([
  0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0x00, 0x00, 0x00, 0x0d,
  0x49, 0x48, 0x44, 0x52, 0x00, 0x00, 0x00, 0x01, 0x00, 0x00, 0x00, 0x01,
  0x08, 0x06, 0x00, 0x00, 0x00, 0x1f, 0x15, 0xc4, 0x89, 0x00, 0x00, 0x00,
  0x0a, 0x49, 0x44, 0x41, 0x54, 0x78, 0x9c, 0x63, 0x00, 0x01, 0x00, 0x00,
  0x05, 0x00, 0x01, 0x0d, 0x0a, 0x2d, 0xb4, 0x00, 0x00, 0x00, 0x00, 0x49,
  0x45, 0x4e, 0x44, 0xae, 0x42, 0x60, 0x82,
]);

describe("formatFeaturedArtworkDate", () => {
  it("formats featured artwork dates in UTC", () => {
    expect(formatFeaturedArtworkDate("2026-03-09")).toBe("Mar 9, 2026");
  });
});

describe("renderFeaturedPodcastArtworkResponse", () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("sends Curio Garden's User-Agent when fetching featured episode images", async () => {
    const fetchSpy = vi.spyOn(globalThis, "fetch").mockResolvedValue(
      new Response(SAMPLE_PNG_BYTES, {
        status: 200,
        headers: { "content-type": "image/png" },
      }),
    );

    const imageUrl =
      "https://upload.wikimedia.org/wikipedia/en/8/8d/Mairzy_Doates_at_the_1981_Japan_Cup.jpeg";
    const response = await renderFeaturedPodcastArtworkResponse({
      featuredDate: "2026-11-22",
      title: "Mairzy Doates",
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

  it("falls back cleanly when the upstream image response is non-image HTML", async () => {
    const fetchSpy = vi.spyOn(globalThis, "fetch").mockResolvedValue(
      new Response("<html>error</html>", {
        status: 200,
        headers: { "content-type": "text/html" },
      }),
    );

    const response = await renderFeaturedPodcastArtworkResponse({
      featuredDate: "2026-11-22",
      title: "Mairzy Doates",
      imageUrl:
        "https://upload.wikimedia.org/wikipedia/en/8/8d/Mairzy_Doates_at_the_1981_Japan_Cup.jpeg",
    });

    expect(fetchSpy).toHaveBeenCalledTimes(1);
    expect(response.status).toBe(200);
    expect(response.headers.get("content-type")).toContain("image/png");
  });
});
