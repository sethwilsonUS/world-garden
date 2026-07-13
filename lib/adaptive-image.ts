// Editorial photography should read as a cover image. Only fall back to the
// complete-image treatment when cover would discard nearly all of the source.
export const ADAPTIVE_IMAGE_MIN_CROP_RETENTION = 0.25;
export const DEFAULT_ADAPTIVE_FRAME_ASPECT_RATIO = 16 / 9;

const EXTREME_SOURCE_ASPECT_RATIO = 3;
const EXTREME_SOURCE_MIN_CROP_RETENTION = 0.72;

const TRANSPARENCY_SAMPLE_SIZE = 64;
const TRANSPARENCY_ALPHA_THRESHOLD = 245;
const TRANSPARENCY_MIN_RATIO = 0.08;
const VISIBLE_PIXEL_ALPHA_THRESHOLD = 24;
const DARK_SURFACE_TOP: RgbColor = [56, 64, 64];
const DARK_SURFACE_BOTTOM: RgbColor = [34, 40, 42];
const LIGHT_SURFACE_TOP: RgbColor = [238, 235, 226];
const LIGHT_SURFACE_BOTTOM: RgbColor = [220, 224, 216];

type RgbColor = [number, number, number];

export type AdaptiveImageAnalysis = {
  url: string;
  hasTransparency: boolean;
  panelBackground?: string;
  panelBorderColor?: string;
};

export type AdaptiveImageMode = "cover" | "backdrop";

export type AdaptiveImagePresentationReason =
  | "cover"
  | "crop"
  | "extreme-aspect"
  | "missing-dimensions"
  | "transparent";

export type AdaptiveImagePresentation = {
  mode: AdaptiveImageMode;
  reason: AdaptiveImagePresentationReason;
  cropRetention: number | null;
};

type AdaptiveImagePresentationInput = {
  sourceWidth?: number;
  sourceHeight?: number;
  frameWidth?: number;
  frameHeight?: number;
  fallbackFrameAspectRatio?: number;
  hasTransparency?: boolean;
  minCropRetention?: number;
};

const analysisCache = new Map<string, Promise<AdaptiveImageAnalysis>>();

class RetryableAdaptiveImageAnalysisError extends Error {
  constructor(message: string, options?: ErrorOptions) {
    super(message, options);
    this.name = "RetryableAdaptiveImageAnalysisError";
  }
}

const isPositiveDimension = (value: number | undefined): value is number =>
  typeof value === "number" && Number.isFinite(value) && value > 0;

const clamp = (value: number, min: number, max: number): number =>
  Math.min(max, Math.max(min, value));

const mixChannel = (a: number, b: number, amount: number): number =>
  Math.round(a * (1 - amount) + b * amount);

const mixRgb = (
  color: RgbColor,
  target: RgbColor,
  amount: number,
): RgbColor => [
  mixChannel(color[0], target[0], amount),
  mixChannel(color[1], target[1], amount),
  mixChannel(color[2], target[2], amount),
];

const rgbToCss = ([r, g, b]: RgbColor, alpha = 1): string =>
  `rgba(${r}, ${g}, ${b}, ${alpha})`;

const toLinearSrgb = (channel: number): number => {
  const value = channel / 255;
  return value <= 0.04045
    ? value / 12.92
    : Math.pow((value + 0.055) / 1.055, 2.4);
};

const getRelativeLuminance = ([r, g, b]: RgbColor): number =>
  0.2126 * toLinearSrgb(r) +
  0.7152 * toLinearSrgb(g) +
  0.0722 * toLinearSrgb(b);

export const buildTransparentImagePanel = (
  averageColor: RgbColor,
): Pick<AdaptiveImageAnalysis, "panelBackground" | "panelBorderColor"> => {
  const luminance = getRelativeLuminance(averageColor);

  if (luminance > 0.58) {
    const top = mixRgb(averageColor, DARK_SURFACE_TOP, 0.8);
    const bottom = mixRgb(averageColor, DARK_SURFACE_BOTTOM, 0.88);
    return {
      panelBackground: `linear-gradient(180deg, ${rgbToCss(top, 0.98)}, ${rgbToCss(bottom, 0.94)})`,
      panelBorderColor: "rgba(255, 255, 255, 0.12)",
    };
  }

  const top = mixRgb(averageColor, LIGHT_SURFACE_TOP, 0.88);
  const bottom = mixRgb(averageColor, LIGHT_SURFACE_BOTTOM, 0.78);
  return {
    panelBackground: `linear-gradient(180deg, ${rgbToCss(top, 0.98)}, ${rgbToCss(bottom, 0.92)})`,
    panelBorderColor: "rgba(32, 40, 38, 0.12)",
  };
};

/**
 * Returns the fraction of the source image that remains visible with
 * `object-fit: cover`, or null when either rectangle is not measurable.
 */
export const getCropRetention = (
  sourceWidth: number | undefined,
  sourceHeight: number | undefined,
  frameWidth: number | undefined,
  frameHeight: number | undefined,
): number | null => {
  if (
    !isPositiveDimension(sourceWidth) ||
    !isPositiveDimension(sourceHeight) ||
    !isPositiveDimension(frameWidth) ||
    !isPositiveDimension(frameHeight)
  ) {
    return null;
  }

  const sourceAspectRatio = sourceWidth / sourceHeight;
  const frameAspectRatio = frameWidth / frameHeight;
  return Math.min(
    sourceAspectRatio / frameAspectRatio,
    frameAspectRatio / sourceAspectRatio,
  );
};

export const resolveAdaptiveImagePresentation = ({
  sourceWidth,
  sourceHeight,
  frameWidth,
  frameHeight,
  fallbackFrameAspectRatio = DEFAULT_ADAPTIVE_FRAME_ASPECT_RATIO,
  hasTransparency = false,
  minCropRetention = ADAPTIVE_IMAGE_MIN_CROP_RETENTION,
}: AdaptiveImagePresentationInput): AdaptiveImagePresentation => {
  const hasSourceDimensions =
    isPositiveDimension(sourceWidth) && isPositiveDimension(sourceHeight);

  const measuredCropRetention = getCropRetention(
    sourceWidth,
    sourceHeight,
    frameWidth,
    frameHeight,
  );
  const fallbackCropRetention =
    measuredCropRetention === null &&
    hasSourceDimensions &&
    isPositiveDimension(fallbackFrameAspectRatio)
      ? getCropRetention(
          sourceWidth,
          sourceHeight,
          fallbackFrameAspectRatio,
          1,
        )
      : null;
  const cropRetention = measuredCropRetention ?? fallbackCropRetention;

  if (hasTransparency) {
    return { mode: "backdrop", reason: "transparent", cropRetention };
  }

  if (hasSourceDimensions && cropRetention !== null) {
    const sourceAspectRatio = sourceWidth / sourceHeight;
    const hasExtremeSourceAspect =
      sourceAspectRatio <= 1 / EXTREME_SOURCE_ASPECT_RATIO ||
      sourceAspectRatio >= EXTREME_SOURCE_ASPECT_RATIO;

    if (
      hasExtremeSourceAspect &&
      cropRetention < EXTREME_SOURCE_MIN_CROP_RETENTION
    ) {
      return { mode: "backdrop", reason: "extreme-aspect", cropRetention };
    }
  }

  if (cropRetention !== null && cropRetention < minCropRetention) {
    return { mode: "backdrop", reason: "crop", cropRetention };
  }

  if (cropRetention === null) {
    return {
      mode: "cover",
      reason: "missing-dimensions",
      cropRetention: null,
    };
  }

  return { mode: "cover", reason: "cover", cropRetention };
};

const fallbackAnalysis = (url: string): AdaptiveImageAnalysis => ({
  url,
  hasTransparency: false,
});

const analyzeImageWithoutCache = async (
  url: string,
): Promise<AdaptiveImageAnalysis> => {
  if (typeof window === "undefined" || typeof document === "undefined") {
    return fallbackAnalysis(url);
  }

  const image = new window.Image();
  image.crossOrigin = "anonymous";
  image.decoding = "async";

  await new Promise<void>((resolve, reject) => {
    image.onload = () => resolve();
    image.onerror = () =>
      reject(
        new RetryableAdaptiveImageAnalysisError(
          "Adaptive image appearance analysis failed",
        ),
      );
    image.src = url;
  });

  const width = image.naturalWidth || image.width;
  const height = image.naturalHeight || image.height;
  if (!width || !height) return fallbackAnalysis(url);

  const scale = Math.min(
    1,
    TRANSPARENCY_SAMPLE_SIZE / Math.max(width, height),
  );
  const canvas = document.createElement("canvas");
  canvas.width = Math.max(1, Math.round(width * scale));
  canvas.height = Math.max(1, Math.round(height * scale));

  const context = canvas.getContext("2d", { willReadFrequently: true });
  if (!context) return fallbackAnalysis(url);

  let data: Uint8ClampedArray;
  try {
    context.drawImage(image, 0, 0, canvas.width, canvas.height);
    data = context.getImageData(
      0,
      0,
      canvas.width,
      canvas.height,
    ).data;
  } catch (error) {
    if (error instanceof DOMException && error.name === "SecurityError") {
      throw new RetryableAdaptiveImageAnalysisError(
        "Adaptive image pixels are temporarily unavailable",
        { cause: error },
      );
    }
    throw error;
  }

  let transparentPixels = 0;
  const totalPixels = data.length / 4;
  let visiblePixels = 0;
  let redTotal = 0;
  let greenTotal = 0;
  let blueTotal = 0;
  let alphaWeightTotal = 0;

  for (let index = 0; index < data.length; index += 4) {
    const alpha = data[index + 3];
    if (alpha < TRANSPARENCY_ALPHA_THRESHOLD) transparentPixels += 1;
    if (alpha <= VISIBLE_PIXEL_ALPHA_THRESHOLD) continue;

    const weight = alpha / 255;
    redTotal += data[index] * weight;
    greenTotal += data[index + 1] * weight;
    blueTotal += data[index + 2] * weight;
    alphaWeightTotal += weight;
    visiblePixels += 1;
  }

  if (totalPixels === 0) return fallbackAnalysis(url);

  const hasTransparency =
    transparentPixels / totalPixels >= TRANSPARENCY_MIN_RATIO;
  if (!hasTransparency || visiblePixels === 0 || alphaWeightTotal === 0) {
    return { url, hasTransparency };
  }

  const averageColor: RgbColor = [
    clamp(Math.round(redTotal / alphaWeightTotal), 0, 255),
    clamp(Math.round(greenTotal / alphaWeightTotal), 0, 255),
    clamp(Math.round(blueTotal / alphaWeightTotal), 0, 255),
  ];

  return {
    url,
    hasTransparency,
    ...buildTransparentImagePanel(averageColor),
  };
};

export const analyzeAdaptiveImage = (
  url: string,
): Promise<AdaptiveImageAnalysis> => {
  const cached = analysisCache.get(url);
  if (cached) return cached;

  const analysis = analyzeImageWithoutCache(url).catch((error: unknown) => {
    // A failed request or a temporary CORS denial may succeed later. Remove
    // only this failed attempt after it has been installed in the cache so
    // concurrent callers still share it and the next call can retry.
    if (
      error instanceof RetryableAdaptiveImageAnalysisError &&
      analysisCache.get(url) === analysis
    ) {
      analysisCache.delete(url);
    }

    // Appearance analysis is opportunistic. Unsupported or unexpected
    // failures retain the safe fallback in the cache rather than retrying on
    // every render.
    return fallbackAnalysis(url);
  });
  analysisCache.set(url, analysis);
  return analysis;
};

export const resetAdaptiveImageAnalysisCacheForTests = (): void => {
  analysisCache.clear();
};
