import { createHash } from "node:crypto";
import {
  buildWikimediaSourceFallback,
  fetchWikimediaMediaDetails,
  getWikimediaFileTitleFromUrl,
  getWikimediaMediaRepositoryFromUrl,
  type WikimediaMediaAttribution,
  type WikimediaMediaRequest,
} from "@/lib/wikimedia-media";
import {
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
  decodeHtmlEntities,
  type WikipediaOnThisDayItem,
} from "@/lib/featured-article";

const WIKIFEEDS_ON_THIS_DAY =
  "https://api.wikimedia.org/feed/v1/wikipedia/en/onthisday/all";
const USER_AGENT =
  "CurioGarden/1.0 (https://curiogarden.org; accessibility-first Wikipedia audio reader)";
export const WIKIFEEDS_REQUEST_TIMEOUT_MS = 10_000;

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

type FeedEvent = {
  year?: number;
  text?: string;
  pages?: FeedPage[];
};

export type OnThisDayFeedPayload = Partial<
  Record<OnThisDayCategory, FeedEvent[]>
>;

export type OnThisDayProvider = {
  fetchAll(date: { month: string; day: string }): Promise<OnThisDayFeedPayload>;
};

export type OnThisDayResolvedImage = {
  attribution: WikimediaMediaAttribution;
  altText?: string;
};

export type OnThisDayImageResolver = (
  requests: WikimediaMediaRequest[],
) => Promise<Map<string, OnThisDayResolvedImage>>;

export const wikifeedsOnThisDayProvider: OnThisDayProvider = {
  async fetchAll({ month, day }) {
    const controller = new AbortController();
    const timeout = setTimeout(
      () => controller.abort(),
      WIKIFEEDS_REQUEST_TIMEOUT_MS,
    );
    try {
      const response = await fetch(`${WIKIFEEDS_ON_THIS_DAY}/${month}/${day}`, {
        headers: { "User-Agent": USER_AGENT },
        signal: controller.signal,
      });
      if (!response.ok) {
        throw new Error(
          `Wikimedia On This Day returned ${response.status} for ${month}-${day}`,
        );
      }
      return (await response.json()) as OnThisDayFeedPayload;
    } finally {
      clearTimeout(timeout);
    }
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

const parseFeedDate = (
  feedDate: string,
): { month: string; day: string; monthDay: string } => {
  const match = feedDate.match(/^(\d{4})-(\d{2})-(\d{2})$/u);
  if (!match) throw new Error("On This Day feed date must use YYYY-MM-DD.");
  const date = new Date(`${feedDate}T00:00:00Z`);
  if (
    Number.isNaN(date.getTime()) ||
    date.getUTCFullYear() !== Number(match[1]) ||
    date.getUTCMonth() + 1 !== Number(match[2]) ||
    date.getUTCDate() !== Number(match[3])
  ) {
    throw new Error("On This Day feed date is not a valid calendar date.");
  }
  return { month: match[2], day: match[3], monthDay: `${match[2]}-${match[3]}` };
};

const wikipediaCalendarUrl = (month: string, day: string): string => {
  const date = new Date(`2000-${month}-${day}T00:00:00Z`);
  const monthName = date.toLocaleDateString("en-US", {
    month: "long",
    timeZone: "UTC",
  });
  return `https://en.wikipedia.org/wiki/${monthName}_${Number(day)}`;
};

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

const isFeedRecord = (value: unknown): value is Record<string, unknown> =>
  Boolean(value) && typeof value === "object" && !Array.isArray(value);

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

export const buildOnThisDaySnapshot = async ({
  feedDate,
  provider = wikifeedsOnThisDayProvider,
  resolveImages = resolveImagesWithWikimedia,
  generatedAt = Date.now(),
}: {
  feedDate: string;
  provider?: OnThisDayProvider;
  resolveImages?: OnThisDayImageResolver;
  generatedAt?: number;
}): Promise<OnThisDaySnapshot> => {
  const { month, day, monthDay } = parseFeedDate(feedDate);
  const payload = await provider.fetchAll({ month, day });
  const categories = emptyCategoryMap<OnThisDayEvent[]>(() => []);
  const candidates = new Map<string, ImageCandidate>();

  for (const category of ON_THIS_DAY_CATEGORIES) {
    const feedEvents = payload[category];
    if (!Array.isArray(feedEvents)) {
      throw new Error(`Wikimedia On This Day is missing the ${category} category.`);
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

  const requests = [...candidates.values()].map(({ source, sourceTitle }) => ({
    imageUrl: source,
    sourceTitle,
  }));
  let imageMetadata = new Map<string, OnThisDayResolvedImage>();
  if (requests.length > 0) {
    try {
      imageMetadata = await resolveImages(requests);
    } catch {
      // A usable source-page fallback is attached below. Metadata enrichment
      // must never discard an otherwise valid historical event.
    }
  }
  for (const events of Object.values(categories)) {
    for (const event of events) {
      if (!event.image) continue;
      const candidate = candidates.get(event.image.source);
      if (!candidate) continue;
      const repository = getWikimediaMediaRepositoryFromUrl(candidate.source);
      const resolved = imageMetadata.get(event.image.source);
      if (resolved?.altText) event.image.altText = resolved.altText;
      event.image.attribution =
        resolved?.attribution ??
        buildWikimediaSourceFallback(
          candidate.sourceTitle,
          repository === "enwiki"
            ? "en.wikipedia.org"
            : "commons.wikimedia.org",
        );
    }
  }

  return {
    schemaVersion: 1,
    provider: "wikifeeds-v1",
    feedDate,
    monthDay,
    generatedAt,
    sourceUrl: wikipediaCalendarUrl(month, day),
    categories,
    counts: Object.fromEntries(
      ON_THIS_DAY_CATEGORIES.map((category) => [category, categories[category].length]),
    ) as OnThisDayCategoryMap<number>,
    availableCategories: emptyCategoryMap(() => true),
  };
};

export const paginateOnThisDaySnapshot = (
  snapshot: OnThisDaySnapshot,
  {
    requestedDate,
    category,
    order,
    offset,
    limit,
  }: {
    requestedDate: string;
    category: OnThisDayCategory;
    order: OnThisDayOrder;
    offset: number;
    limit: number;
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
    requestedDate,
    snapshotDate: snapshot.feedDate,
    snapshotIsStale: requestedDate !== snapshot.feedDate,
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
  feedDate,
  items,
  generatedAt = Date.now(),
}: {
  feedDate: string;
  items: WikipediaOnThisDayItem[];
  generatedAt?: number;
}): OnThisDaySnapshot => {
  const { month, day, monthDay } = parseFeedDate(feedDate);
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
    schemaVersion: 1,
    provider: "featured-fallback",
    feedDate,
    monthDay,
    generatedAt,
    sourceUrl: wikipediaCalendarUrl(month, day),
    categories,
    counts: Object.fromEntries(
      ON_THIS_DAY_CATEGORIES.map((category) => [category, categories[category].length]),
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
