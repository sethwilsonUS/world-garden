"use client";

import { useState, useEffect } from "react";
import Link from "next/link";
import { ArticleCard, type TrendingArticle } from "@/components/ArticleCard";
import { DailyTrendingBriefPlayer } from "@/components/DailyTrendingBriefPlayer";
import { usePrefetch } from "@/hooks/usePrefetch";

const MAX_ARTICLES = 8;

function formatTrendingDate(isoDate: string | null): string {
  if (!isoDate) return "";
  try {
    // Wikipedia returns "YYYY-MM-DDZ"; Safari needs "YYYY-MM-DDTHH:MM:SSZ"
    const normalized =
      /^\d{4}-\d{2}-\d{2}Z$/.test(isoDate) && !isoDate.includes("T")
        ? `${isoDate.slice(0, 10)}T00:00:00Z`
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

export const CuriousAbout = () => {
  const prefetch = usePrefetch();
  const [articles, setArticles] = useState<TrendingArticle[]>([]);
  const [trendingDate, setTrendingDate] = useState<string | null>(null);
  const [brief, setBrief] = useState<{
    audioUrl: string;
    headline?: string;
    durationSeconds?: number;
  } | null>(null);
  const [briefLoading, setBriefLoading] = useState(true);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const response = await fetch("/api/featured");
        if (!response.ok) return;
        const data = await response.json();
        const trending: TrendingArticle[] = data.trending ?? [];
        const date = data.trendingDate ?? null;

        if (trending.length === 0 || cancelled) return;

        const safe = trending.slice(0, MAX_ARTICLES);
        setArticles(safe);
        setTrendingDate(date);

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

  useEffect(() => {
    let cancelled = false;

    (async () => {
      try {
        const response = await fetch("/api/trending/brief");
        if (!response.ok) return;

        const data = (await response.json()) as {
          brief?: {
            audioUrl: string | null;
            headline?: string;
            durationSeconds?: number;
          };
        };

        if (cancelled || !data.brief?.audioUrl) return;
        setBrief({
          audioUrl: data.brief.audioUrl,
          headline: data.brief.headline,
          durationSeconds: data.brief.durationSeconds,
        });
      } catch {
        // Nice-to-have enhancement; fail quietly.
      } finally {
        if (!cancelled) setBriefLoading(false);
      }
    })();

    return () => {
      cancelled = true;
    };
  }, []);

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
      {trendingDate && (
        <p className="text-muted text-xs text-center mb-4" aria-live="polite">
          Last updated: {formatTrendingDate(trendingDate)}
        </p>
      )}
      {brief ? (
        <DailyTrendingBriefPlayer
          audioUrl={brief.audioUrl}
          title={brief.headline || "Why these topics are trending today"}
          durationSeconds={brief.durationSeconds}
        />
      ) : briefLoading ? (
        <div className="mb-5 rounded-2xl border border-border bg-surface-2 px-4 py-3">
          <div className="skeleton mb-2" style={{ width: "32%", height: "11px" }} />
          <div className="skeleton mb-3" style={{ width: "78%", height: "16px" }} />
          <div className="skeleton" style={{ width: "100%", height: "10px" }} />
        </div>
      ) : null}
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
