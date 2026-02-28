"use client";

import Link from "next/link";
import { analytics } from "@/lib/analytics";

export type TrendingArticle = {
  title: string;
  extract: string;
  views: number;
  thumbnail?: { source: string; width: number; height: number };
};

const truncate = (text: string, max: number): string =>
  text.length > max
    ? text.slice(0, max).replace(/\s+\S*$/, "") + "\u2026"
    : text;

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
  onHover,
  source,
}: {
  article: TrendingArticle;
  imageLoading?: "eager" | "lazy";
  onHover?: () => void;
  source?: "curious" | "trending_page";
}) => {
  const slug = encodeURIComponent(article.title.replace(/ /g, "_"));

  return (
    <li>
      <Link
        href={`/article/${slug}`}
        onClick={() => source && analytics.trendingArticleViewed(source)}
        onMouseEnter={onHover}
        onFocus={onHover}
        className="result-link group block bg-surface-2 border border-border rounded-2xl no-underline overflow-hidden transition-all duration-200 h-full"
      >
        {article.thumbnail ? (
          <div className="relative w-full aspect-[16/9] bg-surface-3 overflow-hidden" aria-hidden="true">
            <img
              src={article.thumbnail.source}
              alt=""
              className="absolute inset-0 w-full h-full object-cover"
              loading={imageLoading}
            />
          </div>
        ) : (
          <div
            aria-hidden="true"
            className="w-full aspect-[16/9] bg-surface-3 flex items-center justify-center"
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
        <div className="px-4 py-3">
          <span className="block font-display font-bold text-[0.9375rem] leading-[1.3] text-foreground mb-1 line-clamp-2">
            {article.title}
          </span>
          <span className="block text-[0.8125rem] leading-[1.5] text-muted line-clamp-2">
            {truncate(article.extract, 120)}
          </span>
          {article.views > 0 && (
            <span className="block text-[0.6875rem] text-muted mt-1.5 opacity-70">
              <span aria-hidden="true">{formatViews(article.views)} views yesterday</span>
              <span className="sr-only">{formatViewsAccessible(article.views)} views yesterday</span>
            </span>
          )}
        </div>
      </Link>
    </li>
  );
};
