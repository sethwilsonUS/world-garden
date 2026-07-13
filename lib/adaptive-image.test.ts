// @vitest-environment jsdom

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  ADAPTIVE_IMAGE_MIN_CROP_RETENTION,
  analyzeAdaptiveImage,
  getCropRetention,
  resetAdaptiveImageAnalysisCacheForTests,
  resolveAdaptiveImagePresentation,
} from "./adaptive-image";

const originalImage = window.Image;

const installImageClass = ({
  width = 4,
  height = 1,
  fail = false,
  onConstruct,
}: {
  width?: number;
  height?: number;
  fail?: boolean;
  onConstruct?: () => void;
}) => {
  class TestImage {
    onload: (() => void) | null = null;
    onerror: (() => void) | null = null;
    crossOrigin: string | null = null;
    decoding = "auto";
    naturalWidth = width;
    naturalHeight = height;
    width = width;
    height = height;

    constructor() {
      onConstruct?.();
    }

    set src(_value: string) {
      queueMicrotask(() => {
        if (fail) this.onerror?.();
        else this.onload?.();
      });
    }
  }

  Object.defineProperty(window, "Image", {
    configurable: true,
    value: TestImage as unknown as typeof window.Image,
  });
};

beforeEach(() => resetAdaptiveImageAnalysisCacheForTests());

afterEach(() => {
  resetAdaptiveImageAnalysisCacheForTests();
  vi.restoreAllMocks();
  Object.defineProperty(window, "Image", {
    configurable: true,
    value: originalImage,
  });
});

describe("adaptive image fit", () => {
  it("uses cover for matching landscape images and the inclusive crop threshold", () => {
    expect(getCropRetention(1600, 900, 320, 180)).toBe(1);
    expect(getCropRetention(1200, 900, 320, 180)).toBeCloseTo(0.75);

    expect(
      resolveAdaptiveImagePresentation({
        sourceWidth: 72,
        sourceHeight: 100,
        frameWidth: 100,
        frameHeight: 100,
        minCropRetention: ADAPTIVE_IMAGE_MIN_CROP_RETENTION,
      }),
    ).toMatchObject({ mode: "backdrop", reason: "portrait" });

    expect(
      resolveAdaptiveImagePresentation({
        sourceWidth: 100,
        sourceHeight: 72,
        frameWidth: 100,
        frameHeight: 100,
      }),
    ).toMatchObject({
      mode: "cover",
      reason: "cover",
      cropRetention: ADAPTIVE_IMAGE_MIN_CROP_RETENTION,
    });
  });

  it.each([
    {
      name: "portrait",
      input: { sourceWidth: 900, sourceHeight: 1200 },
      reason: "portrait",
    },
    {
      name: "square in a landscape frame",
      input: { sourceWidth: 1000, sourceHeight: 1000 },
      reason: "crop",
    },
    {
      name: "panoramic",
      input: { sourceWidth: 3000, sourceHeight: 700 },
      reason: "crop",
    },
  ])("uses a backdrop for $name media", ({ input, reason }) => {
    expect(
      resolveAdaptiveImagePresentation({
        ...input,
        frameWidth: 1600,
        frameHeight: 900,
      }),
    ).toMatchObject({ mode: "backdrop", reason });
  });

  it("keeps a square image full-bleed in a square frame", () => {
    expect(
      resolveAdaptiveImagePresentation({
        sourceWidth: 1000,
        sourceHeight: 1000,
        frameWidth: 400,
        frameHeight: 400,
      }),
    ).toEqual({ mode: "cover", reason: "cover", cropRetention: 1 });
  });

  it("prioritizes transparency and safely covers when dimensions are missing", () => {
    expect(
      resolveAdaptiveImagePresentation({
        sourceWidth: 1600,
        sourceHeight: 900,
        frameWidth: 1600,
        frameHeight: 900,
        hasTransparency: true,
      }),
    ).toMatchObject({ mode: "backdrop", reason: "transparent" });

    expect(resolveAdaptiveImagePresentation({})).toEqual({
      mode: "cover",
      reason: "missing-dimensions",
      cropRetention: null,
    });
    expect(getCropRetention(0, 900, 1600, 900)).toBeNull();
  });
});

describe("adaptive image appearance analysis", () => {
  it("detects transparency, derives a color panel, and caches by URL", async () => {
    let imageConstructions = 0;
    installImageClass({ onConstruct: () => imageConstructions++ });
    vi.spyOn(HTMLCanvasElement.prototype, "getContext").mockReturnValue({
      drawImage: vi.fn(),
      getImageData: vi.fn(() => ({
        data: new Uint8ClampedArray([
          0, 0, 0, 0,
          240, 240, 240, 255,
          240, 240, 240, 255,
          240, 240, 240, 255,
        ]),
      })),
    } as never);

    const first = analyzeAdaptiveImage("https://upload.wikimedia.org/logo.png");
    const second = analyzeAdaptiveImage("https://upload.wikimedia.org/logo.png");

    expect(second).toBe(first);
    await expect(first).resolves.toMatchObject({
      url: "https://upload.wikimedia.org/logo.png",
      hasTransparency: true,
      panelBorderColor: "rgba(255, 255, 255, 0.12)",
    });
    expect(imageConstructions).toBe(1);
  });

  it("falls back without rejecting when canvas pixels are unavailable", async () => {
    installImageClass({});
    vi.spyOn(HTMLCanvasElement.prototype, "getContext").mockReturnValue({
      drawImage: vi.fn(),
      getImageData: vi.fn(() => {
        throw new DOMException("Blocked by CORS", "SecurityError");
      }),
    } as never);

    await expect(
      analyzeAdaptiveImage("https://example.com/cross-origin.jpg"),
    ).resolves.toEqual({
      url: "https://example.com/cross-origin.jpg",
      hasTransparency: false,
    });
  });

  it("falls back without rejecting when the image cannot load", async () => {
    installImageClass({ fail: true });

    await expect(
      analyzeAdaptiveImage("https://example.com/missing.jpg"),
    ).resolves.toEqual({
      url: "https://example.com/missing.jpg",
      hasTransparency: false,
    });
  });
});
