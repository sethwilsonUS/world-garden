import type { TodayWikipediaData } from "@/lib/today-snapshot";

export const HOMEPAGE_PREVIEW_LIMITS = {
  didYouKnowItems: 3,
  newsItems: 2,
  articleLinksPerItem: 3,
  trendingArticles: 4,
  warmedArticles: 30,
} as const;

export type HomepageArticleSource =
  | "featured"
  | "did-you-know"
  | "news"
  | "on-this-day"
  | "trending";

export type HomepageArticleRef = {
  slug: string;
  title: string;
  wikiPageId?: string;
  source: HomepageArticleSource;
};

export type HomepageArticleCollection = {
  articles: HomepageArticleRef[];
  capped: number;
};

const toArticleSlug = (title: string): string => title.trim().replace(/ /g, "_");

const normalizeSlug = (slug: string): string => {
  try {
    return decodeURIComponent(slug).replace(/ /g, "_").trim().toLowerCase();
  } catch {
    return slug.replace(/ /g, "_").trim().toLowerCase();
  }
};

const fromLink = (
  link: { title: string; slug: string; wikiPageId?: string },
  source: HomepageArticleSource,
): HomepageArticleRef => ({
  slug: link.slug || toArticleSlug(link.title),
  title: link.title || link.slug.replace(/_/g, " "),
  ...(link.wikiPageId ? { wikiPageId: link.wikiPageId } : {}),
  source,
});

export const collectHomepageArticleRefs = (
  data: TodayWikipediaData,
  maxArticles: number = HOMEPAGE_PREVIEW_LIMITS.warmedArticles,
): HomepageArticleCollection => {
  const initiallyVisible: HomepageArticleRef[] = [];
  const expandable: HomepageArticleRef[] = [];
  const linkLimit = HOMEPAGE_PREVIEW_LIMITS.articleLinksPerItem;

  if (data.tfa?.title) {
    initiallyVisible.push({
      slug: toArticleSlug(data.tfa.title),
      title: data.tfa.title,
      ...(data.tfa.wikiPageId ? { wikiPageId: data.tfa.wikiPageId } : {}),
      source: "featured",
    });
  }

  data.didYouKnow.forEach((item, itemIndex) => {
    const target =
      itemIndex < HOMEPAGE_PREVIEW_LIMITS.didYouKnowItems
        ? initiallyVisible
        : expandable;
    target.push(
      ...item.links
        .slice(0, linkLimit)
        .map((link) => fromLink(link, "did-you-know")),
    );
  });

  data.inTheNews.forEach((item, itemIndex) => {
    const target =
      itemIndex < HOMEPAGE_PREVIEW_LIMITS.newsItems
        ? initiallyVisible
        : expandable;
    target.push(
      ...item.links.slice(0, linkLimit).map((link) => fromLink(link, "news")),
    );
  });

  const firstOnThisDay = data.onThisDay[0];
  if (firstOnThisDay) {
    initiallyVisible.push(
      ...firstOnThisDay.pages
        .slice(0, linkLimit)
        .map((link) => fromLink(link, "on-this-day")),
    );
  }

  initiallyVisible.push(
    ...data.trending
      .slice(0, HOMEPAGE_PREVIEW_LIMITS.trendingArticles)
      .filter((article) => Boolean(article.title))
      .map((article) => ({
        slug: toArticleSlug(article.title),
        title: article.title,
        source: "trending" as const,
      })),
  );

  const deduplicated: HomepageArticleRef[] = [];
  const seenPageIds = new Set<string>();
  const seenSlugs = new Set<string>();
  for (const article of [...initiallyVisible, ...expandable]) {
    const pageId = article.wikiPageId?.trim();
    const slug = normalizeSlug(article.slug);
    if (
      !slug ||
      !article.title.trim() ||
      (pageId && seenPageIds.has(pageId)) ||
      seenSlugs.has(slug)
    ) {
      continue;
    }
    if (pageId) seenPageIds.add(pageId);
    seenSlugs.add(slug);
    deduplicated.push(article);
  }

  const safeMax = Math.max(
    1,
    Math.min(HOMEPAGE_PREVIEW_LIMITS.warmedArticles, Math.floor(maxArticles)),
  );

  return {
    articles: deduplicated.slice(0, safeMax),
    capped: Math.max(0, deduplicated.length - safeMax),
  };
};
