import sharp from "sharp";
import { describe, expect, it, vi } from "vitest";
import {
  ON_THIS_DAY_OG_SIZE,
  type OnThisDayOgPlate,
} from "@/app/(app)/on-this-day/og-card";
import { ARTWORK_IMAGE_USER_AGENT } from "@/lib/artwork-image";
import {
  fetchNormalizedShareCardPlate,
  normalizeShareCardPlateImage,
  ON_THIS_DAY_SHARE_CARD_MIME_TYPE,
  ON_THIS_DAY_SHARE_CARD_VERSION,
  renderOnThisDayShareCardJpeg,
} from "@/lib/on-this-day-share-card";

const createTestImage = async ({
  width,
  height,
  format,
  color,
}: {
  width: number;
  height: number;
  format: "png" | "webp" | "jpeg";
  color: { r: number; g: number; b: number; alpha?: number };
}): Promise<Uint8Array> => {
  const pipeline = sharp({
    create: {
      width,
      height,
      channels: 4,
      background: {
        r: color.r,
        g: color.g,
        b: color.b,
        alpha: color.alpha ?? 1,
      },
    },
  });

  if (format === "png") {
    return new Uint8Array(await pipeline.png().toBuffer());
  }
  if (format === "webp") {
    return new Uint8Array(await pipeline.webp().toBuffer());
  }
  return new Uint8Array(
    await pipeline.flatten({ background: "#f7f2e7" }).jpeg().toBuffer(),
  );
};

const decodeDataUrl = (dataUrl: string): Buffer => {
  const prefix = `data:${ON_THIS_DAY_SHARE_CARD_MIME_TYPE};base64,`;
  expect(dataUrl.startsWith(prefix)).toBe(true);
  return Buffer.from(dataUrl.slice(prefix.length), "base64");
};

const createSamplePlate = async ({
  width,
  height,
  alt,
  yearLabel,
  color,
}: {
  width: number;
  height: number;
  alt: string;
  yearLabel?: string;
  color: { r: number; g: number; b: number };
}): Promise<OnThisDayOgPlate> => {
  const bytes = await createTestImage({
    width,
    height,
    format: "png",
    color,
  });
  const normalized = await normalizeShareCardPlateImage(bytes);
  expect(normalized).not.toBeNull();
  if (!normalized) {
    throw new Error(`Expected sample plate ${alt} to normalize`);
  }

  return {
    imageDataUrl: normalized.imageDataUrl,
    alt,
    yearLabel,
    isPortrait: normalized.isPortrait,
  };
};

describe("on-this-day-share-card constants", () => {
  it("exports version 1 and image/jpeg mime type", () => {
    expect(ON_THIS_DAY_SHARE_CARD_VERSION).toBe(1);
    expect(ON_THIS_DAY_SHARE_CARD_MIME_TYPE).toBe("image/jpeg");
  });
});

describe("normalizeShareCardPlateImage", () => {
  it("converts transparent PNGs into opaque baseline JPEG data URLs", async () => {
    const pngBytes = await createTestImage({
      width: 320,
      height: 240,
      format: "png",
      color: { r: 23, g: 72, b: 58, alpha: 0.5 },
    });

    const normalized = await normalizeShareCardPlateImage(pngBytes);
    expect(normalized).not.toBeNull();
    expect(normalized?.width).toBe(320);
    expect(normalized?.height).toBe(240);
    expect(normalized?.isPortrait).toBe(false);

    const decoded = decodeDataUrl(normalized?.imageDataUrl ?? "");
    const metadata = await sharp(decoded).metadata();
    expect(metadata.format).toBe("jpeg");
    expect(metadata.isProgressive).toBe(false);
    expect(metadata.hasAlpha).toBe(false);
    expect(metadata.width).toBe(320);
    expect(metadata.height).toBe(240);
  });

  it("converts WebP portraits and accurately detects portrait orientation", async () => {
    const webpBytes = await createTestImage({
      width: 360,
      height: 520,
      format: "webp",
      color: { r: 120, g: 85, b: 60 },
    });

    const normalized = await normalizeShareCardPlateImage(webpBytes);
    expect(normalized).not.toBeNull();
    expect(normalized?.width).toBe(360);
    expect(normalized?.height).toBe(520);
    expect(normalized?.isPortrait).toBe(true);

    const decoded = decodeDataUrl(normalized?.imageDataUrl ?? "");
    const metadata = await sharp(decoded).metadata();
    expect(metadata.format).toBe("jpeg");
    expect(metadata.width).toBe(360);
    expect(metadata.height).toBe(520);
  });

  it("resizes oversized images inside 640x640 without enlarging smaller ones", async () => {
    const largeLandscape = await createTestImage({
      width: 1280,
      height: 800,
      format: "jpeg",
      color: { r: 44, g: 82, b: 130 },
    });
    const largePortrait = await createTestImage({
      width: 900,
      height: 1500,
      format: "png",
      color: { r: 90, g: 64, b: 48 },
    });

    const landscapeResult = await normalizeShareCardPlateImage(largeLandscape);
    const portraitResult = await normalizeShareCardPlateImage(largePortrait);

    expect(landscapeResult).toMatchObject({
      width: 640,
      height: 400,
      isPortrait: false,
    });
    expect(portraitResult).toMatchObject({
      width: 384,
      height: 640,
      isPortrait: true,
    });
  });

  it("returns null for empty or undecodable bytes without throwing", async () => {
    const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});
    try {
      expect(await normalizeShareCardPlateImage(new Uint8Array())).toBeNull();
      expect(
        await normalizeShareCardPlateImage(
          new TextEncoder().encode("not an image"),
        ),
      ).toBeNull();
    } finally {
      warnSpy.mockRestore();
    }
  });
});

describe("fetchNormalizedShareCardPlate", () => {
  it("fetches with Curio Garden User-Agent and normalizes WebP into JPEG", async () => {
    const webpBytes = await createTestImage({
      width: 400,
      height: 540,
      format: "webp",
      color: { r: 30, g: 60, b: 90 },
    });
    const fetchMock = vi.fn<typeof fetch>().mockResolvedValue(
      new Response(Buffer.from(webpBytes), {
        status: 200,
        headers: { "content-type": "image/webp" },
      }),
    );

    const result = await fetchNormalizedShareCardPlate(
      "https://upload.wikimedia.org/wikipedia/commons/example.webp",
      { fetchImpl: fetchMock },
    );

    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [, init] = fetchMock.mock.calls[0] ?? [];
    const headers = new Headers(init?.headers);
    expect(headers.get("user-agent")).toBe(ARTWORK_IMAGE_USER_AGENT);
    expect(result).toMatchObject({
      width: 400,
      height: 540,
      isPortrait: true,
    });
    expect(
      result?.imageDataUrl.startsWith("data:image/jpeg;base64,"),
    ).toBe(true);
  });

  it("returns null on non-OK HTTP responses, SVG/HTML content types, or invalid URLs", async () => {
    const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});
    try {
      const notFoundFetch = vi
        .fn<typeof fetch>()
        .mockResolvedValue(new Response("missing", { status: 404 }));
      expect(
        await fetchNormalizedShareCardPlate(
          "https://upload.wikimedia.org/missing.jpg",
          { fetchImpl: notFoundFetch },
        ),
      ).toBeNull();

      const svgFetch = vi.fn<typeof fetch>().mockResolvedValue(
        new Response("<svg></svg>", {
          status: 200,
          headers: { "content-type": "image/svg+xml" },
        }),
      );
      expect(
        await fetchNormalizedShareCardPlate(
          "https://upload.wikimedia.org/flag.svg",
          { fetchImpl: svgFetch },
        ),
      ).toBeNull();

      expect(await fetchNormalizedShareCardPlate("not-a-url")).toBeNull();
      expect(
        await fetchNormalizedShareCardPlate("ftp://example.com/file.jpg"),
      ).toBeNull();
    } finally {
      warnSpy.mockRestore();
    }
  });
});

describe("renderOnThisDayShareCardJpeg", () => {
  it("renders valid 1200x630 baseline JPEGs for 5-plate, 3-plate, 1-plate, and 0-plate layouts", async () => {
    const samplePlates = await Promise.all([
      createSamplePlate({
        width: 480,
        height: 360,
        alt: "Apollo 11 lunar surface",
        yearLabel: "1969",
        color: { r: 22, g: 48, b: 78 },
      }),
      createSamplePlate({
        width: 460,
        height: 340,
        alt: "Wright Flyer at Kitty Hawk",
        yearLabel: "1903",
        color: { r: 138, g: 98, b: 64 },
      }),
      createSamplePlate({
        width: 320,
        height: 440,
        alt: "Albert Einstein portrait",
        yearLabel: "1921",
        color: { r: 62, g: 66, b: 92 },
      }),
      createSamplePlate({
        width: 460,
        height: 320,
        alt: "Ancient Mediterranean relief",
        yearLabel: "44 BCE",
        color: { r: 44, g: 92, b: 120 },
      }),
      createSamplePlate({
        width: 340,
        height: 440,
        alt: "Frederick Douglass portrait",
        yearLabel: "1879",
        color: { r: 78, g: 56, b: 42 },
      }),
    ]);

    const cases = [
      {
        label: "5-plate with long day name and BCE pill",
        options: {
          dayLabel: "September 28",
          subtitle: "54 events · 258 births · 127 deaths · 10 holidays",
          plates: samplePlates,
        },
      },
      {
        label: "4-plate adaptive layout",
        options: {
          dayLabel: "November 23",
          plates: samplePlates.slice(0, 4),
        },
      },
      {
        label: "3-plate adaptive layout",
        options: {
          dayLabel: "October 18",
          plates: samplePlates.slice(0, 3),
        },
      },
      {
        label: "2-plate adaptive layout",
        options: {
          dayLabel: "July 4",
          plates: samplePlates.slice(0, 2),
        },
      },
      {
        label: "1-plate portrait spotlight with BCE pill",
        options: {
          dayLabel: "March 15",
          plates: [{ ...samplePlates[2], yearLabel: "44 BCE" }],
        },
      },
      {
        label: "1-plate landscape spotlight",
        options: {
          dayLabel: "May 1",
          plates: [samplePlates[0]],
        },
      },
      {
        label: "0-plate timeline fallback",
        options: {
          dayLabel: "September 28",
          plates: [],
        },
      },
      {
        label: "omitted plates evergreen timeline fallback",
        options: {},
      },
    ];

    const outputs = new Map<string, Uint8Array>();

    for (const testCase of cases) {
      const jpegBytes = await renderOnThisDayShareCardJpeg(testCase.options);
      const metadata = await sharp(Buffer.from(jpegBytes)).metadata();

      expect(jpegBytes.byteLength).toBeGreaterThan(10_000);
      expect(metadata.format).toBe("jpeg");
      expect(metadata.width).toBe(ON_THIS_DAY_OG_SIZE.width);
      expect(metadata.height).toBe(ON_THIS_DAY_OG_SIZE.height);
      expect(metadata.isProgressive).toBe(false);
      expect(metadata.hasAlpha).toBe(false);

      outputs.set(testCase.label, jpegBytes);
    }

    // Confirm gallery layout produces a distinct render from the 0-plate timeline fallback.
    const galleryBytes = outputs.get("5-plate with long day name and BCE pill");
    const fallbackBytes = outputs.get("0-plate timeline fallback");
    expect(galleryBytes).toBeDefined();
    expect(fallbackBytes).toBeDefined();
    expect(
      Buffer.from(galleryBytes ?? []).equals(Buffer.from(fallbackBytes ?? [])),
    ).toBe(false);
  }, 30_000);
});
