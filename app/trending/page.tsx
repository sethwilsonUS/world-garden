"use client";

import { useState, useEffect } from "react";
import Link from "next/link";
import { filterSafeTitles } from "@/lib/nsfw-filter";
import { ArticleCard, type TrendingArticle } from "@/components/ArticleCard";
import { usePrefetch } from "@/hooks/usePrefetch";

const WIKI_FEATURED_API = "https://en.wikipedia.org/api/rest_v1/feed/featured";
const FILTER_BATCH_SIZE = 50;

const todayString = (): string => {
  const d = new Date();
  return `${d.getFullYear()}/${String(d.getMonth() + 1).padStart(2, "0")}/${String(d.getDate()).padStart(2, "0")}`;
};

const batchFilterSafeTitles = async (
  titles: string[],
): Promise<Set<string>> => {
  const safe = new Set<string>();
  for (let i = 0; i < titles.length; i += FILTER_BATCH_SIZE) {
    const batch = titles.slice(i, i + FILTER_BATCH_SIZE);
    const result = await filterSafeTitles(batch);
    for (const t of result) safe.add(t);
  }
  return safe;
};

export default function TrendingPage() {
  const prefetch = usePrefetch();
  const [articles, setArticles] = useState<TrendingArticle[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const response = await fetch(
          `${WIKI_FEATURED_API}/${todayString()}`,
        );
        if (!response.ok) return;
        const data = await response.json();
        const mostRead: Array<{
          titles?: { normalized?: string };
          title?: string;
          extract?: string;
          views?: number;
          thumbnail?: { source: string; width: number; height: number };
        }> = data.mostread?.articles ?? [];

        if (mostRead.length === 0 || cancelled) return;

        const candidates = mostRead.map((a) => ({
          title: a.titles?.normalized ?? a.title ?? "",
          extract: a.extract ?? "",
          views: a.views ?? 0,
          thumbnail: a.thumbnail,
        }));

        const safeTitles = await batchFilterSafeTitles(
          candidates.map((c) => c.title),
        );

        if (cancelled) return;
        setArticles(candidates.filter((c) => safeTitles.has(c.title)));
      } catch {
        // Fail silently — trending is non-critical
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  const skeletonCount = 12;

  return (
    <div className="container mx-auto px-4 pt-10 pb-20">
      <div className="max-w-5xl mx-auto">
        <nav aria-label="Back navigation" className="mb-5">
          <Link
            href="/"
            className="inline-flex items-center gap-1 text-muted text-sm no-underline"
          >
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
              <path d="M15 19l-7-7 7-7" />
            </svg>
            Back to home
          </Link>
        </nav>

        <section aria-labelledby="trending-heading">
          <div className="mb-8">
            <h1
              id="trending-heading"
              className="font-display text-[1.75rem] font-bold text-foreground"
            >
              Trending today
            </h1>
            <p className="text-muted text-sm mt-1">
              The most-read Wikipedia articles right now, filtered for safe
              content.
            </p>
          </div>

          {loading ? (
            <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 gap-3">
              {Array.from({ length: skeletonCount }).map((_, i) => (
                <div
                  key={i}
                  className="bg-surface-2 border border-border rounded-2xl overflow-hidden"
                >
                  <div
                    className="skeleton w-full aspect-[16/9]"
                    style={{ borderRadius: 0 }}
                  />
                  <div className="px-4 py-3">
                    <div
                      className="skeleton mb-2"
                      style={{ width: "75%", height: "16px" }}
                    />
                    <div
                      className="skeleton"
                      style={{ width: "100%", height: "12px" }}
                    />
                  </div>
                </div>
              ))}
            </div>
          ) : articles.length === 0 ? (
            <div
              className="garden-bed text-center py-12 px-6"
              role="status"
            >
              <p className="font-display font-semibold text-lg text-foreground">
                No trending articles available
              </p>
              <p className="text-muted text-sm mt-2">
                Check back later — Wikipedia updates this list daily.
              </p>
            </div>
          ) : (
            <>
              <p className="text-muted text-sm mb-4">
                {articles.length} articles trending
              </p>
              <ul
                className="list-none p-0 m-0 grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 gap-3"
                role="list"
              >
                {articles.map((article, i) => (
                  <ArticleCard
                    key={article.title}
                    article={article}
                    imageLoading={i < 8 ? "eager" : "lazy"}
                    onHover={() => prefetch(article.title)}
                  />
                ))}
              </ul>
            </>
          )}
        </section>
      </div>
    </div>
  );
}
