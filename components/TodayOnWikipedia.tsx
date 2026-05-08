"use client";

import Image from "next/image";
import Link from "next/link";
import { useEffect, useState } from "react";
import { AudioPlayer } from "@/components/AudioPlayer";
import { DailyTrendingBriefPlayer } from "@/components/DailyTrendingBriefPlayer";
import { usePlaybackRate } from "@/hooks/usePlaybackRate";

type FeedArticleLink = {
  title: string;
  slug: string;
  wikiPageId?: string;
};

type FeaturedArticle = {
  title: string;
  extract: string;
  thumbnail?: { source: string; width: number; height: number };
  featuredDate?: string | null;
  feedDate?: string | null;
};

type TrendingArticle = {
  title: string;
  extract: string;
  views: number;
  thumbnail?: { source: string; width: number; height: number };
};

type TrendingBrief = {
  audioUrl: string;
  headline?: string;
  durationSeconds?: number;
};

type InTheNewsItem = {
  story: string;
  links: FeedArticleLink[];
};

type OnThisDayItem = {
  year?: number;
  text: string;
  pages: FeedArticleLink[];
};

type PictureAudio = {
  status: "missing" | "pending" | "ready" | "failed";
  audioUrl: string | null;
  durationSeconds?: number;
  lastError?: string;
};

type PictureOfDay = {
  title: string;
  pictureKey: string;
  altText: string;
  description: string;
  thumbnail?: { source: string; width: number; height: number };
  image?: { source: string; width: number; height: number };
  filePage?: string;
  artist?: string;
  credit?: string;
  license?: { type?: string; url?: string };
  audio?: PictureAudio;
};

export type TodayOnWikipediaData = {
  tfa?: FeaturedArticle | null;
  feedDate?: string | null;
  trending?: TrendingArticle[];
  trendingDate?: string | null;
  trendingBrief?: TrendingBrief | null;
  inTheNews?: InTheNewsItem[];
  pictureOfDay?: PictureOfDay | null;
  onThisDay?: OnThisDayItem[];
};

const MAX_NEWS_ITEMS = 3;
const MAX_TRENDING_ARTICLES = 8;

const toArticleSlug = (title: string) => title.replace(/ /g, "_");
const toArticleHref = (titleOrSlug: string) =>
  `/article/${encodeURIComponent(titleOrSlug)}`;

const truncate = (text: string, max: number): string =>
  text.length > max
    ? text.slice(0, max).replace(/\s+\S*$/, "") + "\u2026"
    : text;

function formatFeaturedDate(isoDate: string | null | undefined): string {
  if (!isoDate) return "";
  try {
    const d = new Date(isoDate);
    if (Number.isNaN(d.getTime())) return "";
    return d.toLocaleString(undefined, {
      month: "short",
      day: "numeric",
      year: "numeric",
      hour: "numeric",
      minute: "2-digit",
    });
  } catch {
    return "";
  }
}

function formatFeedDate(isoDate: string | null | undefined): string {
  if (!isoDate) return "";
  try {
    const d = new Date(`${isoDate}T12:00:00Z`);
    if (Number.isNaN(d.getTime())) return "";
    return d.toLocaleDateString(undefined, {
      month: "short",
      day: "numeric",
      year: "numeric",
    });
  } catch {
    return "";
  }
}

function formatTrendingDate(isoDate: string | null | undefined): string {
  if (!isoDate) return "";
  try {
    const normalized =
      /^\d{4}-\d{2}-\d{2}Z?$/.test(isoDate) && !isoDate.includes("T")
        ? `${isoDate.slice(0, 10)}T12:00:00Z`
        : isoDate;
    const d = new Date(normalized);
    if (Number.isNaN(d.getTime())) return "";
    return d.toLocaleDateString(undefined, {
      month: "short",
      day: "numeric",
      year: "numeric",
    });
  } catch {
    return "";
  }
}

const formatViews = (views: number): string => {
  if (views >= 1_000_000) return `${(views / 1_000_000).toFixed(1)} million`;
  if (views >= 1_000) return `${Math.round(views / 1_000)} thousand`;
  return views.toLocaleString();
};

const ArticleLinkList = ({ links }: { links: FeedArticleLink[] }) => {
  if (links.length === 0) return null;

  return (
    <ul className="m-0 mt-3 flex list-none flex-wrap gap-2 p-0" role="list">
      {links.slice(0, 3).map((link) => (
        <li key={`${link.wikiPageId ?? link.slug}-${link.title}`}>
          <Link
            href={toArticleHref(link.slug)}
            className="inline-flex items-center rounded-full border border-accent-border bg-accent-bg px-3 py-1 text-xs font-medium text-accent no-underline"
          >
            {link.title}
          </Link>
        </li>
      ))}
    </ul>
  );
};

const FeaturedArticleCard = ({
  article,
  feedDate,
}: {
  article?: FeaturedArticle | null;
  feedDate?: string | null;
}) => {
  if (!article) return null;

  const slug = toArticleSlug(article.title);
  const dateLabel =
    formatFeaturedDate(article.featuredDate) || formatFeedDate(article.feedDate ?? feedDate);

  return (
    <article className="overflow-hidden rounded-2xl border border-border bg-surface-2 transition-all duration-200">
      <Link href={toArticleHref(slug)} className="result-link block no-underline">
        <div className={article.thumbnail ? "grid gap-0 sm:grid-cols-[150px_minmax(0,1fr)]" : ""}>
          {article.thumbnail && (
            <div className="relative aspect-[16/9] overflow-hidden bg-surface-3 sm:aspect-auto sm:min-h-[148px]">
              <Image
                src={article.thumbnail.source}
                alt=""
                fill
                sizes="(min-width: 1024px) 150px, 100vw"
                className="object-cover"
                priority
                unoptimized
              />
            </div>
          )}
          <div className="min-w-0 px-5 py-4">
            <p className="m-0 text-xs font-semibold uppercase tracking-[0.16em] text-muted">
              Featured article
            </p>
            <h3 className="mt-2 font-display text-[1.05rem] font-bold leading-[1.3] text-foreground">
              {article.title}
            </h3>
            <p className="mt-2 text-sm leading-[1.65] text-foreground-2">
              {truncate(article.extract, 220)}
            </p>
            {dateLabel && (
              <p className="mt-3 text-xs text-muted" aria-live="polite">
                Last updated: {dateLabel}
              </p>
            )}
          </div>
        </div>
      </Link>
    </article>
  );
};

const NewsCard = ({ news }: { news: InTheNewsItem[] }) => (
  <section
    aria-labelledby="today-news-heading"
    className="rounded-2xl border border-border bg-surface-2 px-5 py-4"
  >
    <h3
      id="today-news-heading"
      className="font-display text-base font-semibold text-foreground"
    >
      In the News
    </h3>

    {news.length > 0 ? (
      <ul className="m-0 mt-3 list-none space-y-4 p-0" role="list">
        {news.slice(0, MAX_NEWS_ITEMS).map((item, index) => (
          <li key={`${index}-${item.story}`}>
            <p className="text-sm leading-[1.7] text-foreground-2">
              {item.story}
            </p>
            <ArticleLinkList links={item.links} />
          </li>
        ))}
      </ul>
    ) : (
      <p className="mt-3 text-sm text-muted" role="status">
        No news items are available right now.
      </p>
    )}
  </section>
);

const OnThisDayCard = ({ item }: { item?: OnThisDayItem }) => {
  if (!item) return null;

  return (
    <aside className="rounded-2xl border border-border bg-surface-2 px-5 py-4">
      <p className="text-xs font-semibold uppercase tracking-[0.16em] text-muted">
        On This Day
      </p>
      <p className="mt-2 text-sm leading-[1.7] text-foreground-2">
        {item.year ? (
          <span className="font-semibold text-foreground">{item.year}: </span>
        ) : null}
        {item.text}
      </p>
      <ArticleLinkList links={item.pages} />
    </aside>
  );
};

const TrendingArticles = ({
  articles,
  trendingDate,
}: {
  articles: TrendingArticle[];
  trendingDate?: string | null;
}) => {
  if (articles.length === 0) return null;

  const dateLabel = formatTrendingDate(trendingDate);

  return (
    <section aria-labelledby="today-trending-heading" className="lg:col-span-2">
      <div className="mb-3 flex flex-wrap items-end justify-between gap-2">
        <div>
          <p className="m-0 text-xs font-semibold uppercase tracking-[0.16em] text-muted">
            Trending
          </p>
          <h3
            id="today-trending-heading"
            className="mt-1 font-display text-base font-semibold text-foreground"
          >
            What people are curious about
          </h3>
        </div>
        {dateLabel && (
          <p className="text-xs text-muted" aria-live="polite">
            Last updated: {dateLabel}
          </p>
        )}
      </div>

      <ol
        className="m-0 grid list-none grid-cols-1 gap-3 p-0 sm:grid-cols-2 lg:grid-cols-4"
        role="list"
      >
        {articles.slice(0, MAX_TRENDING_ARTICLES).map((article, index) => {
          const slug = toArticleSlug(article.title);
          return (
            <li key={article.title}>
              <Link
                href={toArticleHref(slug)}
                className="result-link flex h-full flex-col overflow-hidden rounded-2xl border border-border bg-surface-2 no-underline transition-all duration-200"
              >
                {article.thumbnail ? (
                  <span
                    className="relative block aspect-[16/9] overflow-hidden bg-surface-3"
                    aria-hidden="true"
                  >
                    <Image
                      src={article.thumbnail.source}
                      alt=""
                      fill
                      sizes="(min-width: 1024px) 25vw, (min-width: 640px) 50vw, 100vw"
                      className="object-cover"
                      unoptimized
                    />
                  </span>
                ) : (
                  <span
                    className="flex aspect-[16/9] items-center justify-center bg-surface-3 text-muted opacity-40"
                    aria-hidden="true"
                  >
                    <svg
                      viewBox="0 0 24 24"
                      fill="none"
                      stroke="currentColor"
                      strokeWidth={1}
                      strokeLinecap="round"
                      strokeLinejoin="round"
                      width={32}
                      height={32}
                    >
                      <rect x="3" y="3" width="18" height="18" rx="2" ry="2" />
                      <circle cx="8.5" cy="8.5" r="1.5" />
                      <polyline points="21 15 16 10 5 21" />
                    </svg>
                  </span>
                )}
                <span className="flex flex-1 flex-col px-4 py-3">
                  <span className="text-xs font-semibold text-accent">
                    #{index + 1}
                  </span>
                  <span className="mt-2 font-display text-[0.9375rem] font-bold leading-[1.3] text-foreground">
                    {article.title}
                  </span>
                  <span className="mt-1 text-[0.8125rem] leading-[1.5] text-muted">
                    {truncate(article.extract, 120)}
                  </span>
                  {article.views > 0 && (
                    <span className="mt-2 text-[0.6875rem] text-muted opacity-75">
                      {formatViews(article.views)} views yesterday
                    </span>
                  )}
                </span>
              </Link>
            </li>
          );
        })}
      </ol>

      <div className="mt-3 text-center">
        <Link
          href="/trending"
          className="inline-flex items-center gap-1.5 text-sm font-medium text-accent no-underline transition-colors duration-200"
        >
          See all trending articles
          <svg
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth={2}
            strokeLinecap="round"
            strokeLinejoin="round"
            width={14}
            height={14}
            aria-hidden="true"
          >
            <path d="M5 12h14" />
            <path d="M12 5l7 7-7 7" />
          </svg>
        </Link>
      </div>
    </section>
  );
};

const PictureAudioStatus = ({ audio }: { audio?: PictureAudio }) => {
  const { rate, setRate } = usePlaybackRate();

  if (!audio) return null;

  if (audio.status === "ready" && audio.audioUrl) {
    return (
      <AudioPlayer
        audioUrl={audio.audioUrl}
        title="Picture of the Day description"
        label="Listen: Picture of the Day description"
        playbackRate={rate}
        onPlaybackRateChange={setRate}
        variant="compact"
        className="mt-4 max-w-full"
      />
    );
  }

  if (audio.status === "pending") {
    return (
      <p className="mt-4 text-sm text-muted" role="status" aria-live="polite">
        Picture audio is being prepared.
      </p>
    );
  }

  if (audio.status === "failed") {
    return (
      <p className="mt-4 text-sm text-muted" role="status" aria-live="polite">
        Picture audio is not available right now.
      </p>
    );
  }

  return null;
};

const PictureOfDayFigure = ({ picture }: { picture: PictureOfDay }) => {
  const image = picture.thumbnail ?? picture.image;

  return (
    <figure className="m-0 overflow-hidden rounded-2xl border border-border bg-surface-2">
      {image && (
        <div className="relative aspect-[16/10] overflow-hidden bg-surface-3">
          <Image
            src={image.source}
            alt={picture.altText || "Wikipedia picture of the day"}
            fill
            sizes="(min-width: 1024px) 38vw, 100vw"
            className="object-cover"
            unoptimized
          />
        </div>
      )}

      <figcaption className="px-5 py-4">
        <p className="text-xs font-semibold uppercase tracking-[0.16em] text-muted">
          Picture of the Day
        </p>
        <p className="mt-2 text-sm leading-[1.7] text-foreground-2">
          {picture.description || picture.title}
        </p>

        <dl className="mt-3 grid gap-1 text-xs leading-[1.6] text-muted">
          {picture.artist && (
            <div>
              <dt className="inline font-semibold text-foreground-2">
                Artist:{" "}
              </dt>
              <dd className="inline">{picture.artist}</dd>
            </div>
          )}
          {picture.credit && (
            <div>
              <dt className="inline font-semibold text-foreground-2">
                Credit:{" "}
              </dt>
              <dd className="inline">{picture.credit}</dd>
            </div>
          )}
          {picture.license?.type && (
            <div>
              <dt className="inline font-semibold text-foreground-2">
                License:{" "}
              </dt>
              <dd className="inline">
                {picture.license.url ? (
                  <a
                    href={picture.license.url}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="text-accent underline"
                  >
                    {picture.license.type}
                    <span className="sr-only"> (opens in new tab)</span>
                  </a>
                ) : (
                  picture.license.type
                )}
              </dd>
            </div>
          )}
        </dl>

        {picture.filePage && (
          <a
            href={picture.filePage}
            target="_blank"
            rel="noopener noreferrer"
            className="mt-3 inline-flex text-xs font-medium text-accent underline"
          >
            View on Wikimedia Commons
            <span className="sr-only"> (opens in new tab)</span>
          </a>
        )}

        <PictureAudioStatus audio={picture.audio} />
      </figcaption>
    </figure>
  );
};

export const TodayOnWikipediaContent = ({
  data,
}: {
  data: TodayOnWikipediaData;
}) => {
  const featured = data.tfa ?? null;
  const news = data.inTheNews ?? [];
  const trending = data.trending ?? [];
  const onThisDay = data.onThisDay ?? [];
  const picture = data.pictureOfDay ?? null;
  const trendingBrief = data.trendingBrief ?? null;

  if (
    !featured &&
    news.length === 0 &&
    trending.length === 0 &&
    !picture &&
    onThisDay.length === 0 &&
    !trendingBrief
  ) {
    return null;
  }

  const firstOnThisDay = onThisDay[0];
  const hasSideColumn = Boolean(picture || trendingBrief);

  return (
    <section aria-labelledby="today-wikipedia-heading" className="mt-12">
      <div className="mb-5 text-center">
        <h2
          id="today-wikipedia-heading"
          className="font-display text-lg font-semibold text-foreground"
        >
          Today on Wikipedia
        </h2>
        <p className="mt-1 text-xs text-muted">
          In the News is editor-curated; Trending is pageview-driven and AI-briefed.
        </p>
      </div>

      <div className="grid gap-4 lg:grid-cols-[minmax(0,1fr)_minmax(300px,0.82fr)]">
        <div className={`space-y-4 ${hasSideColumn ? "" : "lg:col-span-2"}`}>
          <FeaturedArticleCard article={featured} feedDate={data.feedDate} />
          <NewsCard news={news} />
          <OnThisDayCard item={firstOnThisDay} />
        </div>

        {hasSideColumn && (
          <div className="space-y-4">
            {picture && <PictureOfDayFigure picture={picture} />}
            {trendingBrief && (
              <DailyTrendingBriefPlayer
                audioUrl={trendingBrief.audioUrl}
                title={trendingBrief.headline || "Why these topics are trending today"}
                durationSeconds={trendingBrief.durationSeconds}
              />
            )}
          </div>
        )}

        <TrendingArticles
          articles={trending}
          trendingDate={data.trendingDate}
        />
      </div>
    </section>
  );
};

export const TodayOnWikipedia = () => {
  const [data, setData] = useState<TodayOnWikipediaData | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let cancelled = false;

    (async () => {
      try {
        const [feedResult, briefResult] = await Promise.allSettled([
          fetch("/api/featured"),
          fetch("/api/trending/brief"),
        ]);

        let nextData: TodayOnWikipediaData | null = null;

        if (feedResult.status === "fulfilled" && feedResult.value.ok) {
          nextData = (await feedResult.value.json()) as TodayOnWikipediaData;
        }

        if (briefResult.status === "fulfilled" && briefResult.value.ok) {
          const briefJson = (await briefResult.value.json()) as {
            brief?: {
              audioUrl: string | null;
              headline?: string;
              durationSeconds?: number;
            };
          };

          if (briefJson.brief?.audioUrl) {
            nextData = {
              ...(nextData ?? {}),
              trendingBrief: {
                audioUrl: briefJson.brief.audioUrl,
                headline: briefJson.brief.headline,
                durationSeconds: briefJson.brief.durationSeconds,
              },
            };
          }
        }

        if (!cancelled) setData(nextData);
      } catch {
        // Supplemental discovery; fail quietly.
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();

    return () => {
      cancelled = true;
    };
  }, []);

  if (loading) {
    return (
      <section aria-label="Loading today's Wikipedia feed" className="mt-12">
        <div className="skeleton mx-auto mb-4 h-[22px] w-[48%]" />
        <div className="grid gap-4 lg:grid-cols-[minmax(0,1fr)_minmax(300px,0.82fr)]">
          <div className="space-y-4">
            <div className="rounded-2xl border border-border bg-surface-2 px-5 py-4">
              <div className="skeleton mb-4 h-[18px] w-[38%]" />
              <div className="skeleton mb-2 h-[14px] w-full" />
              <div className="skeleton h-[14px] w-[82%]" />
            </div>
            <div className="rounded-2xl border border-border bg-surface-2 px-5 py-4">
              <div className="skeleton mb-4 h-[18px] w-[32%]" />
              <div className="skeleton mb-2 h-[14px] w-full" />
              <div className="skeleton h-[14px] w-[70%]" />
            </div>
          </div>
          <div className="overflow-hidden rounded-2xl border border-border bg-surface-2">
            <div className="skeleton aspect-[16/10] w-full rounded-none" />
            <div className="px-5 py-4">
              <div className="skeleton mb-2 h-[14px] w-full" />
              <div className="skeleton h-[14px] w-[76%]" />
            </div>
          </div>
        </div>
      </section>
    );
  }

  return data ? <TodayOnWikipediaContent data={data} /> : null;
};
