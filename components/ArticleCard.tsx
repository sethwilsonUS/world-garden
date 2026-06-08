"use client";

import Image from "next/image";
import { analytics } from "@/lib/analytics";
import { ArticleLink } from "@/components/ArticleLink";
import { PlaylistActionButton } from "@/components/PlaylistActionButton";

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
  source,
}: {
  article: TrendingArticle;
  imageLoading?: "eager" | "lazy";
  source?: "curious" | "trending_page";
}) => {
  const slug = encodeURIComponent(article.title.replace(/ /g, "_"));
  const imagePriority = imageLoading === "eager";

  return (
    <li>
      <article className="group flex h-full flex-col overflow-hidden rounded-2xl border border-border bg-surface-2 transition-all duration-200">
        <ArticleLink
          articleTitle={article.title}
          href={`/article/${slug}`}
          onClick={() => source && analytics.trendingArticleViewed(source)}
          className="result-link block flex-1 no-underline"
        >
          {article.thumbnail ? (
            <div className="relative w-full aspect-[16/9] bg-surface-3 overflow-hidden" aria-hidden="true">
              {/* Wikimedia thumbnails stay direct instead of proxying broad Commons URLs through Next. */}
              <Image
                src={article.thumbnail.source}
                alt=""
                fill
                sizes="(min-width: 1024px) 25vw, (min-width: 640px) 50vw, 100vw"
                className="object-cover"
                loading={imagePriority ? undefined : "lazy"}
                priority={imagePriority}
                unoptimized
              />
            </div>
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
          <div className="px-4 py-3">
            <span className="mb-1 block font-display text-[0.9375rem] font-bold leading-[1.3] text-foreground line-clamp-2">
              {article.title}
            </span>
            <span className="block text-[0.8125rem] leading-[1.5] text-muted line-clamp-2">
              {truncate(article.extract, 120)}
            </span>
            {article.views > 0 && (
              <span className="mt-1.5 block text-[0.6875rem] text-muted opacity-70">
                <span aria-hidden="true">{formatViews(article.views)} views yesterday</span>
                <span className="sr-only">{formatViewsAccessible(article.views)} views yesterday</span>
              </span>
            )}
          </div>
        </ArticleLink>
        <div className="flex items-center justify-end border-t border-border px-4 py-3">
          <PlaylistActionButton slug={article.title.replace(/ /g, "_")} title={article.title} />
        </div>
      </article>
    </li>
  );
};
