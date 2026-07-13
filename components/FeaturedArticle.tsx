"use client";

import Image from "next/image";
import { useState, useEffect } from "react";
import { analytics } from "@/lib/analytics";
import { ArticleLink } from "@/components/ArticleLink";
import { PlaylistActionButton } from "@/components/PlaylistActionButton";
import {
  formatLocalDateTime,
  formatUtcCalendarDate,
} from "@/lib/date-format";

type FeaturedData = {
  title: string;
  extract: string;
  thumbnail?: { source: string; width: number; height: number };
  featuredDate?: string | null;
  feedDate?: string | null;
};

export const FeaturedArticle = () => {
  const [featured, setFeatured] = useState<FeaturedData | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const response = await fetch("/api/featured");
        if (!response.ok) return;
        const data = await response.json();
        const tfa = data.tfa;
        const feedDate = data.feedDate ?? null;
        if (!tfa || cancelled) return;
        setFeatured({ ...tfa, feedDate });
      } catch {
        // Featured article is a nice-to-have; fail silently
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  if (!loading && !featured) return null;

  if (loading) {
    return (
      <section aria-label="Loading featured article" className="mt-10">
        <div className="py-4 px-5 bg-surface-2 border border-border rounded-2xl">
          <div className="skeleton" style={{ width: "60%", height: "20px", marginBottom: "10px" }} />
          <div className="skeleton" style={{ width: "100%", height: "14px", marginBottom: "6px" }} />
          <div className="skeleton" style={{ width: "80%", height: "14px" }} />
        </div>
      </section>
    );
  }

  const slug = encodeURIComponent(featured!.title.replace(/ /g, "_"));
  const truncatedExtract =
    featured!.extract.length > 200
      ? featured!.extract.slice(0, 200).replace(/\s+\S*$/, "") + "\u2026"
      : featured!.extract;
  const dateLabel =
    formatLocalDateTime(featured!.featuredDate) ||
    formatUtcCalendarDate(featured!.feedDate);

  return (
    <section
      aria-labelledby="featured-heading"
      className="mt-10"
    >
      <h2
        id="featured-heading"
        className="font-display font-semibold text-lg text-foreground mb-4 text-center"
      >
        Today&rsquo;s featured article
      </h2>
      {dateLabel && (
        <p className="text-muted text-xs text-center mb-3" aria-live="polite">
          Last updated: {dateLabel}
        </p>
      )}
      <article className="overflow-hidden rounded-2xl border border-border bg-surface-2 transition-all duration-200">
        <ArticleLink
          articleTitle={featured!.title}
          href={`/article/${slug}`}
          className="result-link block no-underline"
          onClick={() => analytics.featuredArticleAccessed()}
        >
          <div className={featured!.thumbnail ? "flex flex-col sm:flex-row" : ""}>
            {featured!.thumbnail && (
              <div className="relative aspect-[16/9] shrink-0 overflow-hidden bg-surface-3 sm:min-h-[120px] sm:w-40 sm:aspect-auto">
                {/* Wikimedia thumbnails stay direct instead of proxying broad Commons URLs through Next. */}
                <Image
                  src={featured!.thumbnail.source}
                  alt=""
                  fill
                  sizes="(min-width: 640px) 160px, 100vw"
                  className="object-cover"
                  priority
                  unoptimized
                />
              </div>
            )}
            <div className="min-w-0 px-5 py-4">
              <span className="mb-2 flex items-center gap-2">
                <svg
                  viewBox="0 0 24 24"
                  fill="none"
                  stroke="currentColor"
                  strokeWidth={1.5}
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  width={16}
                  height={16}
                  aria-hidden="true"
                  className="shrink-0 text-accent"
                >
                  <polygon points="12 2 15.09 8.26 22 9.27 17 14.14 18.18 21.02 12 17.77 5.82 21.02 7 14.14 2 9.27 8.91 8.26 12 2" />
                </svg>
                <span className="font-display text-[1.0625rem] font-bold text-foreground">
                  {featured!.title}
                </span>
              </span>
              <span className="block text-[0.8125rem] leading-[1.6] text-muted">
                {truncatedExtract}
              </span>
            </div>
          </div>
        </ArticleLink>
        <div className="flex items-center justify-end border-t border-border px-5 py-3">
          <PlaylistActionButton
            slug={featured!.title.replace(/ /g, "_")}
            title={featured!.title}
          />
        </div>
      </article>
    </section>
  );
};
