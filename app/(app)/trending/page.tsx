"use client";

import { useState, useEffect } from "react";
import Link from "next/link";
import { analytics } from "@/lib/analytics";
import { ArticleCard, type TrendingArticle } from "@/components/ArticleCard";
import { AudioPlayer } from "@/components/AudioPlayer";
import { usePlaybackRate } from "@/hooks/usePlaybackRate";
import { formatUtcCalendarDate } from "@/lib/date-format";

const briefStatusMessage = {
  disabled: "",
  ready: "",
  missing: "The audio brief for these pageviews has not been published yet.",
  pending: "The audio brief for these pageviews is being prepared.",
  failed: "The audio brief for these pageviews could not be published.",
} as const;
type BriefStatus = keyof typeof briefStatusMessage;

export default function TrendingPage() {
  const { rate, setRate } = usePlaybackRate();
  const [articles, setArticles] = useState<TrendingArticle[]>([]);
  const [trendingDate, setTrendingDate] = useState<string | null>(null);
  const [trendingIsStale, setTrendingIsStale] = useState(false);
  const [brief, setBrief] = useState<{
    headline?: string;
    summary?: string;
    keyPoints?: string[];
    sources?: { title: string; url: string }[];
    model?: string;
    audioUrl: string | null;
  } | null>(null);
  const [briefStatus, setBriefStatus] = useState<BriefStatus>("disabled");
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
          status?: BriefStatus;
          brief?: {
            headline?: string;
            summary?: string;
            keyPoints?: string[];
            sources?: { title: string; url: string }[];
            model?: string;
            audioUrl: string | null;
          };
        };

        if (cancelled) return;
        setBriefStatus(data.enabled ? (data.status ?? "missing") : "disabled");
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
  const availability = brief ? "" : briefStatusMessage[briefStatus];

  return (
    <div className="container mx-auto px-4 pt-10 pb-20">
      <div className="max-w-5xl mx-auto">
        <section aria-labelledby="trending-heading">
          <div className="mb-8">
            <h1
              id="trending-heading"
              className="type-page-title font-display text-[1.75rem] font-bold text-foreground"
            >
              Trending today
            </h1>
            <p className="mt-1 text-base leading-[1.6] text-foreground-2">
              The most-read Wikipedia articles right now, filtered for safe
              content.
            </p>
            {trendingDate && (
              <p className="text-muted text-xs mt-1" aria-live="polite">
                Most-read data from: {formatUtcCalendarDate(trendingDate)}
                {trendingIsStale ? " (latest available from Wikipedia)" : ""}
              </p>
            )}
          </div>

          {briefLoading ? (
            <div aria-hidden="true" className="mb-6">
              <div
                className="skeleton"
                style={{ width: "min(100%, 28rem)", height: "20px" }}
              />
            </div>
          ) : brief ? (
            <section
              aria-labelledby="daily-brief-heading"
              className="garden-bed p-6 mb-8"
            >
              <div className="flex flex-wrap items-start justify-between gap-4">
                <div className="min-w-0 flex-1">
                  <p className="text-[0.8125rem] tracking-[0.01em] text-muted font-semibold mb-2">
                    AI-generated daily audio briefing
                  </p>
                  <h2
                    id="daily-brief-heading"
                    className="break-words font-display text-[1.35rem] font-semibold leading-[1.2] text-foreground [overflow-wrap:anywhere]"
                  >
                    {brief.headline || "Why these topics are trending"}
                  </h2>
                  <p className="text-sm text-muted mt-2 leading-[1.7]">
                    <span className="font-semibold text-foreground-2">
                      AI disclosure:
                    </span>{" "}
                    Curio Garden generated this summary
                    {brief.model
                      ? ` with OpenAI ${brief.model}`
                      : " with OpenAI"}{" "}
                    from Wikimedia pageview data and linked reporting. It was
                    not written by Wikipedia and may contain errors.
                  </p>
                </div>

                {brief.audioUrl && (
                  <AudioPlayer
                    audioUrl={brief.audioUrl}
                    title={brief.headline || "Daily trending briefing"}
                    label="Listen: AI-generated daily trending briefing"
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
          ) : null}
          <p className={availability ? "mb-6 text-sm leading-[1.6] text-muted" : "m-0"}>
            <span role="status">{availability}</span>
            {availability && (
              <>
                {" "}
                <Link href="/podcasts/trending" className="text-accent underline">
                  Listen to earlier briefs
                </Link>
              </>
            )}
          </p>

          {loading ? (
            <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-4">
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
            <div className="garden-bed text-center py-12 px-6" role="status">
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
                className="m-0 grid list-none grid-cols-1 gap-3 p-0 sm:grid-cols-2 lg:grid-cols-4"
                role="list"
              >
                {articles.map((article, i) => (
                  <ArticleCard
                    key={article.title}
                    article={article}
                    source="trending_page"
                    imageLoading={i < 8 ? "eager" : "lazy"}
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
