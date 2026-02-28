"use client";

import { useState, useEffect } from "react";
import Link from "next/link";
import { filterSafeTitles } from "@/lib/nsfw-filter";
import { ArticleCard, type TrendingArticle } from "@/components/ArticleCard";
import { usePrefetch } from "@/hooks/usePrefetch";

const WIKI_FEATURED_API = "https://en.wikipedia.org/api/rest_v1/feed/featured";

const MAX_ARTICLES = 8;

const todayString = (): string => {
  const d = new Date();
  return `${d.getFullYear()}/${String(d.getMonth() + 1).padStart(2, "0")}/${String(d.getDate()).padStart(2, "0")}`;
};

export const CuriousAbout = () => {
  const prefetch = usePrefetch();
  const [articles, setArticles] = useState<TrendingArticle[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const response = await fetch(`${WIKI_FEATURED_API}/${todayString()}`);
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

        const candidates = mostRead.slice(0, 20).map((a) => ({
          title: a.titles?.normalized ?? a.title ?? "",
          extract: a.extract ?? "",
          views: a.views ?? 0,
          thumbnail: a.thumbnail,
        }));

        const safeTitles = await filterSafeTitles(
          candidates.map((c) => c.title),
        );

        if (cancelled) return;

        const safe = candidates
          .filter((c) => safeTitles.has(c.title))
          .slice(0, MAX_ARTICLES);

        setArticles(safe);

        for (const article of safe) {
          prefetch(article.title);
        }
      } catch {
        // Nice-to-have section; fail silently
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [prefetch]);

  if (!loading && articles.length === 0) return null;

  if (loading) {
    return (
      <section aria-label="Loading trending articles" className="mt-12">
        <div className="skeleton mx-auto mb-4" style={{ width: "55%", height: "22px" }} />
        <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
          {Array.from({ length: MAX_ARTICLES }).map((_, i) => (
            <div key={i} className="bg-surface-2 border border-border rounded-2xl overflow-hidden">
              <div className="skeleton w-full aspect-[16/9]" style={{ borderRadius: 0 }} />
              <div className="px-4 py-3">
                <div className="skeleton mb-2" style={{ width: "75%", height: "16px" }} />
                <div className="skeleton" style={{ width: "100%", height: "12px" }} />
              </div>
            </div>
          ))}
        </div>
      </section>
    );
  }

  return (
    <section aria-labelledby="curious-heading" className="mt-12">
      <h2
        id="curious-heading"
        className="font-display font-semibold text-lg text-foreground mb-4 text-center"
      >
        What people are curious about
      </h2>
      <ul
        className="list-none p-0 m-0 grid grid-cols-2 lg:grid-cols-4 gap-3"
        role="list"
      >
        {articles.map((article) => (
          <ArticleCard
            key={article.title}
            article={article}
            source="curious"
            onHover={() => prefetch(article.title)}
          />
        ))}
        <li className="col-span-2 lg:col-span-4 mt-1 text-center">
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
        </li>
      </ul>
    </section>
  );
};
