export type WikimediaMediaAttribution = {
  creator?: string;
  credit?: string;
  licenseName?: string;
  licenseUrl?: string;
  sourceTitle?: string;
  sourceUrl?: string;
};

type ImageInfoMetadataValue = { value?: string };

type ImageInfo = {
  descriptionurl?: string;
  extmetadata?: Record<string, ImageInfoMetadataValue>;
  url?: string;
  width?: number;
  height?: number;
  thumburl?: string;
  thumbwidth?: number;
  thumbheight?: number;
  mime?: string;
};

type ImageInfoPage = {
  title?: string;
  imagerepository?: string;
  imageinfo?: ImageInfo[];
};

const WIKIMEDIA_COMMONS_HOST = "commons.wikimedia.org";
const WIKIMEDIA_COMMONS_ACTION_API =
  `https://${WIKIMEDIA_COMMONS_HOST}/w/api.php`;
const WIKIMEDIA_ENGLISH_WIKIPEDIA_HOST = "en.wikipedia.org";
const WIKIMEDIA_ENGLISH_WIKIPEDIA_ACTION_API =
  `https://${WIKIMEDIA_ENGLISH_WIKIPEDIA_HOST}/w/api.php`;
const USER_AGENT =
  "CurioGarden/1.0 (https://curiogarden.org; accessibility-first Wikipedia audio reader)";
const IMAGE_INFO_BATCH_SIZE = 20;
const LIGHTBOX_RENDITION_WIDTH = 1_600;
const DEFAULT_RETRY_DELAY_MS = 250;
const MAX_RETRY_DELAY_MS = 5_000;
export const WIKIMEDIA_MEDIA_TIMEOUT_MS = 8_000;

export type WikimediaMediaRepository = "commons" | "enwiki";

export type WikimediaMediaRequest = {
  sourceTitle: string;
  imageUrl: string;
};

export type WikimediaMediaDetails = {
  repository: WikimediaMediaRepository;
  attribution: WikimediaMediaAttribution;
  originalSrc?: string;
  lightboxSrc?: string;
  lightboxWidth?: number;
  lightboxHeight?: number;
};

const decodeHtml = (value: string): string =>
  value
    .replace(/<[^>]*>/g, " ")
    .replace(/&quot;/g, '"')
    .replace(/&#0?39;|&apos;/g, "'")
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&#x([0-9a-f]+);/gi, (_, hex) =>
      String.fromCodePoint(Number.parseInt(hex, 16)),
    )
    .replace(/&#(\d+);/g, (_, decimal) =>
      String.fromCodePoint(Number.parseInt(decimal, 10)),
    )
    .replace(/\s+/g, " ")
    .trim();

const metadataText = (
  metadata: Record<string, ImageInfoMetadataValue> | undefined,
  key: string,
): string | undefined => {
  const value = metadata?.[key]?.value;
  if (!value) return undefined;
  return decodeHtml(value) || undefined;
};

export const getWikimediaFileTitleFromUrl = (
  imageUrl: string | undefined,
): string | undefined => {
  if (!imageUrl) return undefined;

  try {
    const pathname = new URL(imageUrl, "https://upload.wikimedia.org").pathname;
    const segments = pathname.split("/").filter(Boolean);
    const thumbIndex = segments.indexOf("thumb");
    const filename =
      thumbIndex >= 0 ? segments[thumbIndex + 3] : segments.at(-1);
    if (!filename) return undefined;
    return `File:${decodeURIComponent(filename).replace(/_/g, " ")}`;
  } catch {
    return undefined;
  }
};

export const buildWikimediaSourceFallback = (
  sourceTitle: string,
  projectHost = WIKIMEDIA_COMMONS_HOST,
): WikimediaMediaAttribution => ({
  sourceTitle,
  sourceUrl: `https://${projectHost}/wiki/${encodeURIComponent(
    sourceTitle.replace(/ /g, "_"),
  )}`,
});

export const getWikimediaMediaRepositoryFromUrl = (
  imageUrl: string,
): WikimediaMediaRepository => {
  try {
    const pathname = new URL(
      imageUrl,
      "https://upload.wikimedia.org",
    ).pathname;
    return pathname.startsWith("/wikipedia/en/") ? "enwiki" : "commons";
  } catch {
    return "commons";
  }
};

const projectHostForRepository = (
  repository: WikimediaMediaRepository,
): string =>
  repository === "enwiki"
    ? WIKIMEDIA_ENGLISH_WIKIPEDIA_HOST
    : WIKIMEDIA_COMMONS_HOST;

const actionApiForRepository = (
  repository: WikimediaMediaRepository,
): string =>
  repository === "enwiki"
    ? WIKIMEDIA_ENGLISH_WIKIPEDIA_ACTION_API
    : WIKIMEDIA_COMMONS_ACTION_API;

const normalizeSourceTitle = (sourceTitle: string): string => {
  const normalized = sourceTitle.replace(/_/g, " ").trim();
  const separator = normalized.indexOf(":");
  if (separator < 0) return normalized;
  const namespace = normalized.slice(0, separator).toLocaleLowerCase("en-US");
  const filename = normalized.slice(separator + 1);
  const initial = filename.charAt(0).toLocaleUpperCase("en-US");
  return `${namespace}:${initial}${filename.slice(1)}`;
};

const normalizeHttpUrl = (value: string | undefined): string | undefined => {
  if (!value) return undefined;
  const normalized = value.startsWith("//") ? `https:${value}` : value;
  try {
    const url = new URL(normalized);
    return url.protocol === "https:" || url.protocol === "http:"
      ? url.toString()
      : undefined;
  } catch {
    return undefined;
  }
};

const positiveDimension = (value: number | undefined): number | undefined =>
  typeof value === "number" && Number.isFinite(value) && value > 0
    ? value
    : undefined;

const retryDelayMs = (response: Response): number | undefined => {
  const retryAfter = response.headers.get("Retry-After")?.trim();
  if (!retryAfter) return DEFAULT_RETRY_DELAY_MS;

  const seconds = Number(retryAfter);
  if (Number.isFinite(seconds) && seconds >= 0) {
    const delay = seconds * 1_000;
    return delay <= MAX_RETRY_DELAY_MS ? delay : undefined;
  }

  const retryAt = Date.parse(retryAfter);
  if (Number.isNaN(retryAt)) return DEFAULT_RETRY_DELAY_MS;
  const delay = Math.max(0, retryAt - Date.now());
  return delay <= MAX_RETRY_DELAY_MS ? delay : undefined;
};

const fetchWithTimeout = async (
  url: string,
  fetchImpl: typeof fetch,
): Promise<Response> => {
  const controller = new AbortController();
  const timeout = setTimeout(
    () => controller.abort(),
    WIKIMEDIA_MEDIA_TIMEOUT_MS,
  );
  try {
    return await fetchImpl(url, {
      headers: { "User-Agent": USER_AGENT },
      signal: controller.signal,
    });
  } finally {
    clearTimeout(timeout);
  }
};

const fetchImageInfoBatch = async (
  actionApi: string,
  sourceTitles: string[],
  fetchImpl: typeof fetch,
  options: { includeRendition: boolean },
): Promise<ImageInfoPage[]> => {
  const params = new URLSearchParams({
    action: "query",
    format: "json",
    prop: "imageinfo",
    iiprop: options.includeRendition
      ? "url|size|mime|extmetadata"
      : "url|extmetadata",
    titles: sourceTitles.join("|"),
    origin: "*",
  });
  if (options.includeRendition) {
    params.set("iiurlwidth", String(LIGHTBOX_RENDITION_WIDTH));
  }

  const url = `${actionApi}?${params}`;
  try {
    let response = await fetchWithTimeout(url, fetchImpl);
    if (response.status === 429 || response.status === 503) {
      const delay = retryDelayMs(response);
      if (delay !== undefined) {
        await new Promise<void>((resolve) => setTimeout(resolve, delay));
        response = await fetchWithTimeout(url, fetchImpl);
      }
    }
    if (!response.ok) return [];

    const payload = (await response.json()) as {
      query?: { pages?: unknown };
    };
    const pages = payload.query?.pages;
    if (!pages || typeof pages !== "object") return [];
    return Object.values(pages).filter(
      (page): page is ImageInfoPage =>
        Boolean(page) && typeof page === "object",
    );
  } catch {
    return [];
  }
};

const attributionFromImageInfo = (
  sourceTitle: string,
  info: ImageInfo | undefined,
  projectHost: string,
): WikimediaMediaAttribution => {
  const metadata = info?.extmetadata;
  return {
    creator: metadataText(metadata, "Artist"),
    credit: metadataText(metadata, "Credit"),
    licenseName:
      metadataText(metadata, "LicenseShortName") ??
      metadataText(metadata, "UsageTerms"),
    licenseUrl: metadataText(metadata, "LicenseUrl"),
    sourceTitle,
    sourceUrl:
      normalizeHttpUrl(info?.descriptionurl) ??
      buildWikimediaSourceFallback(sourceTitle, projectHost).sourceUrl,
  };
};

export const fetchWikimediaMediaAttributions = async (
  sourceTitles: string[],
  fetchImpl: typeof fetch = fetch,
): Promise<Map<string, WikimediaMediaAttribution>> => {
  const uniqueTitles = [...new Set(sourceTitles.filter(Boolean))];
  const results = new Map<string, WikimediaMediaAttribution>();

  for (const title of uniqueTitles) {
    results.set(title, buildWikimediaSourceFallback(title));
  }

  for (let index = 0; index < uniqueTitles.length; index += IMAGE_INFO_BATCH_SIZE) {
    const batch = uniqueTitles.slice(index, index + IMAGE_INFO_BATCH_SIZE);
    const pages = await fetchImageInfoBatch(
      WIKIMEDIA_COMMONS_ACTION_API,
      batch,
      fetchImpl,
      { includeRendition: false },
    );

    const requestedTitles = new Map(
      batch.map((title) => [normalizeSourceTitle(title), title]),
    );
    for (const page of pages) {
      const sourceTitle = page.title;
      if (typeof sourceTitle !== "string" || !sourceTitle) continue;
      const requestedTitle = requestedTitles.get(
        normalizeSourceTitle(sourceTitle),
      );
      if (!requestedTitle) continue;
      results.set(
        requestedTitle,
        attributionFromImageInfo(
          sourceTitle,
          page.imageinfo?.[0],
          WIKIMEDIA_COMMONS_HOST,
        ),
      );
    }
  }

  return results;
};

/**
 * Resolve canonical originals, a Wikimedia-generated 1600px rendition, and
 * attribution for article-gallery media. Requests are grouped by repository
 * because English Wikipedia's local (often non-free) files are not available
 * from the Commons API.
 */
export const fetchWikimediaMediaDetails = async (
  requests: WikimediaMediaRequest[],
  fetchImpl: typeof fetch = fetch,
): Promise<Map<string, WikimediaMediaDetails>> => {
  type RequestedMedia = {
    sourceTitle: string;
    imageUrls: Set<string>;
  };

  const results = new Map<string, WikimediaMediaDetails>();
  const grouped = new Map<
    WikimediaMediaRepository,
    Map<string, RequestedMedia>
  >([
    ["commons", new Map()],
    ["enwiki", new Map()],
  ]);

  for (const request of requests) {
    if (!request.sourceTitle || !request.imageUrl) continue;
    const repository = getWikimediaMediaRepositoryFromUrl(request.imageUrl);
    const projectHost = projectHostForRepository(repository);
    results.set(request.imageUrl, {
      repository,
      attribution: buildWikimediaSourceFallback(
        request.sourceTitle,
        projectHost,
      ),
    });

    const key = normalizeSourceTitle(request.sourceTitle);
    const repositoryGroup = grouped.get(repository)!;
    const existing = repositoryGroup.get(key);
    if (existing) {
      existing.imageUrls.add(request.imageUrl);
    } else {
      repositoryGroup.set(key, {
        sourceTitle: request.sourceTitle,
        imageUrls: new Set([request.imageUrl]),
      });
    }
  }

  for (const repository of ["commons", "enwiki"] as const) {
    const repositoryGroup = grouped.get(repository)!;
    const media = [...repositoryGroup.values()];
    for (let index = 0; index < media.length; index += IMAGE_INFO_BATCH_SIZE) {
      const batch = media.slice(index, index + IMAGE_INFO_BATCH_SIZE);
      const pages = await fetchImageInfoBatch(
        actionApiForRepository(repository),
        batch.map((item) => item.sourceTitle),
        fetchImpl,
        { includeRendition: true },
      );

      for (const page of pages) {
        if (typeof page.title !== "string" || !page.title) continue;
        const requested = repositoryGroup.get(
          normalizeSourceTitle(page.title),
        );
        if (!requested) continue;

        const info = page.imageinfo?.[0];
        if (!info) continue;
        const projectHost = projectHostForRepository(repository);
        const attribution = attributionFromImageInfo(
          page.title,
          info,
          projectHost,
        );
        const originalSrc = normalizeHttpUrl(info.url);
        const originalWidth = positiveDimension(info.width);
        const originalHeight = positiveDimension(info.height);
        const thumbSrc = normalizeHttpUrl(info.thumburl);
        const thumbWidth = positiveDimension(info.thumbwidth);
        const thumbHeight = positiveDimension(info.thumbheight);

        let lightboxSrc: string | undefined;
        let lightboxWidth: number | undefined;
        let lightboxHeight: number | undefined;

        const completeOriginal =
          originalSrc && originalWidth && originalHeight
            ? {
                src: originalSrc,
                width: originalWidth,
                height: originalHeight,
              }
            : undefined;
        const completeThumb =
          thumbSrc && thumbWidth && thumbHeight
            ? { src: thumbSrc, width: thumbWidth, height: thumbHeight }
            : undefined;

        // Local English-Wikipedia media can be non-free. Use its native file
        // exactly as supplied instead of selecting a generated enlargement.
        const rendition =
          repository === "enwiki"
            ? completeOriginal
            : completeThumb &&
                (!completeOriginal ||
                  (completeThumb.width <= completeOriginal.width &&
                    completeThumb.height <= completeOriginal.height))
              ? completeThumb
              : completeOriginal;
        if (rendition) {
          lightboxSrc = rendition.src;
          lightboxWidth = rendition.width;
          lightboxHeight = rendition.height;
        }

        for (const imageUrl of requested.imageUrls) {
          results.set(imageUrl, {
            repository,
            attribution,
            ...(originalSrc ? { originalSrc } : {}),
            ...(lightboxSrc && lightboxWidth && lightboxHeight
              ? { lightboxSrc, lightboxWidth, lightboxHeight }
              : {}),
          });
        }
      }
    }
  }

  return results;
};

export const getAttributionForImageUrl = async (
  imageUrl: string | undefined,
  fetchImpl: typeof fetch = fetch,
): Promise<WikimediaMediaAttribution | undefined> => {
  const title = getWikimediaFileTitleFromUrl(imageUrl);
  if (!title) return undefined;
  const attributions = await fetchWikimediaMediaAttributions([title], fetchImpl);
  return attributions.get(title) ?? buildWikimediaSourceFallback(title);
};
