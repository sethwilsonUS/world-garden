"use client";

import Link from "next/link";
import { useState, type ReactNode } from "react";
import { AdaptiveImageFrame } from "@/components/AdaptiveImageFrame";
import { ArticleLink } from "@/components/ArticleLink";
import { AudioPlayer } from "@/components/AudioPlayer";
import { DailyTrendingBriefPlayer } from "@/components/DailyTrendingBriefPlayer";
import { usePlaybackRate } from "@/hooks/usePlaybackRate";
import { formatLocalDateTime, formatUtcCalendarDate } from "@/lib/date-format";
import { HOMEPAGE_PREVIEW_LIMITS } from "@/lib/homepage-articles";
import type { WikimediaMediaAttribution } from "@/lib/wikimedia-media";
import { MediaAttribution } from "./MediaAttribution";

type FeedImage = {
  source: string;
  width: number;
  height: number;
  attribution?: WikimediaMediaAttribution;
};

type FeedArticleLink = {
  title: string;
  slug: string;
  text?: string;
  wikiPageId?: string;
  thumbnail?: FeedImage;
};

type DidYouKnowSegment =
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

type FeaturedArticle = {
  title: string;
  extract: string;
  thumbnail?: FeedImage;
  featuredDate?: string | null;
  feedDate?: string | null;
};

type TrendingArticle = {
  title: string;
  extract: string;
  views: number;
  thumbnail?: FeedImage;
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

type DidYouKnowItem = {
  text: string;
  links: FeedArticleLink[];
  segments: DidYouKnowSegment[];
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
  thumbnail?: FeedImage;
  image?: FeedImage;
  filePage?: string;
  artist?: string;
  credit?: string;
  license?: { type?: string; url?: string };
  audio?: PictureAudio;
};

export type TodayOnWikipediaData = {
  tfa?: FeaturedArticle | null;
  feedDate?: string | null;
  snapshotFeedDate?: string | null;
  snapshotGeneratedAt?: number | null;
  snapshotIsStale?: boolean;
  trending?: TrendingArticle[];
  trendingDate?: string | null;
  trendingBrief?: TrendingBrief | null;
  didYouKnow?: DidYouKnowItem[];
  inTheNews?: InTheNewsItem[];
  pictureOfDay?: PictureOfDay | null;
  onThisDay?: OnThisDayItem[];
};

const MAX_DID_YOU_KNOW_ITEMS = HOMEPAGE_PREVIEW_LIMITS.didYouKnowItems;
const MAX_NEWS_ITEMS = HOMEPAGE_PREVIEW_LIMITS.newsItems;
const MAX_TRENDING_ARTICLES = HOMEPAGE_PREVIEW_LIMITS.trendingArticles;
const MAX_ON_THIS_DAY_ITEMS = HOMEPAGE_PREVIEW_LIMITS.onThisDayItems;
const MAX_ARTICLE_LINKS_PER_ITEM = HOMEPAGE_PREVIEW_LIMITS.articleLinksPerItem;

const toArticleSlug = (title: string) => title.replace(/ /g, "_");
const toArticleHref = (titleOrSlug: string) =>
  `/article/${encodeURIComponent(titleOrSlug)}`;

const formatViews = (views: number): string => {
  if (views >= 1_000_000) return `${(views / 1_000_000).toFixed(1)} million`;
  if (views >= 1_000) return `${Math.round(views / 1_000)} thousand`;
  return views.toLocaleString();
};

const formatOnThisDayYear = (year: number): string =>
  year < 0 ? `${Math.abs(year)} BCE` : String(year);

const cardClass =
  "flex h-full flex-col overflow-hidden rounded-2xl border border-border bg-surface-2";

const cardLabelClass = "m-0 text-[0.8125rem] font-semibold text-muted";

const inlineLinkClass =
  "text-accent underline decoration-accent/50 underline-offset-[0.16em] hover:text-accent-hover";

const seeAllLinkClass =
  "mt-2 inline-flex min-h-11 items-center gap-1.5 pt-2 text-[0.9375rem] font-semibold text-accent no-underline hover:text-accent-hover";

const ArrowIcon = () => (
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
    focusable="false"
  >
    <path d="M5 12h14" />
    <path d="M12 5l7 7-7 7" />
  </svg>
);

/**
 * Fixed-ratio card image. AdaptiveImageFrame keeps its focal-point cropping
 * and transparency handling; the fixed ratio prevents the tall letterboxed
 * frames the old two-column layout produced.
 */
const CardImage = ({
  image,
  alt = "",
  sizes,
  priority = false,
}: {
  image: FeedImage;
  alt?: string;
  sizes: string;
  priority?: boolean;
}) => (
  <AdaptiveImageFrame
    src={image.source}
    alt={alt}
    width={image.width}
    height={image.height}
    sizes={sizes}
    fallbackFrameAspectRatio={16 / 9}
    className="block aspect-[16/9] w-full"
    priority={priority}
    unoptimized
  />
);

/**
 * CC BY-SA attribution kept intact but tucked behind a small disclosure on
 * summary surfaces, so credits don't dominate the reading flow.
 */
export const ImageCreditDisclosure = ({
  attribution,
  className = "",
}: {
  attribution?: WikimediaMediaAttribution;
  className?: string;
}) => {
  if (!attribution?.sourceUrl) return null;

  return (
    <details className={`group text-xs text-muted ${className}`}>
      <summary className="inline-flex min-h-6 cursor-pointer items-center gap-1 rounded font-medium text-muted hover:text-foreground">
        <svg
          viewBox="0 0 20 20"
          fill="none"
          stroke="currentColor"
          strokeWidth={1.8}
          strokeLinecap="round"
          strokeLinejoin="round"
          width={12}
          height={12}
          aria-hidden="true"
          focusable="false"
          className="shrink-0 transition-transform duration-150 group-open:rotate-90"
        >
          <path d="m7 4 6 6-6 6" />
        </svg>
        Image credit
      </summary>
      <div className="mt-1">
        <MediaAttribution attribution={attribution} compact />
      </div>
    </details>
  );
};

const ReadLinks = ({ links }: { links: FeedArticleLink[] }) => {
  const visible = links.slice(0, MAX_ARTICLE_LINKS_PER_ITEM);
  if (visible.length === 0) return null;

  return (
    <span className="mt-1 block text-sm text-muted">
      Listen:{" "}
      {visible.map((link, index) => (
        <span key={`${link.wikiPageId ?? link.slug}-${link.title}`}>
          {index > 0 ? ", " : null}
          <ArticleLink
            articleTitle={link.title}
            href={toArticleHref(link.slug)}
            className={inlineLinkClass}
          >
            {link.title}
          </ArticleLink>
        </span>
      ))}
    </span>
  );
};

export const FeaturedArticleCard = ({
  article,
  feedDate,
}: {
  article?: FeaturedArticle | null;
  feedDate?: string | null;
}) => {
  if (!article) return null;

  const slug = toArticleSlug(article.title);
  const dateLabel =
    formatLocalDateTime(article.featuredDate) ||
    formatUtcCalendarDate(article.feedDate ?? feedDate);

  return (
    <article className={cardClass} data-today-pick="featured">
      {article.thumbnail ? (
        <CardImage
          image={article.thumbnail}
          sizes="(min-width: 1024px) 33vw, (min-width: 640px) 50vw, 100vw"
          priority
        />
      ) : null}
      <div className="flex min-w-0 flex-1 flex-col px-5 py-4">
        <p className={cardLabelClass}>Featured article</p>
        <h3 className="mt-1 font-display text-xl font-semibold leading-[1.25]">
          <ArticleLink
            articleTitle={article.title}
            href={toArticleHref(slug)}
            className="text-foreground underline decoration-transparent underline-offset-4 transition-colors hover:decoration-accent"
          >
            {article.title}
          </ArticleLink>
        </h3>
        <p className="mt-2 line-clamp-4 break-words text-[0.9375rem] leading-[1.6] text-foreground-2 [overflow-wrap:anywhere]">
          {article.extract}
        </p>
        {dateLabel ? (
          <p className="mt-3 text-xs text-muted">Last updated: {dateLabel}</p>
        ) : null}
        <ImageCreditDisclosure
          attribution={article.thumbnail?.attribution}
          className="mt-2"
        />
      </div>
    </article>
  );
};

const PreviewToggle = ({
  expanded,
  onToggle,
  total,
  visible,
  label,
  controls,
}: {
  expanded: boolean;
  onToggle: () => void;
  total: number;
  visible: number;
  label: string;
  controls: string;
}) => {
  if (total <= visible) return null;

  return (
    <button
      type="button"
      onClick={onToggle}
      aria-expanded={expanded}
      aria-controls={controls}
      className="mt-2 inline-flex min-h-11 cursor-pointer items-center self-start border-0 bg-transparent pt-2 text-[0.9375rem] font-semibold text-accent hover:text-accent-hover"
    >
      {expanded ? `Show fewer ${label}` : `Show all ${total} ${label}`}
    </button>
  );
};

const FeedColumn = ({
  id,
  title,
  children,
}: {
  id: string;
  title: string;
  children: ReactNode;
}) => (
  <section
    aria-labelledby={id}
    className="flex min-w-0 flex-col rounded-2xl border border-border bg-surface-2 px-5 py-4"
  >
    <h3
      id={id}
      className="font-display text-lg font-semibold text-foreground"
    >
      {title}
    </h3>
    {children}
  </section>
);

export const NewsCard = ({ news }: { news: InTheNewsItem[] }) => {
  const [expanded, setExpanded] = useState(false);
  const visibleNews = expanded ? news : news.slice(0, MAX_NEWS_ITEMS);

  return (
    <FeedColumn id="today-news-heading" title="In the news">
      {news.length > 0 ? (
        <>
          <ul
            id="today-news-list"
            className="m-0 mt-3 list-none space-y-4 p-0"
            role="list"
          >
            {visibleNews.map((item, index) => (
              <li
                key={`${index}-${item.story}`}
                className="text-[0.9375rem] leading-[1.6] text-foreground-2"
              >
                {item.story}
                <ReadLinks links={item.links} />
              </li>
            ))}
          </ul>
          <PreviewToggle
            expanded={expanded}
            onToggle={() => setExpanded((current) => !current)}
            total={news.length}
            visible={MAX_NEWS_ITEMS}
            label="news stories"
            controls="today-news-list"
          />
        </>
      ) : (
        <p className="mt-3 text-sm text-muted" role="status">
          No news items are available right now.
        </p>
      )}
    </FeedColumn>
  );
};

export const OnThisDayCard = ({ items }: { items: OnThisDayItem[] }) => {
  if (items.length === 0) return null;
  const visibleItems = items.slice(0, MAX_ON_THIS_DAY_ITEMS);

  return (
    <FeedColumn id="today-on-this-day-heading" title="On this day">
      <ol className="m-0 mt-3 list-none space-y-4 p-0">
        {visibleItems.map((item, index) => (
          <li
            key={`${item.year ?? "annual"}-${item.text}-${index}`}
            className="text-[0.9375rem] leading-[1.6] text-foreground-2"
          >
            {item.year != null ? (
              <span className="font-semibold text-foreground">
                {formatOnThisDayYear(item.year)}:{" "}
              </span>
            ) : null}
            {item.text}
            <ReadLinks links={item.pages} />
          </li>
        ))}
      </ol>
      <Link href="/on-this-day" className={seeAllLinkClass}>
        {items.length > MAX_ON_THIS_DAY_ITEMS
          ? `Explore all ${items.length} highlights`
          : "Explore On This Day"}
        <ArrowIcon />
      </Link>
    </FeedColumn>
  );
};

export const SnapshotCallout = ({
  snapshotFeedDate,
  snapshotIsStale,
}: {
  snapshotFeedDate?: string | null;
  snapshotIsStale?: boolean;
}) => {
  if (!snapshotIsStale || !snapshotFeedDate) return null;

  const dateLabel = formatUtcCalendarDate(snapshotFeedDate);
  if (!dateLabel) return null;

  return (
    <p
      className="mt-3 rounded-xl border border-accent-border bg-accent-bg px-4 py-2 text-sm leading-[1.6] text-foreground-2"
      role="status"
    >
      Showing the latest cached edition from {dateLabel}. Today&apos;s update is
      still catching up.
    </p>
  );
};

const DidYouKnowSegmentText = ({ segment }: { segment: DidYouKnowSegment }) => {
  if (segment.type === "link") {
    return (
      <ArticleLink
        articleTitle={segment.title}
        href={toArticleHref(segment.slug)}
        className={inlineLinkClass}
      >
        {segment.text}
      </ArticleLink>
    );
  }

  return <>{segment.text}</>;
};

export const DidYouKnowCard = ({ items }: { items: DidYouKnowItem[] }) => {
  const [expanded, setExpanded] = useState(false);
  const visibleItems = expanded
    ? items
    : items.slice(0, MAX_DID_YOU_KNOW_ITEMS);

  return (
    <FeedColumn id="today-dyk-heading" title="Did you know?">
      {items.length > 0 ? (
        <>
          <ul
            id="today-dyk-list"
            className="m-0 mt-3 list-none space-y-4 p-0"
            role="list"
          >
            {visibleItems.map((item, index) => {
              const hasInlineLinks = item.segments.some(
                (segment) => segment.type === "link",
              );
              return (
                <li
                  key={`${index}-${item.text}`}
                  className="text-[0.9375rem] leading-[1.6] text-foreground-2"
                >
                  {(item.segments.length > 0
                    ? item.segments
                    : [{ type: "text" as const, text: item.text }]
                  ).map((segment, segmentIndex) => (
                    <DidYouKnowSegmentText
                      key={`${index}-${segmentIndex}`}
                      segment={segment}
                    />
                  ))}
                  {/* Only offer separate links when the sentence has none,
                      so keyboard users don't tab through duplicates. */}
                  {hasInlineLinks ? null : <ReadLinks links={item.links} />}
                </li>
              );
            })}
          </ul>
          <PreviewToggle
            expanded={expanded}
            onToggle={() => setExpanded((current) => !current)}
            total={items.length}
            visible={MAX_DID_YOU_KNOW_ITEMS}
            label="facts"
            controls="today-dyk-list"
          />
        </>
      ) : (
        <p className="mt-3 text-sm text-muted" role="status">
          No Did You Know items are available right now.
        </p>
      )}
    </FeedColumn>
  );
};

export const TrendingBriefCard = ({ brief }: { brief: TrendingBrief }) => (
  <section
    aria-labelledby="today-brief-heading"
    className={`${cardClass} px-5 py-4`}
    data-today-pick="brief"
  >
    <p className={cardLabelClass}>Daily audio brief</p>
    <h3
      id="today-brief-heading"
      className="mt-1 font-display text-xl font-semibold leading-[1.25] text-foreground"
    >
      Why these topics are trending
    </h3>
    <p className="mt-2 text-[0.9375rem] leading-[1.6] text-foreground-2">
      A few minutes on what people are reading about on Wikipedia, and why.
    </p>
    <div className="mt-4">
      <DailyTrendingBriefPlayer
        audioUrl={brief.audioUrl}
        title={brief.headline || "Why these topics are trending today"}
        durationSeconds={brief.durationSeconds}
      />
    </div>
  </section>
);

/** Evergreen third pick when today's audio brief isn't ready yet. */
export const PodcastsPromoCard = () => (
  <section
    aria-labelledby="today-podcasts-heading"
    className={`${cardClass} px-5 py-4`}
    data-today-pick="podcasts"
  >
    <p className={cardLabelClass}>Daily podcasts</p>
    <h3
      id="today-podcasts-heading"
      className="mt-1 font-display text-xl font-semibold leading-[1.25] text-foreground"
    >
      Listen in your podcast app
    </h3>
    <p className="mt-2 text-[0.9375rem] leading-[1.6] text-foreground-2">
      Today&apos;s featured article and the daily trending brief arrive as
      podcast episodes. Subscribe once and they show up on their own.
    </p>
    <Link href="/podcasts" className={seeAllLinkClass}>
      Browse podcasts
      <ArrowIcon />
    </Link>
  </section>
);

export const TrendingArticles = ({
  articles,
  trendingDate,
}: {
  articles: TrendingArticle[];
  trendingDate?: string | null;
}) => {
  if (articles.length === 0) return null;

  const dateLabel = formatUtcCalendarDate(trendingDate);

  return (
    <section aria-labelledby="today-trending-heading" className="mt-10">
      <div className="mb-4 flex flex-wrap items-end justify-between gap-2">
        <h3
          id="today-trending-heading"
          className="type-section-title-sm font-display font-semibold text-foreground"
        >
          Trending now
        </h3>
        {dateLabel ? (
          <p className="text-sm text-muted">Most read on {dateLabel}</p>
        ) : null}
      </div>

      <ol
        className="m-0 grid list-none grid-cols-1 gap-4 p-0 sm:grid-cols-2 lg:grid-cols-4"
        role="list"
      >
        {articles.slice(0, MAX_TRENDING_ARTICLES).map((article, index) => {
          const slug = toArticleSlug(article.title);
          return (
            <li key={article.title} className={cardClass}>
              <ArticleLink
                articleTitle={article.title}
                href={toArticleHref(slug)}
                className="result-link flex flex-1 flex-col border-0 bg-transparent no-underline"
              >
                {article.thumbnail ? (
                  <CardImage
                    image={article.thumbnail}
                    sizes="(min-width: 1024px) 25vw, (min-width: 640px) 50vw, 100vw"
                  />
                ) : (
                  <span
                    className="block aspect-[16/9] w-full bg-surface-3"
                    aria-hidden="true"
                  />
                )}
                <span className="flex flex-1 flex-col px-4 py-3">
                  <span className="text-sm font-semibold text-accent">
                    #{index + 1}
                  </span>
                  <span className="mt-1 font-display text-lg font-semibold leading-[1.3] text-foreground">
                    {article.title}
                  </span>
                  <span className="mt-1 line-clamp-3 break-words text-sm leading-[1.55] text-foreground-2 [overflow-wrap:anywhere]">
                    {article.extract}
                  </span>
                  {article.views > 0 ? (
                    <span className="mt-auto pt-2 text-xs text-muted">
                      {formatViews(article.views)} views yesterday
                    </span>
                  ) : null}
                </span>
              </ArticleLink>
              <ImageCreditDisclosure
                attribution={article.thumbnail?.attribution}
                className="px-4 pb-3"
              />
            </li>
          );
        })}
      </ol>

      <div className="mt-3 text-center">
        <Link
          href="/trending"
          className="inline-flex min-h-11 items-center gap-1.5 text-[0.9375rem] font-semibold text-accent no-underline hover:text-accent-hover"
        >
          See all trending articles
          <ArrowIcon />
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
      <details className="group mt-3">
        <summary className="inline-flex min-h-11 cursor-pointer items-center gap-1.5 rounded-lg text-[0.9375rem] font-semibold text-accent hover:text-accent-hover">
          <svg
            viewBox="0 0 20 20"
            fill="none"
            stroke="currentColor"
            strokeWidth={1.8}
            strokeLinecap="round"
            strokeLinejoin="round"
            width={14}
            height={14}
            aria-hidden="true"
            focusable="false"
            className="shrink-0 transition-transform duration-150 group-open:rotate-90"
          >
            <path d="m7 4 6 6-6 6" />
          </svg>
          Listen to the description
        </summary>
        <AudioPlayer
          audioUrl={audio.audioUrl}
          title="Picture of the Day description"
          label="Listen: Picture of the Day description"
          playbackRate={rate}
          onPlaybackRateChange={setRate}
          variant="compact"
          className="mt-2 max-w-full"
        />
      </details>
    );
  }

  if (audio.status === "pending") {
    return (
      <p className="mt-3 text-sm text-muted" role="status" aria-live="polite">
        Picture audio is being prepared.
      </p>
    );
  }

  if (audio.status === "failed") {
    return (
      <p className="mt-3 text-sm text-muted" role="status" aria-live="polite">
        Picture audio is not available right now.
      </p>
    );
  }

  return null;
};

export const PictureOfDayFigure = ({ picture }: { picture: PictureOfDay }) => {
  const image = picture.thumbnail ?? picture.image;

  return (
    <figure className={`m-0 ${cardClass}`} data-today-pick="picture">
      {image ? (
        <CardImage
          image={image}
          alt={picture.altText || "Wikipedia picture of the day"}
          sizes="(min-width: 1024px) 33vw, (min-width: 640px) 50vw, 100vw"
          priority
        />
      ) : null}

      <figcaption className="flex flex-1 flex-col px-5 py-4">
        <p className={cardLabelClass}>Picture of the day</p>
        <p className="mt-2 text-[0.9375rem] leading-[1.6] text-foreground-2">
          {picture.description || picture.title}
        </p>

        <PictureAudioStatus audio={picture.audio} />

        <details className="group mt-2 text-xs text-muted">
          <summary className="inline-flex min-h-6 cursor-pointer items-center gap-1 rounded font-medium hover:text-foreground">
            <svg
              viewBox="0 0 20 20"
              fill="none"
              stroke="currentColor"
              strokeWidth={1.8}
              strokeLinecap="round"
              strokeLinejoin="round"
              width={12}
              height={12}
              aria-hidden="true"
              focusable="false"
              className="shrink-0 transition-transform duration-150 group-open:rotate-90"
            >
              <path d="m7 4 6 6-6 6" />
            </svg>
            Image credit
          </summary>
          <dl className="mt-1 grid gap-1 leading-[1.6]">
            {picture.artist ? (
              <div>
                <dt className="inline font-semibold text-foreground-2">
                  Artist:{" "}
                </dt>
                <dd className="inline">{picture.artist}</dd>
              </div>
            ) : null}
            {picture.credit ? (
              <div>
                <dt className="inline font-semibold text-foreground-2">
                  Credit:{" "}
                </dt>
                <dd className="inline">{picture.credit}</dd>
              </div>
            ) : null}
            {picture.license?.type ? (
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
            ) : null}
          </dl>
          {picture.filePage ? (
            <a
              href={picture.filePage}
              target="_blank"
              rel="noopener noreferrer"
              className="mt-1 inline-flex text-accent underline"
            >
              View on Wikimedia Commons
              <span className="sr-only"> (opens in new tab)</span>
            </a>
          ) : image?.attribution ? (
            <div className="mt-1">
              <MediaAttribution attribution={image.attribution} />
            </div>
          ) : null}
        </details>
      </figcaption>
    </figure>
  );
};
