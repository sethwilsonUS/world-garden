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
};

type ImageInfoPage = {
  title?: string;
  imageinfo?: ImageInfo[];
};

const WIKIMEDIA_COMMONS_HOST = "commons.wikimedia.org";
const WIKIMEDIA_COMMONS_ACTION_API =
  `https://${WIKIMEDIA_COMMONS_HOST}/w/api.php`;
const USER_AGENT =
  "CurioGarden/1.0 (https://curiogarden.org; accessibility-first Wikipedia audio reader)";
const IMAGE_INFO_BATCH_SIZE = 50;
export const WIKIMEDIA_MEDIA_TIMEOUT_MS = 8_000;

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
    const params = new URLSearchParams({
      action: "query",
      format: "json",
      prop: "imageinfo",
      iiprop: "url|extmetadata",
      titles: batch.join("|"),
      origin: "*",
    });

    try {
      const controller = new AbortController();
      const timeout = setTimeout(
        () => controller.abort(),
        WIKIMEDIA_MEDIA_TIMEOUT_MS,
      );
      let response: Response;
      try {
        response = await fetchImpl(`${WIKIMEDIA_COMMONS_ACTION_API}?${params}`, {
          headers: { "User-Agent": USER_AGENT },
          signal: controller.signal,
        });
      } finally {
        clearTimeout(timeout);
      }
      if (!response.ok) continue;

      const payload = (await response.json()) as {
        query?: { pages?: Record<string, ImageInfoPage> };
      };

      for (const page of Object.values(payload.query?.pages ?? {})) {
        const sourceTitle = page.title;
        if (!sourceTitle) continue;
        const info = page.imageinfo?.[0];
        const metadata = info?.extmetadata;

        results.set(sourceTitle, {
          creator: metadataText(metadata, "Artist"),
          credit: metadataText(metadata, "Credit"),
          licenseName:
            metadataText(metadata, "LicenseShortName") ??
            metadataText(metadata, "UsageTerms"),
          licenseUrl: metadataText(metadata, "LicenseUrl"),
          sourceTitle,
          sourceUrl:
            info?.descriptionurl ??
            buildWikimediaSourceFallback(sourceTitle).sourceUrl,
        });
      }
    } catch {
      // The source-page fallback remains useful when Wikimedia metadata is unavailable.
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
