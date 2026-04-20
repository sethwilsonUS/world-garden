const WIKI_FEATURED_API = "https://en.wikipedia.org/api/rest_v1/feed/featured";
const WIKI_ACTION_API = "https://en.wikipedia.org/w/api.php";
const WIKI_PAGEVIEWS_TOP_API =
  "https://wikimedia.org/api/rest_v1/metrics/pageviews/top/en.wikipedia/all-access";
const USER_AGENT =
  "CurioGarden/1.0 (https://curiogarden.org; accessibility-first Wikipedia audio reader)";

const WIKI_HEADERS = { "User-Agent": USER_AGENT } as const;
const MAX_MOST_READ_STALE_DAYS = 2;
const PAGEVIEWS_LOOKBACK_DAYS = 7;
const PAGEVIEWS_CANDIDATE_LIMIT = 80;
const TRENDING_ARTICLE_LIMIT = 50;

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

export type WikipediaDidYouKnowLink = {
  title: string;
  slug: string;
  text: string;
};

export type WikipediaDidYouKnowSegment =
  | {
      type: "text";
      text: string;
    }
  | {
      type: "link";
      text: string;
      title: string;
      slug: string;
    };

export type WikipediaDidYouKnowItem = {
  text: string;
  links: WikipediaDidYouKnowLink[];
  segments: WikipediaDidYouKnowSegment[];
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

type DidYouKnowPayload = {
  html?: string;
  text?: string;
};

type FeaturedFeedPayload = {
  tfa?: FeaturedFeedArticlePayload;
  mostread?: {
    articles?: FeaturedFeedArticlePayload[];
    date?: string | null;
  };
  dyk?: DidYouKnowPayload[];
};

export type WikipediaFeaturedSnapshot = {
  tfa: WikipediaFeaturedArticle | null;
  trendingCandidates: WikipediaTrendingArticle[];
  didYouKnow: WikipediaDidYouKnowItem[];
  trendingDate: string | null;
  trendingSource: string | null;
  trendingSourceType: "featured-feed" | "pageviews-top" | null;
  trendingIsStale: boolean;
  feedDate: string;
  feedDateIso: string;
};

type PageviewsTopPayload = {
  items?: Array<{
    year?: string;
    month?: string;
    day?: string;
    articles?: Array<{
      article?: string;
      views?: number;
      rank?: number;
    }>;
  }>;
};

export const getWikipediaFeaturedFeedDate = (
  daysAgo = 0,
  now = new Date(),
): string => {
  const d = new Date(now);
  d.setUTCDate(d.getUTCDate() - daysAgo);
  return `${d.getUTCFullYear()}/${String(d.getUTCMonth() + 1).padStart(2, "0")}/${String(d.getUTCDate()).padStart(2, "0")}`;
};

const getDateFromFeedPath = (feedDate: string): Date | null => {
  const match = feedDate.match(/^(\d{4})\/(\d{2})\/(\d{2})$/);
  if (!match) return null;

  return new Date(
    Date.UTC(Number(match[1]), Number(match[2]) - 1, Number(match[3])),
  );
};

const getDateFromTrendingDate = (trendingDate: string | null): Date | null => {
  if (!trendingDate) return null;
  const match = trendingDate.match(/^(\d{4})-(\d{2})-(\d{2})Z?$/);
  if (!match) return null;

  return new Date(
    Date.UTC(Number(match[1]), Number(match[2]) - 1, Number(match[3])),
  );
};

const getDaysBetweenUtcDates = (left: Date, right: Date): number =>
  Math.round((left.getTime() - right.getTime()) / 86_400_000);

const getUtcDateOnly = (date: Date): Date =>
  new Date(
    Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate()),
  );

export const isMostReadDateStale = ({
  feedDate,
  trendingDate,
}: {
  feedDate: string;
  trendingDate: string | null;
}): boolean => {
  const feed = getDateFromFeedPath(feedDate);
  const trending = getDateFromTrendingDate(trendingDate);
  if (!feed || !trending) return true;

  return getDaysBetweenUtcDates(feed, trending) > MAX_MOST_READ_STALE_DAYS;
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

const formatPageviewsDate = (date: Date): string =>
  `${date.getUTCFullYear()}/${String(date.getUTCMonth() + 1).padStart(2, "0")}/${String(date.getUTCDate()).padStart(2, "0")}`;

const toTrendingDateFromPageviews = (date: Date): string =>
  `${date.getUTCFullYear()}-${String(date.getUTCMonth() + 1).padStart(2, "0")}-${String(date.getUTCDate()).padStart(2, "0")}Z`;

const normalizeArticleTitle = (title: string): string =>
  title.replace(/_/g, " ").trim();

const normalizeTitleKey = (title: string): string =>
  normalizeArticleTitle(title).toLowerCase();

const BLOCKED_PAGEVIEWS_TITLES = new Set(["Main Page"]);
const BLOCKED_PAGEVIEWS_PREFIXES = [
  "Category:",
  "File:",
  "Help:",
  "Portal:",
  "Special:",
  "Template:",
  "Wikipedia:",
] as const;

const isPageviewsArticleCandidate = (title: string): boolean => {
  const normalized = normalizeArticleTitle(title);
  if (!normalized || BLOCKED_PAGEVIEWS_TITLES.has(normalized)) return false;
  return !BLOCKED_PAGEVIEWS_PREFIXES.some((prefix) =>
    normalized.startsWith(prefix),
  );
};

const fetchPageviewsTopPayload = async (
  date: Date,
): Promise<PageviewsTopPayload | null> => {
  const res = await fetch(`${WIKI_PAGEVIEWS_TOP_API}/${formatPageviewsDate(date)}`, {
    headers: WIKI_HEADERS,
  });

  if (res.status === 404) return null;
  if (!res.ok) {
    throw new Error(
      `Wikipedia pageviews top returned ${res.status} for ${formatPageviewsDate(date)}`,
    );
  }

  return (await res.json()) as PageviewsTopPayload;
};

const fetchTrendingArticleDetails = async (
  titles: string[],
): Promise<Map<string, FeaturedFeedArticlePayload>> => {
  const details = new Map<string, FeaturedFeedArticlePayload>();
  const batchSize = 20;

  for (let i = 0; i < titles.length; i += batchSize) {
    const batch = titles.slice(i, i + batchSize);
    const params = new URLSearchParams({
      action: "query",
      format: "json",
      titles: batch.join("|"),
      prop: "extracts|pageimages|info",
      exintro: "1",
      explaintext: "1",
      inprop: "url",
      piprop: "thumbnail",
      pithumbsize: "800",
      redirects: "1",
      origin: "*",
    });

    const res = await fetch(`${WIKI_ACTION_API}?${params}`, {
      headers: WIKI_HEADERS,
    });
    if (!res.ok) {
      throw new Error(`Wikipedia page detail fetch returned ${res.status}`);
    }

    const data = await res.json();
    const pages =
      (data.query?.pages as Record<
        string,
        FeaturedFeedArticlePayload & { missing?: unknown; ns?: number }
      >) ?? {};

    for (const page of Object.values(pages)) {
      if (page.missing !== undefined || page.ns !== 0 || !page.title) {
        continue;
      }
      details.set(normalizeTitleKey(page.title), page);
    }
  }

  return details;
};

const fetchPageviewsTrendingArticles = async (
  now: Date,
  currentTrendingDate: string | null,
): Promise<{
  articles: WikipediaTrendingArticle[];
  trendingDate: string;
  source: string;
} | null> => {
  const currentDate = getDateFromTrendingDate(currentTrendingDate);

  for (let daysAgo = 1; daysAgo <= PAGEVIEWS_LOOKBACK_DAYS; daysAgo++) {
    const date = getUtcDateOnly(now);
    date.setUTCDate(date.getUTCDate() - daysAgo);
    if (currentDate && date <= currentDate) return null;

    const payload = await fetchPageviewsTopPayload(date);
    const item = payload?.items?.[0];
    const rawArticles = item?.articles ?? [];
    if (rawArticles.length === 0) continue;

    const candidates = rawArticles
      .map((article) => ({
        title: normalizeArticleTitle(article.article ?? ""),
        views: article.views ?? 0,
      }))
      .filter((article) => isPageviewsArticleCandidate(article.title))
      .slice(0, PAGEVIEWS_CANDIDATE_LIMIT);

    const details = await fetchTrendingArticleDetails(
      candidates.map((article) => article.title),
    );

    const articles = candidates
      .map((article) => {
        const detail = details.get(normalizeTitleKey(article.title));
        if (!detail) return null;
        return toTrendingArticle({
          ...detail,
          views: article.views,
        });
      })
      .filter((article): article is WikipediaTrendingArticle => article !== null)
      .slice(0, TRENDING_ARTICLE_LIMIT);

    if (articles.length > 0) {
      return {
        articles,
        trendingDate: toTrendingDateFromPageviews(date),
        source: `pageviews-top:${formatPageviewsDate(date)}`,
      };
    }
  }

  return null;
};

const ARTICLE_PATH_PREFIX = "/wiki/";
const BLOCKED_DYK_PREFIXES = [
  "Category:",
  "File:",
  "Help:",
  "Portal:",
  "Special:",
  "Template:",
  "Template_talk:",
  "Wikipedia:",
] as const;

const decodeHtmlEntities = (value: string): string =>
  value
    .replace(/&#(\d+);/g, (_, dec) =>
      String.fromCodePoint(Number.parseInt(dec, 10)),
    )
    .replace(/&#x([0-9a-f]+);/gi, (_, hex) =>
      String.fromCodePoint(Number.parseInt(hex, 16)),
    )
    .replace(/&nbsp;/gi, " ")
    .replace(/&amp;/gi, "&")
    .replace(/&quot;/gi, '"')
    .replace(/&apos;|&#39;/gi, "'")
    .replace(/&lt;/gi, "<")
    .replace(/&gt;/gi, ">");

const stripTags = (value: string): string => value.replace(/<[^>]+>/g, "");

const normalizeHtmlText = (value: string): string =>
  decodeHtmlEntities(stripTags(value).replace(/\s+/g, " "));

const appendTextSegment = (
  segments: WikipediaDidYouKnowSegment[],
  text: string,
) => {
  if (text.length === 0) return;

  const previous = segments[segments.length - 1];
  if (previous?.type === "text") {
    previous.text += text;
    return;
  }

  segments.push({ type: "text", text });
};

const toDidYouKnowLink = (
  href: string,
  text: string,
): WikipediaDidYouKnowLink | null => {
  try {
    const url = new URL(decodeHtmlEntities(href), "https://en.wikipedia.org");

    if (url.origin !== "https://en.wikipedia.org") return null;
    if (!url.pathname.startsWith(ARTICLE_PATH_PREFIX)) return null;

    const slug = decodeURIComponent(url.pathname.slice(ARTICLE_PATH_PREFIX.length));
    if (!slug) return null;
    if (BLOCKED_DYK_PREFIXES.some((prefix) => slug.startsWith(prefix))) {
      return null;
    }

    return {
      title: slug.replace(/_/g, " "),
      slug,
      text,
    };
  } catch {
    return null;
  }
};

export const parseDidYouKnowItem = (
  item: DidYouKnowPayload,
): WikipediaDidYouKnowItem | null => {
  const fallbackText = normalizeHtmlText(item.text ?? "").trim();
  const html = item.html ?? "";

  if (!html && !fallbackText) return null;
  if (!html) {
    return {
      text: fallbackText,
      links: [],
      segments: fallbackText ? [{ type: "text", text: fallbackText }] : [],
    };
  }

  const segments: WikipediaDidYouKnowSegment[] = [];
  const links: WikipediaDidYouKnowLink[] = [];
  const anchorRe = /<a\b[^>]*href=(["'])(.*?)\1[^>]*>([\s\S]*?)<\/a>/gi;

  let lastIndex = 0;
  for (const match of html.matchAll(anchorRe)) {
    const [fullMatch, , href, innerHtml] = match;
    const matchIndex = match.index ?? 0;

    appendTextSegment(segments, normalizeHtmlText(html.slice(lastIndex, matchIndex)));

    const linkText = normalizeHtmlText(innerHtml).trim();
    const link = linkText ? toDidYouKnowLink(href, linkText) : null;

    if (link) {
      links.push(link);
      segments.push({
        type: "link",
        text: link.text,
        title: link.title,
        slug: link.slug,
      });
    } else {
      appendTextSegment(segments, linkText);
    }

    lastIndex = matchIndex + fullMatch.length;
  }

  appendTextSegment(segments, normalizeHtmlText(html.slice(lastIndex)));

  const text = segments.map((segment) => segment.text).join("").trim() || fallbackText;
  if (!text) return null;

  return {
    text,
    links,
    segments:
      segments.length > 0 ? segments : [{ type: "text", text }],
  };
};

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
  let trendingSourceType: WikipediaFeaturedSnapshot["trendingSourceType"] =
    mostRead.length > 0 ? "featured-feed" : null;

  for (let daysAgo = 1; mostRead.length === 0 && daysAgo <= 4; daysAgo++) {
    const fallbackDate = getWikipediaFeaturedFeedDate(daysAgo, now);
    try {
      const fallbackData = await fetchFeaturedFeedPayload(fallbackDate);
      mostRead = fallbackData.mostread?.articles ?? [];
      trendingDate = fallbackData.mostread?.date ?? trendingDate;
      if (mostRead.length > 0) {
        trendingSource = fallbackDate;
        trendingSourceType = "featured-feed";
      }
    } catch {
      // Fall through to the next fallback date.
    }
  }

  if (isMostReadDateStale({ feedDate, trendingDate })) {
    try {
      const pageviewsFallback = await fetchPageviewsTrendingArticles(
        now,
        trendingDate,
      );
      if (pageviewsFallback) {
        mostRead = pageviewsFallback.articles;
        trendingDate = pageviewsFallback.trendingDate;
        trendingSource = pageviewsFallback.source;
        trendingSourceType = "pageviews-top";
      }
    } catch (error) {
      console.warn(
        `[/api/featured] pageviews fallback failed: ${error instanceof Error ? error.message : String(error)}`,
      );
    }
  }

  const trendingIsStale = isMostReadDateStale({ feedDate, trendingDate });

  return {
    tfa: toFeaturedArticle(todayData.tfa),
    trendingCandidates: mostRead.map(toTrendingArticle),
    didYouKnow: (todayData.dyk ?? [])
      .map(parseDidYouKnowItem)
      .filter((item): item is WikipediaDidYouKnowItem => item !== null),
    trendingDate,
    trendingSource,
    trendingSourceType,
    trendingIsStale,
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
