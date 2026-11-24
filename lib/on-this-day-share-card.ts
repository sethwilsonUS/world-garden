import sharp from "sharp";
import {
  renderOnThisDayOgImage,
  type RenderOnThisDayOgImageOptions,
} from "@/app/(app)/on-this-day/og-card";
import {
  ARTWORK_IMAGE_TIMEOUT_MS,
  ARTWORK_IMAGE_USER_AGENT,
  MAX_ARTWORK_IMAGE_BYTES,
} from "@/lib/artwork-image";
import { convertArtworkToJpeg } from "@/lib/podcast-artwork-encode";

export const ON_THIS_DAY_SHARE_CARD_VERSION = 1 as const;
export const ON_THIS_DAY_SHARE_CARD_MIME_TYPE = "image/jpeg" as const;

const SHARE_CARD_BACKGROUND = "#07523f";
const SHARE_CARD_JPEG_QUALITY = 88;
const PLATE_MATTE_BACKGROUND = "#f7f2e7";
const PLATE_MAX_EDGE = 640;
const PLATE_JPEG_QUALITY = 86;
const SHARE_CARD_PLATE_ACCEPT =
  "image/jpeg, image/png, image/webp, image/gif, image/*;q=0.8";

export type NormalizedShareCardPlateImage = {
  imageDataUrl: string;
  width: number;
  height: number;
  isPortrait: boolean;
};

export type FetchNormalizedShareCardPlateOptions = {
  fetchImpl?: typeof fetch;
  timeoutMs?: number;
  maxBytes?: number;
  signal?: AbortSignal;
};

const normalizeHttpImageUrl = (value: string): string | null => {
  try {
    const parsed = new URL(value);
    if (parsed.protocol !== "https:" && parsed.protocol !== "http:") {
      return null;
    }
    return parsed.toString();
  } catch (error: unknown) {
    console.warn(
      "[on-this-day-share-card] Skipping malformed remote plate image URL:",
      error instanceof Error ? error.message : String(error),
    );
    return null;
  }
};

const cancelRejectedResponse = async (
  response: Response,
  controller: AbortController,
): Promise<void> => {
  try {
    await response.body?.cancel();
  } catch (error: unknown) {
    console.warn(
      "[on-this-day-share-card] Failed to cancel rejected plate image response:",
      error instanceof Error ? error.message : String(error),
    );
  }
  controller.abort();
};

const readBoundedBytes = async (
  response: Response,
  maxBytes: number,
  controller: AbortController,
): Promise<Uint8Array | null> => {
  if (!response.body) {
    const bytes = new Uint8Array(await response.arrayBuffer());
    if (bytes.byteLength === 0 || bytes.byteLength > maxBytes) {
      controller.abort();
      return null;
    }
    return bytes;
  }

  const reader = response.body.getReader();
  const chunks: Uint8Array[] = [];
  let totalBytes = 0;

  try {
    while (true) {
      const { value, done } = await reader.read();
      if (done) break;
      if (!value || value.byteLength === 0) continue;

      totalBytes += value.byteLength;
      if (totalBytes > maxBytes) {
        try {
          await reader.cancel();
        } catch (error: unknown) {
          console.warn(
            "[on-this-day-share-card] Failed to cancel oversized plate image stream:",
            error instanceof Error ? error.message : String(error),
          );
        }
        controller.abort();
        return null;
      }

      chunks.push(value);
    }
  } finally {
    reader.releaseLock();
  }

  if (totalBytes === 0) return null;
  const combined = new Uint8Array(totalBytes);
  let offset = 0;
  for (const chunk of chunks) {
    combined.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return combined;
};

/**
 * Normalizes arbitrary image bytes (PNG, WebP, TIFF, CMYK, oversized JPEG, EXIF-rotated)
 * into a Satori-safe baseline JPEG data URL bounded to 640×640.
 */
export async function normalizeShareCardPlateImage(
  rawBytes: Uint8Array,
): Promise<NormalizedShareCardPlateImage | null> {
  if (rawBytes.byteLength === 0) {
    return null;
  }

  try {
    const { data, info } = await sharp(Buffer.from(rawBytes))
      .rotate()
      .resize({
        width: PLATE_MAX_EDGE,
        height: PLATE_MAX_EDGE,
        fit: "inside",
        withoutEnlargement: true,
      })
      .flatten({ background: PLATE_MATTE_BACKGROUND })
      .jpeg({
        quality: PLATE_JPEG_QUALITY,
        mozjpeg: false,
        progressive: false,
      })
      .toBuffer({ resolveWithObject: true });

    if (data.byteLength === 0 || info.width <= 0 || info.height <= 0) {
      return null;
    }

    return {
      imageDataUrl: `data:${ON_THIS_DAY_SHARE_CARD_MIME_TYPE};base64,${data.toString("base64")}`,
      width: info.width,
      height: info.height,
      isPortrait: info.height > info.width,
    };
  } catch (error: unknown) {
    console.warn(
      "[on-this-day-share-card] Failed to normalize plate image:",
      error instanceof Error ? error.message : String(error),
    );
    return null;
  }
}

/**
 * Downloads a remote image with Curio Garden's User-Agent, bounded timeout, and
 * byte limit, then normalizes it into a Satori-safe JPEG data URL.
 */
export async function fetchNormalizedShareCardPlate(
  imageUrl: string,
  options: FetchNormalizedShareCardPlateOptions = {},
): Promise<NormalizedShareCardPlateImage | null> {
  const normalizedUrl = normalizeHttpImageUrl(imageUrl);
  if (!normalizedUrl) {
    return null;
  }

  const fetchImpl = options.fetchImpl ?? fetch;
  const timeoutMs = options.timeoutMs ?? ARTWORK_IMAGE_TIMEOUT_MS;
  const maxBytes = options.maxBytes ?? MAX_ARTWORK_IMAGE_BYTES;
  const controller = new AbortController();
  const requestSignal = options.signal
    ? AbortSignal.any([options.signal, controller.signal])
    : controller.signal;
  const timeout = setTimeout(() => controller.abort(), timeoutMs);

  try {
    const response = await fetchImpl(normalizedUrl, {
      cache: "no-store",
      headers: {
        "User-Agent": ARTWORK_IMAGE_USER_AGENT,
        Accept: SHARE_CARD_PLATE_ACCEPT,
      },
      signal: requestSignal,
    });

    if (!response.ok) {
      await cancelRejectedResponse(response, controller);
      return null;
    }

    const contentType = response.headers
      .get("content-type")
      ?.split(";")[0]
      ?.trim()
      .toLocaleLowerCase("en-US");
    if (
      !contentType ||
      !contentType.startsWith("image/") ||
      contentType === "image/svg+xml"
    ) {
      await cancelRejectedResponse(response, controller);
      return null;
    }

    const declaredLength = Number(response.headers.get("content-length"));
    if (Number.isFinite(declaredLength) && declaredLength > maxBytes) {
      await cancelRejectedResponse(response, controller);
      return null;
    }

    const rawBytes = await readBoundedBytes(response, maxBytes, controller);
    if (!rawBytes) {
      return null;
    }

    return await normalizeShareCardPlateImage(rawBytes);
  } catch (error: unknown) {
    if (options.signal?.aborted) {
      throw error;
    }
    console.warn(
      "[on-this-day-share-card] Failed to fetch remote plate image:",
      error instanceof Error ? error.message : String(error),
    );
    return null;
  } finally {
    clearTimeout(timeout);
  }
}

/**
 * Renders the 1200×630 On This Day Share Card via Satori and encodes it
 * as a 4:4:4 baseline JPEG suitable for OpenGraph / Twitter / Convex storage.
 */
export async function renderOnThisDayShareCardJpeg(
  options: RenderOnThisDayOgImageOptions = {},
): Promise<Uint8Array> {
  const response = await renderOnThisDayOgImage(options);
  const pngBytes = new Uint8Array(await response.arrayBuffer());

  return await convertArtworkToJpeg({
    data: pngBytes,
    background: SHARE_CARD_BACKGROUND,
    quality: SHARE_CARD_JPEG_QUALITY,
  });
}
