import { anyApi } from "convex/server";
import { fetchMutation, fetchQuery } from "convex/nextjs";
import {
  fetchWikipediaFeaturedSnapshot,
  getWikipediaFeaturedFeedDate,
  type WikipediaDidYouKnowItem,
  type WikipediaFeaturedSnapshot,
  type WikipediaFeaturedThumbnail,
} from "@/lib/featured-article";
import { filterSafeTitles } from "@/lib/nsfw-filter";

const WIKI_ACTION_API = "https://en.wikipedia.org/w/api.php";
const USER_AGENT =
  "CurioGarden/1.0 (https://curiogarden.org; accessibility-first Wikipedia audio reader)";
const DYK_THUMBNAIL_BATCH_SIZE = 20;

type TodaySnapshotRecord = {
  feedDate: string;
  data: TodayWikipediaData;
  generatedAt: number;
  createdAt: number;
  updatedAt: number;
};

export type TodayDidYouKnowAudio = {
  feedDate: string;
  title: string;
  status: "missing" | "pending" | "ready" | "failed";
  audioUrl: string | null;
  durationSeconds?: number;
  lastError?: string;
};

export type TodayWikipediaData = {
  tfa: WikipediaFeaturedSnapshot["tfa"];
  trending: WikipediaFeaturedSnapshot["trendingCandidates"];
  didYouKnow: WikipediaDidYouKnowItem[];
  inTheNews: WikipediaFeaturedSnapshot["inTheNews"];
  pictureOfDay: WikipediaFeaturedSnapshot["pictureOfDay"];
  onThisDay: WikipediaFeaturedSnapshot["onThisDay"];
  trendingDate: string | null;
  trendingSource: string | null;
  trendingSourceType: WikipediaFeaturedSnapshot["trendingSourceType"];
  trendingIsStale: boolean;
  feedDate: string;
  snapshotFeedDate: string;
  snapshotGeneratedAt: number;
  snapshotIsStale: boolean;
  didYouKnowAudio?: TodayDidYouKnowAudio;
};

type DidYouKnowPageDetail = {
  wikiPageId?: string;
  thumbnail?: WikipediaFeaturedThumbnail;
};

const normalizeTitleKey = (title: string): string =>
  title.replace(/_/g, " ").trim().toLowerCase();

const getSnapshotDate = (feedDateIso: string): Date =>
  new Date(`${feedDateIso}T12:00:00Z`);

const shouldUseSnapshotCache = (): boolean =>
  process.env.NEXT_PUBLIC_LOCAL_MODE !== "true" &&
  Boolean(process.env.NEXT_PUBLIC_CONVEX_URL);

export const resolveTodayFeedDateIso = (now = new Date()): string =>
  getWikipediaFeaturedFeedDate(0, now).replace(/\//g, "-");

const fetchDidYouKnowPageDetails = async (
  titles: string[],
): Promise<Map<string, DidYouKnowPageDetail>> => {
  const details = new Map<string, DidYouKnowPageDetail>();

  for (let i = 0; i < titles.length; i += DYK_THUMBNAIL_BATCH_SIZE) {
    const batch = titles.slice(i, i + DYK_THUMBNAIL_BATCH_SIZE);
    const params = new URLSearchParams({
      action: "query",
      format: "json",
      titles: batch.join("|"),
      prop: "pageimages|info",
      piprop: "thumbnail",
      pithumbsize: "800",
      redirects: "1",
      origin: "*",
    });

    const response = await fetch(`${WIKI_ACTION_API}?${params}`, {
      headers: { "User-Agent": USER_AGENT },
    });
    if (!response.ok) continue;

    const data = await response.json();
    const pages =
      (data.query?.pages as Record<
        string,
        {
          missing?: unknown;
          ns?: number;
          pageid?: number | string;
          title?: string;
          thumbnail?: WikipediaFeaturedThumbnail;
        }
      >) ?? {};

    for (const page of Object.values(pages)) {
      if (page.missing !== undefined || page.ns !== 0 || !page.title) {
        continue;
      }
      details.set(normalizeTitleKey(page.title), {
        wikiPageId: page.pageid != null ? String(page.pageid) : undefined,
        thumbnail: page.thumbnail,
      });
    }
  }

  return details;
};

export const enrichDidYouKnowThumbnails = async (
  items: WikipediaDidYouKnowItem[],
): Promise<WikipediaDidYouKnowItem[]> => {
  const titleByKey = new Map<string, string>();

  for (const item of items) {
    for (const link of item.links) {
      const title = (link.title || link.slug.replace(/_/g, " ")).trim();
      if (title) titleByKey.set(normalizeTitleKey(title), title);
    }
  }

  if (titleByKey.size === 0) return items;

  let details: Map<string, DidYouKnowPageDetail>;
  try {
    details = await fetchDidYouKnowPageDetails([...titleByKey.values()]);
  } catch {
    return items;
  }
  if (details.size === 0) return items;

  return items.map((item) => ({
    ...item,
    links: item.links.map((link) => {
      const detail = details.get(normalizeTitleKey(link.title));
      if (!detail) return link;

      return {
        ...link,
        ...(detail.wikiPageId ? { wikiPageId: detail.wikiPageId } : {}),
        ...(detail.thumbnail ? { thumbnail: detail.thumbnail } : {}),
      };
    }),
  }));
};

const filterTrendingArticles = async (
  candidates: WikipediaFeaturedSnapshot["trendingCandidates"],
): Promise<WikipediaFeaturedSnapshot["trendingCandidates"]> => {
  if (candidates.length === 0) return [];

  const candidateTitles = candidates.map((candidate) => candidate.title);
  const safeTitles = await filterSafeTitles(candidateTitles);
  const filtered = candidates.filter((candidate) => safeTitles.has(candidate.title));

  return filtered.length > 0 ? filtered : candidates;
};

const normalizeSnapshotData = async (
  snapshot: WikipediaFeaturedSnapshot,
  generatedAt: number,
): Promise<TodayWikipediaData> => {
  const [trending, didYouKnow] = await Promise.all([
    filterTrendingArticles(snapshot.trendingCandidates),
    enrichDidYouKnowThumbnails(snapshot.didYouKnow),
  ]);

  return {
    tfa: snapshot.tfa,
    trending,
    didYouKnow,
    inTheNews: snapshot.inTheNews,
    pictureOfDay: snapshot.pictureOfDay,
    onThisDay: snapshot.onThisDay,
    trendingDate: snapshot.trendingDate,
    trendingSource: snapshot.trendingSource,
    trendingSourceType: snapshot.trendingSourceType,
    trendingIsStale: snapshot.trendingIsStale,
    feedDate: snapshot.feedDateIso,
    snapshotFeedDate: snapshot.feedDateIso,
    snapshotGeneratedAt: generatedAt,
    snapshotIsStale: false,
  };
};

export const buildTodayWikipediaSnapshot = async ({
  feedDateIso,
  now,
}: {
  feedDateIso?: string;
  now?: Date;
} = {}): Promise<TodayWikipediaData> => {
  const snapshotDate = feedDateIso ? getSnapshotDate(feedDateIso) : now;
  const snapshot = await fetchWikipediaFeaturedSnapshot(snapshotDate);

  return normalizeSnapshotData(snapshot, Date.now());
};

const saveTodaySnapshot = async (data: TodayWikipediaData) => {
  if (!shouldUseSnapshotCache()) return;

  await fetchMutation(anyApi.today.saveTodaySnapshot, {
    feedDate: data.feedDate,
    data,
    generatedAt: data.snapshotGeneratedAt,
  });
};

export const syncTodayWikipediaSnapshot = async ({
  baseUrl,
  feedDateIso,
}: {
  baseUrl?: string;
  feedDateIso?: string;
} = {}): Promise<TodayWikipediaData> => {
  void baseUrl;
  const data = await buildTodayWikipediaSnapshot({ feedDateIso });
  await saveTodaySnapshot(data);
  return data;
};

const hydrateCachedSnapshot = (
  record: TodaySnapshotRecord,
  currentFeedDate = resolveTodayFeedDateIso(),
): TodayWikipediaData => {
  const data = record.data;
  const snapshotFeedDate = data.snapshotFeedDate ?? record.feedDate;

  return {
    ...data,
    feedDate: data.feedDate ?? record.feedDate,
    snapshotFeedDate,
    snapshotGeneratedAt: data.snapshotGeneratedAt ?? record.generatedAt,
    snapshotIsStale: snapshotFeedDate !== currentFeedDate,
  };
};

const getCachedTodaySnapshot = async ({
  feedDateIso,
}: {
  feedDateIso?: string;
} = {}): Promise<TodayWikipediaData | null> => {
  if (!shouldUseSnapshotCache()) return null;

  const currentFeedDate = resolveTodayFeedDateIso();
  const record = feedDateIso
    ? ((await fetchQuery(anyApi.today.getTodaySnapshotByDate, {
        feedDate: feedDateIso,
      })) as TodaySnapshotRecord | null)
    : ((await fetchQuery(anyApi.today.getTodaySnapshotByDate, {
        feedDate: currentFeedDate,
      })) as TodaySnapshotRecord | null) ??
      ((await fetchQuery(anyApi.today.getLatestTodaySnapshot, {})) as
        | TodaySnapshotRecord
        | null);

  return record ? hydrateCachedSnapshot(record, currentFeedDate) : null;
};

export const getTodayWikipediaData = async ({
  allowLiveFallback = false,
  feedDateIso,
}: {
  allowLiveFallback?: boolean;
  feedDateIso?: string;
} = {}): Promise<TodayWikipediaData | null> => {
  const cached = await getCachedTodaySnapshot({ feedDateIso });
  if (cached) return cached;

  if (!allowLiveFallback) {
    return null;
  }

  return buildTodayWikipediaSnapshot({ feedDateIso });
};
