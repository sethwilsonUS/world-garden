"use client";

import { analytics } from "@/lib/analytics";
import { AdaptiveImageFrame } from "@/components/AdaptiveImageFrame";
import { ArticleLink } from "@/components/ArticleLink";
import { PlaylistActionButton } from "@/components/PlaylistActionButton";

export type TrendingArticle = {
  title: string;
  extract: string;
  views: number;
  thumbnail?: { source: string; width: number; height: number };
};

const formatViews = (n: number): string => {
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`;
  if (n >= 1_000) return `${(n / 1_000).toFixed(0)}K`;
  return n.toLocaleString();
};

const formatViewsAccessible = (n: number): string => {
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)} million`;
  if (n >= 1_000) return `${(n / 1_000).toFixed(0)} thousand`;
  return n.toLocaleString();
};

export const ArticleCard = ({
  article,
  imageLoading = "lazy",
  source,
}: {
  article: TrendingArticle;
  imageLoading?: "eager" | "lazy";
  source?: "curious" | "trending_page";
}) => {
  const slug = encodeURIComponent(article.title.replace(/ /g, "_"));
  const imagePriority = imageLoading === "eager";

  // The whole card is clickable through a stretched pseudo-element on the
  // title link, but the link's accessible name stays the title alone so
  // keyboard and screen-reader users don't hear every extract on Tab.
  return (
    <li className="flex">
      <article className="relative flex w-full flex-col overflow-hidden rounded-2xl border border-border bg-surface-2 transition-colors duration-200 hover:border-accent-border hover:bg-surface-3">
        {article.thumbnail ? (
          <AdaptiveImageFrame
            src={article.thumbnail.source}
            alt=""
            width={article.thumbnail.width}
            height={article.thumbnail.height}
            sizes="(min-width: 1024px) 25vw, (min-width: 640px) 50vw, 100vw"
            className="aspect-[16/9] w-full"
            loading={imagePriority ? undefined : "lazy"}
            priority={imagePriority}
            unoptimized
          />
        ) : (
          <div
            aria-hidden="true"
            className="flex w-full aspect-[16/9] items-center justify-center bg-surface-3"
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
              className="text-muted opacity-30"
            >
              <rect x="3" y="3" width="18" height="18" rx="2" ry="2" />
              <circle cx="8.5" cy="8.5" r="1.5" />
              <polyline points="21 15 16 10 5 21" />
            </svg>
          </div>
        )}
        <div className="flex flex-1 flex-col px-4 py-3">
          <ArticleLink
            articleTitle={article.title}
            href={`/article/${slug}`}
            onClick={() => source && analytics.trendingArticleViewed(source)}
            className="mb-1 block break-words font-display text-[0.9375rem] font-bold leading-[1.3] text-foreground no-underline [overflow-wrap:anywhere] after:absolute after:inset-0 after:content-['']"
          >
            {article.title}
          </ArticleLink>
          {article.extract ? (
            <p className="m-0 line-clamp-3 break-words text-sm leading-[1.5] text-muted [overflow-wrap:anywhere]">
              {article.extract}
            </p>
          ) : null}
          {article.views > 0 && (
            <p className="m-0 mt-auto pt-2 text-xs text-muted">
              <span aria-hidden="true">
                {formatViews(article.views)} views yesterday
              </span>
              <span className="sr-only">
                {formatViewsAccessible(article.views)} views yesterday
              </span>
            </p>
          )}
        </div>
        <div className="relative z-10 flex items-center justify-end border-t border-border px-4 py-3">
          <PlaylistActionButton
            slug={article.title.replace(/ /g, "_")}
            title={article.title}
          />
        </div>
      </article>
    </li>
  );
};
