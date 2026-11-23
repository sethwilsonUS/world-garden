"use client";

import { useEffect, useState, useSyncExternalStore } from "react";
import { formatUtcCalendarDate } from "@/lib/date-format";
import {
  DidYouKnowCard,
  FeaturedArticleCard,
  NewsCard,
  OnThisDayCard,
  PictureOfDayFigure,
  PodcastsPromoCard,
  SnapshotCallout,
  TrendingArticles,
  TrendingBriefCard,
  type TodayOnWikipediaData,
} from "./TodayOnWikipediaCards";

export type { TodayOnWikipediaData } from "./TodayOnWikipediaCards";

export const TodayOnWikipediaContent = ({
  data,
  showEmptyDidYouKnow = false,
}: {
  data: TodayOnWikipediaData;
  showEmptyDidYouKnow?: boolean;
}) => {
  const featured = data.tfa ?? null;
  const news = data.inTheNews ?? [];
  const trending = data.trending ?? [];
  const didYouKnow = data.didYouKnow ?? [];
  const showDidYouKnow = didYouKnow.length > 0 || showEmptyDidYouKnow;
  const onThisDay = data.onThisDay ?? [];
  const picture = data.pictureOfDay ?? null;
  const trendingBrief = data.trendingBrief ?? null;

  if (
    !featured &&
    news.length === 0 &&
    !showDidYouKnow &&
    trending.length === 0 &&
    !picture &&
    onThisDay.length === 0 &&
    !trendingBrief
  ) {
    return null;
  }

  const hasPicks = Boolean(featured) || Boolean(picture) || Boolean(trendingBrief);
  const hasFeed =
    showDidYouKnow || news.length > 0 || onThisDay.length > 0;
  const dateLabel = formatUtcCalendarDate(data.feedDate);

  return (
    <section aria-labelledby="today-wikipedia-heading" className="mt-14">
      <div className="mb-5 flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1">
        <h2
          id="today-wikipedia-heading"
          className="type-section-title font-display font-semibold text-foreground"
        >
          Today on Wikipedia
        </h2>
        {dateLabel ? (
          <p className="m-0 text-sm text-muted">
            Wikipedia&apos;s daily picks for {dateLabel}
          </p>
        ) : null}
      </div>
      <SnapshotCallout
        snapshotFeedDate={data.snapshotFeedDate ?? data.feedDate}
        snapshotIsStale={data.snapshotIsStale}
      />

      {hasPicks ? (
        <div
          data-today-picks=""
          className="mt-4 grid grid-cols-1 items-stretch gap-4 sm:grid-cols-2 lg:grid-cols-3"
        >
          <FeaturedArticleCard article={featured} feedDate={data.feedDate} />
          {picture ? <PictureOfDayFigure picture={picture} /> : null}
          {trendingBrief ? (
            <TrendingBriefCard brief={trendingBrief} />
          ) : (
            <PodcastsPromoCard />
          )}
        </div>
      ) : null}

      {hasFeed ? (
        <div
          data-today-feed=""
          className="mt-4 grid grid-cols-1 items-stretch gap-4 md:grid-cols-3"
        >
          {showDidYouKnow ? <DidYouKnowCard items={didYouKnow} /> : null}
          {news.length > 0 ? <NewsCard news={news} /> : null}
          <OnThisDayCard items={onThisDay} />
        </div>
      ) : null}

      <TrendingArticles articles={trending} trendingDate={data.trendingDate} />
    </section>
  );
};

const subscribeToHash = (onChange: () => void) => {
  window.addEventListener("hashchange", onChange);
  return () => window.removeEventListener("hashchange", onChange);
};

const hasDidYouKnowHash = () => window.location.hash === "#today-dyk-heading";

export const TodayOnWikipedia = () => {
  const [data, setData] = useState<TodayOnWikipediaData | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let cancelled = false;

    (async () => {
      try {
        const [feedResult, briefResult] = await Promise.allSettled([
          fetch("/api/featured"),
          fetch("/api/trending/brief"),
        ]);

        let nextData: TodayOnWikipediaData | null = null;

        if (feedResult.status === "fulfilled" && feedResult.value.ok) {
          nextData = (await feedResult.value.json()) as TodayOnWikipediaData;
        }

        if (briefResult.status === "fulfilled" && briefResult.value.ok) {
          const briefJson = (await briefResult.value.json()) as {
            brief?: {
              audioUrl: string | null;
              headline?: string;
              durationSeconds?: number;
            };
          };

          if (briefJson.brief?.audioUrl) {
            nextData = {
              ...(nextData ?? {}),
              trendingBrief: {
                audioUrl: briefJson.brief.audioUrl,
                headline: briefJson.brief.headline,
                durationSeconds: briefJson.brief.durationSeconds,
              },
            };
          }
        }

        if (!cancelled) setData(nextData);
      } catch {
        // Supplemental discovery; fail quietly.
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();

    return () => {
      cancelled = true;
    };
  }, []);

  // The legacy /did-you-know link redirects here before the feed has loaded.
  const isDidYouKnowLanding = useSyncExternalStore(
    subscribeToHash,
    hasDidYouKnowHash,
    () => false,
  );
  useEffect(() => {
    if (
      loading ||
      !isDidYouKnowLanding ||
      document.activeElement !== document.body ||
      window.scrollY > 0
    ) return;
    const heading = document.getElementById("today-dyk-heading");
    heading?.focus({ preventScroll: true });
    heading?.scrollIntoView({ block: "start" });
  }, [isDidYouKnowLanding, loading]);

  if (loading) {
    return (
      <section aria-label="Loading today's Wikipedia feed" className="mt-14">
        <div className="skeleton mb-5 h-[28px] w-[40%] max-w-xs" />
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {[0, 1, 2].map((key) => (
            <div
              key={key}
              className="overflow-hidden rounded-2xl border border-border bg-surface-2"
            >
              <div className="skeleton aspect-[16/9] w-full rounded-none" />
              <div className="px-5 py-4">
                <div className="skeleton mb-3 h-[18px] w-[45%]" />
                <div className="skeleton mb-2 h-[14px] w-full" />
                <div className="skeleton h-[14px] w-[78%]" />
              </div>
            </div>
          ))}
        </div>
      </section>
    );
  }

  return data || isDidYouKnowLanding ? (
    <TodayOnWikipediaContent
      data={data ?? {}}
      showEmptyDidYouKnow={isDidYouKnowLanding}
    />
  ) : null;
};
