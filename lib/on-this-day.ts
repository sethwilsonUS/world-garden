import { createHash } from "node:crypto";
import {
  calendarDayKey,
  wikipediaCalendarUrl,
  type CalendarDay,
} from "@/lib/calendar-day";
import {
  decodeHtmlEntities,
  type WikipediaOnThisDayItem,
} from "@/lib/featured-article";
import {
  CURRENT_ON_THIS_DAY_SCHEMA_VERSION,
  ON_THIS_DAY_CATEGORIES,
  type OnThisDayArticleRef,
  type OnThisDayCategory,
  type OnThisDayCategoryMap,
  type OnThisDayEvent,
  type OnThisDayImage,
  type OnThisDayOrder,
  type OnThisDayPageResponse,
  type OnThisDaySnapshot,
} from "@/lib/on-this-day-contracts";
import {
  fetchWikimedia,
  parseRetryAfterSeconds,
} from "@/lib/wikimedia-client";
import {
  buildWikimediaSourceFallback,
  fetchWikimediaMediaDetails,
  getWikimediaFileTitleFromUrl,
  getWikimediaMediaRepositoryFromUrl,
  type WikimediaMediaAttribution,
  type WikimediaMediaRequest,
} from "@/lib/wikimedia-media";

export const WIKIPEDIA_REST_ON_THIS_DAY =
  "https://en.wikipedia.org/api/rest_v1/feed/onthisday/all";
export const WIKIPEDIA_ON_THIS_DAY_REQUEST_TIMEOUT_MS = 10_000;

type FeedThumbnail = {
  source?: string;
  width?: number;
  height?: number;
};

type FeedPage = {
  title?: string;
  titles?: { normalized?: string };
  pageid?: number | string;
  thumbnail?: FeedThumbnail;
};

const isFeedRecord = (value: unknown): value is Record<string, unknown> =>
  Boolean(value) && typeof value === "object" && !Array.isArray(value);

export type OnThisDayFeedPayload = Partial<
  Record<OnThisDayCategory, unknown[]>
>;

export type OnThisDayProvider = {
  fetchAll(date: { month: string; day: string }): Promise<OnThisDayFeedPayload>;
};

export type OnThisDayResolvedImage = {
  attribution: WikimediaMediaAttribution;
  altText?: string;
  isFallback?: boolean;
  retryable?: boolean;
};

export type OnThisDayImageResolver = (
  requests: WikimediaMediaRequest[],
) => Promise<Map<string, OnThisDayResolvedImage>>;

export class OnThisDayUpstreamError extends Error {
  readonly status: number;
  readonly retryAfterSeconds?: number;

  constructor(
    message: string,
    {
      status,
      retryAfterSeconds,
    }: { status: number; retryAfterSeconds?: number },
  ) {
    super(message);
    this.name = "OnThisDayUpstreamError";
    this.status = status;
    this.retryAfterSeconds = retryAfterSeconds;
  }
}

const parseOnThisDayFeedPayload = (value: unknown): OnThisDayFeedPayload => {
  if (!isFeedRecord(value)) return {};
  const payload: OnThisDayFeedPayload = {};
  for (const category of ON_THIS_DAY_CATEGORIES) {
    const events = value[category];
    if (Array.isArray(events)) payload[category] = events;
  }
  return payload;
};

export const wikipediaRestOnThisDayProvider: OnThisDayProvider = {
  async fetchAll({ month, day }) {
    const response = await fetchWikimedia(
      `${WIKIPEDIA_REST_ON_THIS_DAY}/${month}/${day}`,
      {
        headers: { Accept: "application/json" },
        timeoutMs: WIKIPEDIA_ON_THIS_DAY_REQUEST_TIMEOUT_MS,
      },
    );
    if (!response.ok) {
      throw new OnThisDayUpstreamError(
        `Wikipedia On This Day returned ${response.status} for ${month}-${day}`,
        {
          status: response.status,
          retryAfterSeconds: parseRetryAfterSeconds(
            response.headers.get("retry-after"),
          ),
        },
      );
    }
    return parseOnThisDayFeedPayload(await response.json());
  },
};

const resolveImagesWithWikimedia: OnThisDayImageResolver = async (requests) => {
  const details = await fetchWikimediaMediaDetails(requests);
  return new Map(
    [...details].map(([imageUrl, detail]) => [
      imageUrl,
      {
        attribution: detail.attribution,
        ...(detail.altText ? { altText: detail.altText } : {}),
        ...(detail.resolved === false ? { isFallback: true } : {}),
        ...(detail.unavailable ? { retryable: false } : {}),
      },
    ]),
  );
};

const normalizeText = (value: unknown): string =>
  decodeHtmlEntities(
    (typeof value === "string" ? value : "").replace(/<[^>]*>/gu, " "),
  )
    .replace(/\s+/gu, " ")
    .trim();

const normalizePage = (page: FeedPage): OnThisDayArticleRef | null => {
  const title = normalizeText(page.titles?.normalized ?? page.title).replace(
    /_/gu,
    " ",
  );
  if (!title) return null;
  return {
    title,
    slug: title.replace(/ /gu, "_"),
    ...(page.pageid == null ? {} : { wikiPageId: String(page.pageid) }),
  };
};

type ImageCandidate = OnThisDayImage & { sourceTitle: string };

const imageCandidate = (pages: FeedPage[]): ImageCandidate | undefined => {
  for (const page of pages) {
    const thumbnail = page.thumbnail;
    const article = normalizePage(page);
    if (
      !article ||
      !thumbnail?.source ||
      typeof thumbnail.width !== "number" ||
      thumbnail.width <= 0 ||
      typeof thumbnail.height !== "number" ||
      thumbnail.height <= 0
    ) {
      continue;
    }
    const sourceTitle = getWikimediaFileTitleFromUrl(thumbnail.source);
    if (!sourceTitle) continue;
    return {
      source: thumbnail.source,
      width: thumbnail.width,
      height: thumbnail.height,
      articleTitle: article.title,
      sourceTitle,
    };
  }
};

const eventId = (
  category: OnThisDayCategory,
  year: number | undefined,
  text: string,
  pages: OnThisDayArticleRef[],
): string => {
  const identity = [
    category,
    year ?? "annual",
    text,
    ...pages.map((page) => page.wikiPageId ?? page.slug),
  ].join("\u0000");
  return `${category}-${createHash("sha256").update(identity).digest("hex").slice(0, 16)}`;
};

const emptyCategoryMap = <T>(value: () => T): OnThisDayCategoryMap<T> =>
  Object.fromEntries(
    ON_THIS_DAY_CATEGORIES.map((category) => [category, value()]),
  ) as OnThisDayCategoryMap<T>;

const extractReusableImageMetadata = (
  previousSnapshot: OnThisDaySnapshot | null | undefined,
): Map<string, OnThisDayResolvedImage> => {
  const reused = new Map<string, OnThisDayResolvedImage>();
  if (!previousSnapshot) return reused;

  for (const events of Object.values(previousSnapshot.categories)) {
    for (const event of events) {
      if (
        !event.image?.source ||
        !event.image.attribution ||
        event.image.attributionIsFallback
      ) {
        continue;
      }
      if (reused.has(event.image.source)) continue;
      reused.set(event.image.source, {
        attribution: event.image.attribution,
        ...(event.image.altText ? { altText: event.image.altText } : {}),
      });
    }
  }
  return reused;
};

export type BuildOnThisDaySnapshotOptions = {
  day: CalendarDay;
  provider?: OnThisDayProvider;
  resolveImages?: OnThisDayImageResolver;
  previousSnapshot?: OnThisDaySnapshot | null;
  reResolveImages?: boolean;
  skipImageResolution?: boolean;
  checkedAt?: number;
};

export type BuiltOnThisDaySnapshot = {
  snapshot: OnThisDaySnapshot;
  imageResolutionSucceeded: boolean;
};

export const buildOnThisDaySnapshotWithMeta = async ({
  day,
  provider = wikipediaRestOnThisDayProvider,
  resolveImages = resolveImagesWithWikimedia,
  previousSnapshot = null,
  reResolveImages = false,
  skipImageResolution = false,
  checkedAt = Date.now(),
}: BuildOnThisDaySnapshotOptions): Promise<BuiltOnThisDaySnapshot> => {
  const monthDay = calendarDayKey(day);
  const [month, dayPart] = monthDay.split("-");
  const payload = await provider.fetchAll({ month, day: dayPart });
  const categories = emptyCategoryMap<OnThisDayEvent[]>(() => []);
  const candidates = new Map<string, ImageCandidate>();

  for (const category of ON_THIS_DAY_CATEGORIES) {
    const feedEvents = payload[category];
    if (!Array.isArray(feedEvents)) {
      throw new Error(
        `Wikipedia On This Day is missing the ${category} category.`,
      );
    }
    for (const rawEvent of feedEvents) {
      if (!isFeedRecord(rawEvent)) continue;
      const text = normalizeText(rawEvent.text);
      if (!text) continue;
      const rawPages = Array.isArray(rawEvent.pages)
        ? rawEvent.pages.filter((page): page is FeedPage => isFeedRecord(page))
        : [];
      const pages = rawPages
        .map(normalizePage)
        .filter((page): page is OnThisDayArticleRef => page !== null);
      const candidate = imageCandidate(rawPages);
      if (candidate) candidates.set(candidate.source, candidate);
      const year =
        typeof rawEvent.year === "number" && Number.isFinite(rawEvent.year)
          ? rawEvent.year
          : undefined;
      categories[category].push({
        id: eventId(category, year, text, pages),
        ...(year == null ? {} : { year }),
        text,
        pages,
        ...(candidate
          ? {
              image: {
                source: candidate.source,
                width: candidate.width,
                height: candidate.height,
                articleTitle: candidate.articleTitle,
              },
            }
          : {}),
      });
    }
  }

  // Always retain previous metadata as a fallback so a failed scheduled
  // re-resolution never degrades already-resolved alt text or attribution.
  const previousMetadata = extractReusableImageMetadata(previousSnapshot);
  const reusedMetadata =
    reResolveImages || skipImageResolution
      ? new Map<string, OnThisDayResolvedImage>()
      : previousMetadata;

  const requests = skipImageResolution
    ? []
    : [...candidates.values()]
        .filter(({ source }) => !reusedMetadata.has(source))
        .map(({ source, sourceTitle }) => ({
          imageUrl: source,
          sourceTitle,
        }));

  const requestedUrls = new Set(requests.map((request) => request.imageUrl));
  let fetchedMetadata = new Map<string, OnThisDayResolvedImage>();
  let imageResolutionSucceeded = !skipImageResolution;
  if (requests.length > 0) {
    try {
      fetchedMetadata = await resolveImages(requests);
    } catch (error) {
      imageResolutionSucceeded = false;
      console.warn(
        `[on-this-day] Image metadata resolution failed for ${monthDay}; preserving prior metadata or source fallbacks.`,
        error,
      );
    }
  }

  for (const events of Object.values(categories)) {
    for (const event of events) {
      if (!event.image) continue;
      const candidate = candidates.get(event.image.source);
      if (!candidate) continue;
      const repository = getWikimediaMediaRepositoryFromUrl(candidate.source);
      const fetched = fetchedMetadata.get(event.image.source);
      const fetchedVerified = fetched && !fetched.isFallback ? fetched : undefined;
      if (
        requestedUrls.has(event.image.source) &&
        !fetchedVerified &&
        fetched?.retryable !== false
      ) {
        imageResolutionSucceeded = false;
      }
      const resolved =
        fetchedVerified ??
        reusedMetadata.get(event.image.source) ??
        previousMetadata.get(event.image.source);
      if (resolved) {
        if (resolved.altText) event.image.altText = resolved.altText;
        event.image.attribution = resolved.attribution;
      } else {
        event.image.attribution =
          fetched?.attribution ??
          buildWikimediaSourceFallback(
            candidate.sourceTitle,
            repository === "enwiki"
              ? "en.wikipedia.org"
              : "commons.wikimedia.org",
          );
        event.image.attributionIsFallback = true;
      }
    }
  }

  return {
    snapshot: {
      schemaVersion: CURRENT_ON_THIS_DAY_SCHEMA_VERSION,
      provider: "wikipedia-rest-v1",
      monthDay,
      checkedAt,
      sourceUrl: wikipediaCalendarUrl(day),
      categories,
      counts: Object.fromEntries(
        ON_THIS_DAY_CATEGORIES.map((category) => [
          category,
          categories[category].length,
        ]),
      ) as OnThisDayCategoryMap<number>,
      availableCategories: emptyCategoryMap(() => true),
    },
    imageResolutionSucceeded,
  };
};

export const buildOnThisDaySnapshot = async (
  options: BuildOnThisDaySnapshotOptions,
): Promise<OnThisDaySnapshot> =>
  (await buildOnThisDaySnapshotWithMeta(options)).snapshot;

export const hashOnThisDaySnapshot = (snapshot: OnThisDaySnapshot): string =>
  createHash("sha256")
    .update(
      JSON.stringify({
        schemaVersion: snapshot.schemaVersion,
        provider: snapshot.provider,
        monthDay: snapshot.monthDay,
        availableCategories: snapshot.availableCategories,
        categories: snapshot.categories,
      }),
    )
    .digest("hex");

export const paginateOnThisDaySnapshot = (
  snapshot: OnThisDaySnapshot,
  {
    category,
    order,
    offset,
    limit,
    checkedAt = snapshot.checkedAt,
    changedAt = snapshot.checkedAt,
    degraded = snapshot.provider === "featured-fallback",
  }: {
    category: OnThisDayCategory;
    order: OnThisDayOrder;
    offset: number;
    limit: number;
    checkedAt?: number;
    changedAt?: number;
    degraded?: boolean;
  },
): OnThisDayPageResponse => {
  const resolvedOrder = category === "holidays" ? "newest" : order;
  const safeOffset = Math.max(0, Math.floor(offset));
  const safeLimit = Math.max(1, Math.min(25, Math.floor(limit)));
  const source = snapshot.categories[category];
  const ordered =
    category === "holidays"
      ? source
      : [...source].sort((left, right) => {
          const leftYear = left.year ?? 0;
          const rightYear = right.year ?? 0;
          return resolvedOrder === "oldest"
            ? leftYear - rightYear
            : rightYear - leftYear;
        });
  const items = ordered.slice(safeOffset, safeOffset + safeLimit);
  const nextOffset =
    safeOffset + items.length < ordered.length
      ? safeOffset + items.length
      : null;

  return {
    calendarDay: snapshot.monthDay,
    checkedAt,
    changedAt,
    degraded,
    provider: snapshot.provider,
    sourceUrl: snapshot.sourceUrl,
    category,
    order: resolvedOrder,
    offset: safeOffset,
    limit: safeLimit,
    total: ordered.length,
    nextOffset,
    counts: snapshot.counts,
    availableCategories: snapshot.availableCategories,
    items,
  };
};

export const buildFeaturedOnThisDayFallback = ({
  day,
  items,
  checkedAt = Date.now(),
}: {
  day: CalendarDay;
  items: WikipediaOnThisDayItem[];
  checkedAt?: number;
}): OnThisDaySnapshot => {
  const monthDay = calendarDayKey(day);
  const categories = emptyCategoryMap<OnThisDayEvent[]>(() => []);

  for (const item of items) {
    const text = normalizeText(item.text);
    const pages = item.pages.map(({ title, slug, wikiPageId }) => ({
      title,
      slug,
      ...(wikiPageId ? { wikiPageId } : {}),
    }));
    if (!text && pages.length === 0) continue;
    const imagePage = item.pages.find((page) => page.thumbnail);
    const thumbnail = imagePage?.thumbnail;
    categories.selected.push({
      id: eventId("selected", item.year, text, pages),
      ...(item.year == null ? {} : { year: item.year }),
      text,
      pages,
      ...(imagePage && thumbnail
        ? {
            image: {
              source: thumbnail.source,
              width: thumbnail.width,
              height: thumbnail.height,
              articleTitle: imagePage.title,
              ...(thumbnail.attribution
                ? { attribution: thumbnail.attribution }
                : {}),
            },
          }
        : {}),
    });
  }

  return {
    schemaVersion: CURRENT_ON_THIS_DAY_SCHEMA_VERSION,
    provider: "featured-fallback",
    monthDay,
    checkedAt,
    sourceUrl: wikipediaCalendarUrl(day),
    categories,
    counts: Object.fromEntries(
      ON_THIS_DAY_CATEGORIES.map((category) => [
        category,
        categories[category].length,
      ]),
    ) as OnThisDayCategoryMap<number>,
    availableCategories: {
      selected: true,
      events: false,
      births: false,
      deaths: false,
      holidays: false,
    },
  };
};
