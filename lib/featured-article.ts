const WIKI_FEATURED_API = "https://en.wikipedia.org/api/rest_v1/feed/featured";
const USER_AGENT =
  "CurioGarden/1.0 (https://curiogarden.org; accessibility-first Wikipedia audio reader)";

const WIKI_HEADERS = { "User-Agent": USER_AGENT } as const;

export type WikipediaFeaturedThumbnail = {
  source: string;
  width: number;
  height: number;
};

export type WikipediaFeaturedArticle = {
  title: string;
  extract: string;
  thumbnail?: WikipediaFeaturedThumbnail;
  featuredDate: string | null;
  wikiPageId?: string;
};

export type WikipediaTrendingArticle = {
  title: string;
  extract: string;
  views: number;
  thumbnail?: WikipediaFeaturedThumbnail;
};

type FeaturedFeedArticlePayload = {
  titles?: { normalized?: string };
  title?: string;
  extract?: string;
  thumbnail?: WikipediaFeaturedThumbnail;
  timestamp?: string | null;
  views?: number;
  pageid?: number | string;
};

type FeaturedFeedPayload = {
  tfa?: FeaturedFeedArticlePayload;
  mostread?: {
    articles?: FeaturedFeedArticlePayload[];
    date?: string | null;
  };
};

export type WikipediaFeaturedSnapshot = {
  tfa: WikipediaFeaturedArticle | null;
  trendingCandidates: WikipediaTrendingArticle[];
  trendingDate: string | null;
  trendingSource: string | null;
  feedDate: string;
  feedDateIso: string;
};

export const getWikipediaFeaturedFeedDate = (
  daysAgo = 0,
  now = new Date(),
): string => {
  const d = new Date(now);
  d.setUTCDate(d.getUTCDate() - daysAgo);
  return `${d.getUTCFullYear()}/${String(d.getUTCMonth() + 1).padStart(2, "0")}/${String(d.getUTCDate()).padStart(2, "0")}`;
};

const toFeaturedArticle = (
  article?: FeaturedFeedArticlePayload,
): WikipediaFeaturedArticle | null =>
  article
    ? {
        title: (article.titles?.normalized ?? article.title ?? "") as string,
        extract: (article.extract ?? "") as string,
        thumbnail: article.thumbnail,
        featuredDate: (article.timestamp ?? null) as string | null,
        wikiPageId:
          article.pageid != null ? String(article.pageid) : undefined,
      }
    : null;

const toTrendingArticle = (
  article: FeaturedFeedArticlePayload,
): WikipediaTrendingArticle => ({
  title: (article.titles?.normalized ?? article.title ?? "") as string,
  extract: (article.extract ?? "") as string,
  views: (article.views ?? 0) as number,
  thumbnail: article.thumbnail,
});

const fetchFeaturedFeedPayload = async (
  feedDate: string,
): Promise<FeaturedFeedPayload> => {
  const res = await fetch(`${WIKI_FEATURED_API}/${feedDate}`, {
    headers: WIKI_HEADERS,
  });

  if (!res.ok) {
    throw new Error(`Wikipedia feed returned ${res.status} for ${feedDate}`);
  }

  return (await res.json()) as FeaturedFeedPayload;
};

export const fetchWikipediaFeaturedSnapshot = async (
  now = new Date(),
): Promise<WikipediaFeaturedSnapshot> => {
  const feedDate = getWikipediaFeaturedFeedDate(0, now);
  const todayData = await fetchFeaturedFeedPayload(feedDate);

  let mostRead = todayData.mostread?.articles ?? [];
  let trendingDate = todayData.mostread?.date ?? null;
  let trendingSource: string | null = mostRead.length > 0 ? feedDate : null;

  for (let daysAgo = 1; mostRead.length === 0 && daysAgo <= 4; daysAgo++) {
    const fallbackDate = getWikipediaFeaturedFeedDate(daysAgo, now);
    try {
      const fallbackData = await fetchFeaturedFeedPayload(fallbackDate);
      mostRead = fallbackData.mostread?.articles ?? [];
      trendingDate = fallbackData.mostread?.date ?? trendingDate;
      if (mostRead.length > 0) trendingSource = fallbackDate;
    } catch {
      // Fall through to the next fallback date.
    }
  }

  return {
    tfa: toFeaturedArticle(todayData.tfa),
    trendingCandidates: mostRead.map(toTrendingArticle),
    trendingDate,
    trendingSource,
    feedDate,
    feedDateIso: feedDate.replace(/\//g, "-"),
  };
};

export const fetchCurrentFeaturedArticle = async (
  now = new Date(),
): Promise<{
  tfa: WikipediaFeaturedArticle | null;
  feedDate: string;
  feedDateIso: string;
}> => {
  const snapshot = await fetchWikipediaFeaturedSnapshot(now);
  return {
    tfa: snapshot.tfa,
    feedDate: snapshot.feedDate,
    feedDateIso: snapshot.feedDateIso,
  };
};
