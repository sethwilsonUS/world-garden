"use client";

import { useState, useEffect, useCallback } from "react";
import Link from "next/link";
import { useData } from "@/lib/data-context";
import { warmSummaryAudio, warmArticleImage } from "@/lib/audio-prefetch";
import { filterSafeTitles } from "@/lib/nsfw-filter";

const WIKI_FEATURED_API = "https://en.wikipedia.org/api/rest_v1/feed/featured";

const MAX_ARTICLES = 8;

type MostReadArticle = {
  title: string;
  extract: string;
  thumbnail?: { source: string; width: number; height: number };
};

const todayString = (): string => {
  const d = new Date();
  return `${d.getFullYear()}/${String(d.getMonth() + 1).padStart(2, "0")}/${String(d.getDate()).padStart(2, "0")}`;
};

const truncate = (text: string, max: number): string =>
  text.length > max
    ? text.slice(0, max).replace(/\s+\S*$/, "") + "\u2026"
    : text;

const ArticleCard = ({
  article,
  onHover,
}: {
  article: MostReadArticle;
  onHover: () => void;
}) => {
  const slug = encodeURIComponent(article.title.replace(/ /g, "_"));

  return (
    <li>
      <Link
        href={`/article/${slug}`}
        onMouseEnter={onHover}
        onFocus={onHover}
        className="result-link group block bg-surface-2 border border-border rounded-2xl no-underline overflow-hidden transition-all duration-200 h-full"
      >
        {article.thumbnail ? (
          <div className="relative w-full aspect-[16/9] bg-surface-3 overflow-hidden">
            <img
              src={article.thumbnail.source}
              alt=""
              className="absolute inset-0 w-full h-full object-cover"
              loading="lazy"
            />
          </div>
        ) : (
          <div
            role="img"
            aria-label="No image available"
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
              aria-hidden="true"
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
        </div>
      </Link>
    </li>
  );
};

export const CuriousAbout = () => {
  const { fetchArticle } = useData();
  const [articles, setArticles] = useState<MostReadArticle[]>([]);
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
          thumbnail?: { source: string; width: number; height: number };
        }> = data.mostread?.articles ?? [];

        if (mostRead.length === 0 || cancelled) return;

        const candidates = mostRead.slice(0, 20).map((a) => ({
          title: a.titles?.normalized ?? a.title ?? "",
          extract: a.extract ?? "",
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
          const slug = article.title.replace(/ /g, "_");
          warmSummaryAudio(slug, fetchArticle);
          warmArticleImage(slug, fetchArticle);
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
  }, [fetchArticle]);

  const prefetch = useCallback(
    (title: string) => {
      const slug = title.replace(/ /g, "_");
      warmSummaryAudio(slug, fetchArticle);
      warmArticleImage(slug, fetchArticle);
    },
    [fetchArticle],
  );

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
            onHover={() => prefetch(article.title)}
          />
        ))}
      </ul>
      <div className="mt-4 text-center">
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
