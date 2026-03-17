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
    didYouKnow: (todayData.dyk ?? [])
      .map(parseDidYouKnowItem)
      .filter((item): item is WikipediaDidYouKnowItem => item !== null),
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
