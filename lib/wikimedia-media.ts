import {
  extractActionApiPages,
  fetchWikimediaActionApi,
} from "./wikimedia-client";

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
  missing?: string | boolean;
  invalid?: string | boolean;
  imageinfo?: ImageInfo[];
};

const WIKIMEDIA_COMMONS_HOST = "commons.wikimedia.org";
const WIKIMEDIA_COMMONS_ACTION_API =
  `https://${WIKIMEDIA_COMMONS_HOST}/w/api.php`;
const WIKIMEDIA_ENGLISH_WIKIPEDIA_HOST = "en.wikipedia.org";
const WIKIMEDIA_ENGLISH_WIKIPEDIA_ACTION_API =
  `https://${WIKIMEDIA_ENGLISH_WIKIPEDIA_HOST}/w/api.php`;
const WIKIMEDIA_MEDIA_HOSTNAMES = new Set([
  "upload.wikimedia.org",
  "thumb.wikimedia.org",
]);

export const isWikimediaMediaHostname = (hostname: string): boolean =>
  WIKIMEDIA_MEDIA_HOSTNAMES.has(hostname.toLocaleLowerCase("en-US"));
const IMAGE_INFO_BATCH_SIZE = 20;
/**
 * Canonical Wikimedia `$wgThumbnailSteps` buckets (`20, 40, 60, 120, 250, 330,
 * 500, 960, 1280, 1920, 3840`) so requested dimensions match served files
 * without silent server-side rounding.
 */
export const WIKIMEDIA_THUMBNAIL_WIDTH = 960;
export const WIKIMEDIA_FEED_THUMBNAIL_WIDTH = 500;
export const WIKIMEDIA_LIGHTBOX_RENDITION_WIDTH = 1_920;
export const WIKIMEDIA_MEDIA_TIMEOUT_MS = 8_000;

export type WikimediaMediaRepository = "commons" | "enwiki";

export type WikimediaMediaRequest = {
  sourceTitle: string;
  imageUrl: string;
};

export type FetchWikimediaMediaDetailsOptions = {
  /**
   * When `false`, requests only `url|extmetadata` without `iiurlwidth` so
   * callers that only need attribution and alt text (such as On This Day sync)
   * do not ask Wikimedia to render unused lightbox sizes.
   */
  includeRendition?: boolean;
  signal?: AbortSignal;
};

export type WikimediaMediaDetails = {
  repository: WikimediaMediaRepository;
  attribution: WikimediaMediaAttribution;
  resolved?: boolean;
  unavailable?: boolean;
  altText?: string;
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
      thumbIndex >= 0
        ? segments[thumbIndex + 3]
        : segments[segments.length - 1];
    if (!filename) return undefined;
    return `File:${decodeURIComponent(filename).replace(/_/g, " ")}`;
  } catch {
    return undefined;
  }
};

/** Canonical identity shared by thumbnail, original, and rasterized-SVG URLs. */
export const getWikimediaMediaIdentity = (
  imageUrl: string | undefined,
): string | undefined => {
  if (!imageUrl) return undefined;
  let absoluteUrl: string;
  try {
    const url = new URL(imageUrl, "https://upload.wikimedia.org");
    if (
      (url.protocol !== "https:" && url.protocol !== "http:") ||
      !isWikimediaMediaHostname(url.hostname)
    ) {
      return undefined;
    }
    absoluteUrl = url.toString();
  } catch {
    return undefined;
  }

  const sourceTitle = getWikimediaFileTitleFromUrl(absoluteUrl);
  if (!sourceTitle) return undefined;
  return `${getWikimediaMediaRepositoryFromUrl(absoluteUrl)}:${normalizeSourceTitle(
    sourceTitle,
  ).normalize("NFC")}`;
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

export const getWikimediaProjectHostFromUrl = (imageUrl: string): string =>
  projectHostForRepository(getWikimediaMediaRepositoryFromUrl(imageUrl));

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

const fetchImageInfoBatch = async (
  actionApi: string,
  sourceTitles: string[],
  fetchImpl: typeof fetch,
  options: {
    includeSizeAndMime?: boolean;
    renditionWidth?: number;
    signal?: AbortSignal;
  },
): Promise<{ ok: boolean; pages: ImageInfoPage[] }> => {
  const params: Record<string, string> = {
    action: "query",
    prop: "imageinfo",
    iiprop: options.includeSizeAndMime
      ? "url|size|mime|extmetadata"
      : "url|extmetadata",
    titles: sourceTitles.join("|"),
    iiextmetadatalanguage: "en",
    iiextmetadatafilter:
      "ImageDescription|Artist|Credit|LicenseShortName|UsageTerms|LicenseUrl",
  };
  if (options.renditionWidth !== undefined) {
    params.iiurlwidth = String(options.renditionWidth);
  }

  try {
    const response = await fetchWikimediaActionApi(actionApi, params, {
      fetchImpl,
      signal: options.signal,
      timeoutMs: WIKIMEDIA_MEDIA_TIMEOUT_MS,
      maxRetries: 1,
    });
    if (!response.ok) {
      await response.body?.cancel().catch(() => undefined);
      return { ok: false, pages: [] };
    }

    const payload = (await response.json()) as {
      query?: { pages?: unknown };
    };
    const pages = extractActionApiPages<ImageInfoPage>(payload.query?.pages);
    if (!pages) {
      return { ok: false, pages: [] };
    }
    return { ok: true, pages };
  } catch (error: unknown) {
    if (options.signal?.aborted) throw error;
    return { ok: false, pages: [] };
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
  repository: WikimediaMediaRepository = "commons",
): Promise<Map<string, WikimediaMediaAttribution>> => {
  const uniqueTitles = [...new Set(sourceTitles.filter(Boolean))];
  const results = new Map<string, WikimediaMediaAttribution>();
  const projectHost = projectHostForRepository(repository);
  const actionApi = actionApiForRepository(repository);

  for (const title of uniqueTitles) {
    results.set(title, buildWikimediaSourceFallback(title, projectHost));
  }

  for (let index = 0; index < uniqueTitles.length; index += IMAGE_INFO_BATCH_SIZE) {
    const batch = uniqueTitles.slice(index, index + IMAGE_INFO_BATCH_SIZE);
    const { pages } = await fetchImageInfoBatch(actionApi, batch, fetchImpl, {
      includeSizeAndMime: false,
    });

    const requestedTitles = new Map(
      batch.map((title) => [normalizeSourceTitle(title), title]),
    );
    for (const page of pages) {
      const sourceTitle = page.title;
      const info = page.imageinfo?.[0];
      if (typeof sourceTitle !== "string" || !sourceTitle || !info) continue;
      const requestedTitle = requestedTitles.get(
        normalizeSourceTitle(sourceTitle),
      );
      if (!requestedTitle) continue;
      results.set(
        requestedTitle,
        attributionFromImageInfo(sourceTitle, info, projectHost),
      );
    }
  }

  return results;
};

/**
 * Batch-resolve media attributions for Wikimedia image URLs, routing
 * `/wikipedia/en/` URLs to English Wikipedia's Action API and Commons URLs to
 * Wikimedia Commons without requesting image renditions.
 */
export const fetchWikimediaMediaAttributionsForUrls = async (
  imageUrls: readonly string[],
  fetchImpl: typeof fetch = fetch,
  signal?: AbortSignal,
): Promise<Map<string, WikimediaMediaAttribution>> => {
  type RequestedAttribution = {
    sourceTitle: string;
    imageUrls: Set<string>;
  };

  const results = new Map<string, WikimediaMediaAttribution>();
  const grouped = new Map<
    WikimediaMediaRepository,
    Map<string, RequestedAttribution>
  >([
    ["commons", new Map()],
    ["enwiki", new Map()],
  ]);

  for (const imageUrl of imageUrls) {
    if (!imageUrl) continue;
    const sourceTitle = getWikimediaFileTitleFromUrl(imageUrl);
    if (!sourceTitle) continue;
    const repository = getWikimediaMediaRepositoryFromUrl(imageUrl);
    const projectHost = projectHostForRepository(repository);

    results.set(
      imageUrl,
      buildWikimediaSourceFallback(sourceTitle, projectHost),
    );

    const key = normalizeSourceTitle(sourceTitle);
    const repositoryGroup = grouped.get(repository)!;
    const existing = repositoryGroup.get(key);
    if (existing) {
      existing.imageUrls.add(imageUrl);
    } else {
      repositoryGroup.set(key, {
        sourceTitle,
        imageUrls: new Set([imageUrl]),
      });
    }
  }

  for (const repository of ["commons", "enwiki"] as const) {
    const repositoryGroup = grouped.get(repository)!;
    const media = [...repositoryGroup.values()];
    const projectHost = projectHostForRepository(repository);
    const actionApi = actionApiForRepository(repository);

    for (let index = 0; index < media.length; index += IMAGE_INFO_BATCH_SIZE) {
      const batch = media.slice(index, index + IMAGE_INFO_BATCH_SIZE);
      const { pages } = await fetchImageInfoBatch(
        actionApi,
        batch.map((item) => item.sourceTitle),
        fetchImpl,
        { includeSizeAndMime: false, signal },
      );

      for (const page of pages) {
        const sourceTitle = page.title;
        const info = page.imageinfo?.[0];
        if (typeof sourceTitle !== "string" || !sourceTitle || !info) continue;
        const requested = repositoryGroup.get(
          normalizeSourceTitle(sourceTitle),
        );
        if (!requested) continue;
        const attribution = attributionFromImageInfo(
          sourceTitle,
          info,
          projectHost,
        );
        for (const imageUrl of requested.imageUrls) {
          results.set(imageUrl, attribution);
        }
      }
    }
  }

  return results;
};

const isAbortSignal = (
  value: AbortSignal | FetchWikimediaMediaDetailsOptions | undefined,
): value is AbortSignal =>
  Boolean(value) &&
  typeof value === "object" &&
  "aborted" in value &&
  typeof value.addEventListener === "function";

/**
 * Resolve Wikimedia file metadata, attribution, and (optionally) canonical
 * originals plus a 1920px Commons lightbox rendition. Requests are grouped by
 * repository because English Wikipedia's local (often non-free) files are not
 * available from the Commons API.
 */
export const fetchWikimediaMediaDetails = async (
  requests: WikimediaMediaRequest[],
  fetchImpl: typeof fetch = fetch,
  signalOrOptions?: AbortSignal | FetchWikimediaMediaDetailsOptions,
): Promise<Map<string, WikimediaMediaDetails>> => {
  const options: FetchWikimediaMediaDetailsOptions = isAbortSignal(
    signalOrOptions,
  )
    ? { signal: signalOrOptions }
    : (signalOrOptions ?? {});
  const includeRendition = options.includeRendition ?? true;
  const signal = options.signal;

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
      resolved: false,
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
      const { ok, pages } = await fetchImageInfoBatch(
        actionApiForRepository(repository),
        batch.map((item) => item.sourceTitle),
        fetchImpl,
        {
          includeSizeAndMime: includeRendition,
          renditionWidth:
            includeRendition && repository === "commons"
              ? WIKIMEDIA_LIGHTBOX_RENDITION_WIDTH
              : undefined,
          signal,
        },
      );

      for (const page of pages) {
        if (typeof page.title !== "string" || !page.title) continue;
        const requested = repositoryGroup.get(
          normalizeSourceTitle(page.title),
        );
        if (!requested) continue;

        const info = page.imageinfo?.[0];
        const projectHost = projectHostForRepository(repository);
        if (!info) {
          const isTerminalUnavailable =
            page.missing === "" ||
            page.missing === true ||
            page.invalid === "" ||
            page.invalid === true ||
            page.imagerepository === "";
          if (ok && isTerminalUnavailable) {
            const fallback = buildWikimediaSourceFallback(
              requested.sourceTitle,
              projectHost,
            );
            for (const imageUrl of requested.imageUrls) {
              results.set(imageUrl, {
                repository,
                resolved: false,
                unavailable: true,
                attribution: fallback,
              });
            }
          }
          continue;
        }
        const attribution = attributionFromImageInfo(
          page.title,
          info,
          projectHost,
        );
        const altText = metadataText(info.extmetadata, "ImageDescription");
        const originalSrc = includeRendition
          ? normalizeHttpUrl(info.url)
          : undefined;
        const originalWidth = includeRendition
          ? positiveDimension(info.width)
          : undefined;
        const originalHeight = includeRendition
          ? positiveDimension(info.height)
          : undefined;
        const thumbSrc = includeRendition
          ? normalizeHttpUrl(info.thumburl)
          : undefined;
        const thumbWidth = includeRendition
          ? positiveDimension(info.thumbwidth)
          : undefined;
        const thumbHeight = includeRendition
          ? positiveDimension(info.thumbheight)
          : undefined;

        let lightboxSrc: string | undefined;
        let lightboxWidth: number | undefined;
        let lightboxHeight: number | undefined;

        if (includeRendition) {
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
        }

        for (const imageUrl of requested.imageUrls) {
          results.set(imageUrl, {
            repository,
            resolved: true,
            attribution,
            ...(altText ? { altText } : {}),
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
  if (!imageUrl) return undefined;
  const title = getWikimediaFileTitleFromUrl(imageUrl);
  if (!title) return undefined;
  const attributions = await fetchWikimediaMediaAttributionsForUrls(
    [imageUrl],
    fetchImpl,
  );
  return (
    attributions.get(imageUrl) ??
    buildWikimediaSourceFallback(
      title,
      getWikimediaProjectHostFromUrl(imageUrl),
    )
  );
};
