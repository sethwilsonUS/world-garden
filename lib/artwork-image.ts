export const ARTWORK_IMAGE_USER_AGENT =
  "CurioGarden/1.0 (https://curiogarden.org; accessibility-first Wikipedia audio reader)";
export const ARTWORK_IMAGE_TIMEOUT_MS = 8_000;

const MAX_ARTWORK_IMAGE_BYTES = 15 * 1024 * 1024;
const ARTWORK_IMAGE_ACCEPT =
  "image/png, image/jpeg, image/gif, image/webp, image/*;q=0.8";

export type FetchArtworkImageOptions = {
  fetchImpl?: typeof fetch;
  timeoutMs?: number;
  signal?: AbortSignal;
};

const toBase64 = (bytes: Uint8Array): string =>
  Buffer.from(bytes).toString("base64");

const normalizeHttpImageUrl = (value: string): string | null => {
  try {
    const parsed = new URL(value);
    if (parsed.protocol !== "https:" && parsed.protocol !== "http:") {
      return null;
    }
    return parsed.toString();
  } catch (error: unknown) {
    console.warn(
      "[artwork] Skipping malformed remote image URL:",
      error instanceof Error ? error.message : String(error),
    );
    return null;
  }
};

/**
 * Fetch a remote image server-side with Curio Garden's descriptive User-Agent
 * and a bounded timeout, returning a data URL suitable for `ImageResponse`.
 */
export const fetchArtworkImageDataUrl = async (
  url: string,
  options: FetchArtworkImageOptions = {},
): Promise<string | null> => {
  const normalizedUrl = normalizeHttpImageUrl(url);
  if (!normalizedUrl) return null;

  const fetchImpl = options.fetchImpl ?? fetch;
  const timeoutMs = options.timeoutMs ?? ARTWORK_IMAGE_TIMEOUT_MS;
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
        Accept: ARTWORK_IMAGE_ACCEPT,
      },
      signal: requestSignal,
    });
    if (!response.ok) return null;

    const contentType = response.headers
      .get("content-type")
      ?.split(";")[0]
      ?.trim()
      .toLocaleLowerCase("en-US");
    if (!contentType?.startsWith("image/")) return null;

    const declaredLength = Number(response.headers.get("content-length"));
    if (
      Number.isFinite(declaredLength) &&
      declaredLength > MAX_ARTWORK_IMAGE_BYTES
    ) {
      return null;
    }

    const bytes = new Uint8Array(await response.arrayBuffer());
    if (bytes.length === 0 || bytes.length > MAX_ARTWORK_IMAGE_BYTES) {
      return null;
    }

    return `data:${contentType};base64,${toBase64(bytes)}`;
  } catch (error: unknown) {
    if (options.signal?.aborted) throw error;
    console.warn(
      "[artwork] Failed to fetch remote image:",
      error instanceof Error ? error.message : String(error),
    );
    return null;
  } finally {
    clearTimeout(timeout);
  }
};
