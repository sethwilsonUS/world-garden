"use client";

import { useState, useEffect } from "react";
import Link from "next/link";
import { analytics } from "@/lib/analytics";
import { ArticleCard, type TrendingArticle } from "@/components/ArticleCard";
import { AudioPlayer } from "@/components/AudioPlayer";
import { usePlaybackRate } from "@/hooks/usePlaybackRate";
import { usePrefetch } from "@/hooks/usePrefetch";

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

export default function TrendingPage() {
  const prefetch = usePrefetch();
  const { rate, setRate } = usePlaybackRate();
  const [articles, setArticles] = useState<TrendingArticle[]>([]);
  const [trendingDate, setTrendingDate] = useState<string | null>(null);
  const [trendingIsStale, setTrendingIsStale] = useState(false);
  const [brief, setBrief] = useState<{
    headline?: string;
    summary?: string;
    keyPoints?: string[];
    sources?: { title: string; url: string }[];
    audioUrl: string | null;
  } | null>(null);
  const [briefState, setBriefState] = useState<{
    enabled: boolean;
    status: "disabled" | "missing" | "pending" | "failed" | "ready";
    lastError?: string;
  } | null>(null);
  const [briefLoading, setBriefLoading] = useState(true);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    analytics.trendingPageAccessed();
  }, []);

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
        setArticles(trending);
        setTrendingDate(date);
        setTrendingIsStale(Boolean(data.trendingIsStale));
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

  useEffect(() => {
    let cancelled = false;

    (async () => {
      try {
        const response = await fetch("/api/trending/brief");
        if (!response.ok) return;

        const data = (await response.json()) as {
          enabled: boolean;
          status?: "disabled" | "missing" | "pending" | "failed" | "ready";
          lastError?: string;
          brief?: {
            headline?: string;
            summary?: string;
            keyPoints?: string[];
            sources?: { title: string; url: string }[];
            audioUrl: string | null;
          };
        };

        if (cancelled) return;
        setBriefState({
          enabled: data.enabled,
          status: data.status ?? "missing",
          lastError: data.lastError,
        });
        setBrief(data.brief ?? null);
      } catch {
        // Non-critical enhancement; fail quietly.
      } finally {
        if (!cancelled) setBriefLoading(false);
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
            {trendingDate && (
              <p className="text-muted text-xs mt-1" aria-live="polite">
                Most-read data from: {formatTrendingDate(trendingDate)}
                {trendingIsStale ? " (latest available from Wikipedia)" : ""}
              </p>
            )}
          </div>

          {briefLoading ? (
            <div className="garden-bed p-6 mb-8" aria-busy="true">
              <div
                className="skeleton mb-3"
                style={{ width: "34%", height: "18px" }}
              />
              <div
                className="skeleton mb-2"
                style={{ width: "100%", height: "14px" }}
              />
              <div
                className="skeleton mb-4"
                style={{ width: "86%", height: "14px" }}
              />
              <div
                className="skeleton"
                style={{ width: "220px", height: "56px" }}
              />
            </div>
          ) : brief ? (
            <section
              aria-labelledby="daily-brief-heading"
              className="garden-bed p-6 mb-8"
            >
              <div className="flex flex-wrap items-start justify-between gap-4">
                <div className="min-w-0 flex-1">
                  <p className="text-xs uppercase tracking-[0.18em] text-muted font-semibold mb-2">
                    Daily audio briefing
                  </p>
                  <h2
                    id="daily-brief-heading"
                    className="font-display text-[1.35rem] font-semibold text-foreground leading-[1.2]"
                  >
                    {brief.headline || "Why these topics are trending"}
                  </h2>
                  <p className="text-sm text-muted mt-2 leading-[1.7]">
                    AI-generated summary of the likely reasons behind today&apos;s
                    Wikipedia trends, informed by recent news search.
                  </p>
                </div>

                {brief.audioUrl && (
                  <AudioPlayer
                    audioUrl={brief.audioUrl}
                    title={brief.headline || "Daily trending briefing"}
                    label="Listen: daily trending briefing"
                    playbackRate={rate}
                    onPlaybackRateChange={setRate}
                  />
                )}
              </div>

              {brief.summary && (
                <div className="mt-5 space-y-3 text-sm text-foreground-2 leading-[1.8]">
                  {brief.summary
                    .split(/\n+/)
                    .map((paragraph) => paragraph.trim())
                    .filter(Boolean)
                    .map((paragraph, index) => (
                      <p key={index}>{paragraph}</p>
                    ))}
                </div>
              )}

              {brief.keyPoints && brief.keyPoints.length > 0 && (
                <div className="mt-5">
                  <h3 className="text-sm font-semibold text-foreground mb-2">
                    Likely drivers
                  </h3>
                  <ul className="list-disc pl-5 space-y-2 text-sm text-foreground-2 leading-[1.7]">
                    {brief.keyPoints.map((point) => (
                      <li key={point}>{point}</li>
                    ))}
                  </ul>
                </div>
              )}

              {brief.sources && brief.sources.length > 0 && (
                <div className="mt-5">
                  <h3 className="text-sm font-semibold text-foreground mb-2">
                    Sources consulted
                  </h3>
                  <ul className="list-none p-0 m-0 space-y-2">
                    {brief.sources.map((source) => (
                      <li key={source.url}>
                        <a
                          href={source.url}
                          target="_blank"
                          rel="noopener noreferrer"
                          className="text-sm text-accent underline"
                        >
                          {source.title}
                          <span className="sr-only"> (opens in new tab)</span>
                        </a>
                      </li>
                    ))}
                  </ul>
                </div>
              )}
            </section>
          ) : briefState?.enabled &&
            (briefState.status === "missing" || briefState.status === "pending") ? (
            <section
              aria-labelledby="daily-brief-heading"
              className="garden-bed p-6 mb-8"
            >
              <p className="text-xs uppercase tracking-[0.18em] text-muted font-semibold mb-2">
                Daily audio briefing
              </p>
              <h2
                id="daily-brief-heading"
                className="font-display text-[1.35rem] font-semibold text-foreground leading-[1.2]"
              >
                Today&apos;s audio brief is still being prepared
              </h2>
              <p className="text-sm text-muted mt-2 leading-[1.7] max-w-3xl">
                The trending podcast is now published by scheduled sync, so this page
                won&apos;t generate it on demand. Check back after the daily podcast run
                completes.
              </p>
            </section>
          ) : briefState?.enabled && briefState.status === "failed" ? (
            <section
              aria-labelledby="daily-brief-heading"
              className="garden-bed p-6 mb-8"
            >
              <p className="text-xs uppercase tracking-[0.18em] text-muted font-semibold mb-2">
                Daily audio briefing
              </p>
              <h2
                id="daily-brief-heading"
                className="font-display text-[1.35rem] font-semibold text-foreground leading-[1.2]"
              >
                Today&apos;s audio brief couldn&apos;t be published yet
              </h2>
              <p className="text-sm text-muted mt-2 leading-[1.7] max-w-3xl">
                The latest scheduled generation failed. A later retry or manual sync
                can republish it.
              </p>
              {briefState.lastError ? (
                <p className="text-xs text-muted mt-3 font-mono break-words">
                  {briefState.lastError}
                </p>
              ) : null}
            </section>
          ) : null}

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
                    source="trending_page"
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
