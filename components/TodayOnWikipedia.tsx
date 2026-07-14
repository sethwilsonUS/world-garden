"use client";

import { useEffect, useState } from "react";
import {
  DidYouKnowCard,
  FeaturedArticleCard,
  NewsCard,
  OnThisDayCard,
  PictureOfDayFigure,
  SnapshotCallout,
  TrendingArticles,
  type TodayOnWikipediaData,
} from "./TodayOnWikipediaCards";

export type { TodayOnWikipediaData } from "./TodayOnWikipediaCards";

export const TodayOnWikipediaContent = ({
  data,
}: {
  data: TodayOnWikipediaData;
}) => {
  const featured = data.tfa ?? null;
  const news = data.inTheNews ?? [];
  const trending = data.trending ?? [];
  const didYouKnow = data.didYouKnow ?? [];
  const onThisDay = data.onThisDay ?? [];
  const picture = data.pictureOfDay ?? null;
  const trendingBrief = data.trendingBrief ?? null;

  if (
    !featured &&
    news.length === 0 &&
    didYouKnow.length === 0 &&
    trending.length === 0 &&
    !picture &&
    onThisDay.length === 0 &&
    !trendingBrief
  ) {
    return null;
  }

  const firstOnThisDay = onThisDay[0];
  const hasPrimaryRail =
    Boolean(featured) || didYouKnow.length > 0;
  const hasSupportRail =
    Boolean(picture) || news.length > 0 || Boolean(firstOnThisDay);
  const hasTwoRails = hasPrimaryRail && hasSupportRail;

  return (
    <section aria-labelledby="today-wikipedia-heading" className="mt-12">
      <div className="mb-5 text-center">
        <h2
          id="today-wikipedia-heading"
          className="font-display text-lg font-semibold text-foreground"
        >
          Today on Wikipedia
        </h2>
        <p className="mt-1 text-xs text-muted">
          A structured digest of Wikipedia&apos;s daily featured feed.
        </p>
        <SnapshotCallout
          snapshotFeedDate={data.snapshotFeedDate ?? data.feedDate}
          snapshotIsStale={data.snapshotIsStale}
        />
      </div>

      <div className="grid grid-cols-1 gap-4 lg:grid-cols-[minmax(0,1fr)_minmax(300px,0.82fr)]">
        {hasPrimaryRail && (
          <div className={`space-y-4 ${hasTwoRails ? "" : "lg:col-span-2"}`}>
            <FeaturedArticleCard article={featured} feedDate={data.feedDate} />
            {didYouKnow.length > 0 ? (
              <DidYouKnowCard items={didYouKnow} />
            ) : null}
          </div>
        )}

        {hasSupportRail && (
          <div className={`space-y-4 ${hasTwoRails ? "" : "lg:col-span-2"}`}>
            {picture && <PictureOfDayFigure picture={picture} />}
            <NewsCard news={news} />
            <OnThisDayCard item={firstOnThisDay} />
          </div>
        )}

        <TrendingArticles
          articles={trending}
          trendingDate={data.trendingDate}
          brief={trendingBrief}
        />
      </div>
    </section>
  );
};

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

  if (loading) {
    return (
      <section aria-label="Loading today's Wikipedia feed" className="mt-12">
        <div className="skeleton mx-auto mb-4 h-[22px] w-[48%]" />
        <div className="grid grid-cols-1 gap-4 lg:grid-cols-[minmax(0,1fr)_minmax(300px,0.82fr)]">
          <div className="space-y-4">
            <div className="rounded-2xl border border-border bg-surface-2 px-5 py-4">
              <div className="skeleton mb-4 h-[18px] w-[38%]" />
              <div className="skeleton mb-2 h-[14px] w-full" />
              <div className="skeleton h-[14px] w-[82%]" />
            </div>
            <div className="rounded-2xl border border-border bg-surface-2 px-5 py-4">
              <div className="skeleton mb-4 h-[18px] w-[32%]" />
              <div className="skeleton mb-2 h-[14px] w-full" />
              <div className="skeleton h-[14px] w-[70%]" />
            </div>
          </div>
          <div className="overflow-hidden rounded-2xl border border-border bg-surface-2">
            <div className="skeleton aspect-[16/10] w-full rounded-none" />
            <div className="px-5 py-4">
              <div className="skeleton mb-2 h-[14px] w-full" />
              <div className="skeleton h-[14px] w-[76%]" />
            </div>
          </div>
        </div>
      </section>
    );
  }

  return data ? <TodayOnWikipediaContent data={data} /> : null;
};
