import { anyApi } from "convex/server";
import { fetchQuery } from "convex/nextjs";
import { NextRequest, NextResponse } from "next/server";
import type { Doc } from "@/convex/_generated/dataModel";
import { fetchCurrentFeaturedArticle } from "@/lib/featured-article";
import { getPodcastAdminAuthError } from "@/lib/podcast-admin-auth";
import {
  getCurrentTrendingBriefSource,
  isTrendingBriefEnabled,
} from "@/lib/trending-brief";

const NO_CACHE_HEADERS = { "Cache-Control": "no-store" } as const;

type FeaturedPodcastEpisode = Doc<"featuredPodcastEpisodes"> & {
  audioUrl: string | null;
};

type FeaturedPodcastJob = Doc<"featuredPodcastJobs">;

type TrendingBrief = Doc<"trendingBriefs"> & {
  audioUrl: string | null;
};

type TrendingBriefJob = Doc<"trendingBriefJobs">;

const normalizeTitle = (value: string | undefined): string =>
  value?.trim().toLowerCase() ?? "";

const sameTitles = (left: string[] | undefined, right: string[]): boolean =>
  (left ?? []).length === right.length &&
  (left ?? []).every(
    (title, index) => normalizeTitle(title) === normalizeTitle(right[index]),
  );

export const dynamic = "force-dynamic";
export const revalidate = 0;

export const GET = async (req: NextRequest) => {
  const authError = getPodcastAdminAuthError(req.headers.get("authorization"));
  if (authError) {
    return NextResponse.json(
      { error: authError },
      {
        status: authError === "Unauthorized" ? 401 : 500,
        headers: NO_CACHE_HEADERS,
      },
    );
  }

  try {
    const [{ tfa, feedDateIso }, trendingSource] = await Promise.all([
      fetchCurrentFeaturedArticle(),
      getCurrentTrendingBriefSource(),
    ]);

    const [featuredEpisode, featuredJob, trendingBrief, trendingJob] =
      await Promise.all([
        fetchQuery(anyApi.podcast.getFeaturedEpisodeByDate, {
          featuredDate: feedDateIso,
        }) as Promise<FeaturedPodcastEpisode | null>,
        fetchQuery(anyApi.podcast.getFeaturedEpisodeJobByDate, {
          featuredDate: feedDateIso,
        }) as Promise<FeaturedPodcastJob | null>,
        fetchQuery(anyApi.trending.getTrendingBriefByDate, {
          trendingDate: trendingSource.trendingDateIso,
        }) as Promise<TrendingBrief | null>,
        fetchQuery(anyApi.trending.getTrendingBriefJobByDate, {
          trendingDate: trendingSource.trendingDateIso,
        }) as Promise<TrendingBriefJob | null>,
      ]);

    const featuredMatchesSource = Boolean(
      tfa &&
        featuredEpisode &&
        featuredEpisode.status === "ready" &&
        featuredEpisode.wikiPageId === tfa.wikiPageId &&
        normalizeTitle(featuredEpisode.title) === normalizeTitle(tfa.title),
    );

    const trendingMatchesSource = Boolean(
      trendingBrief &&
        trendingBrief.trendingDate === trendingSource.trendingDateIso &&
        sameTitles(
          trendingBrief.articleTitles,
          trendingSource.articles.map((article) => article.title),
        ),
    );

    return NextResponse.json(
      {
        featured: {
          source: tfa
            ? {
                featuredDate: feedDateIso,
                title: tfa.title,
                wikiPageId: tfa.wikiPageId ?? null,
              }
            : {
                featuredDate: feedDateIso,
                title: null,
                wikiPageId: null,
              },
          stored: featuredEpisode
            ? {
                featuredDate: featuredEpisode.featuredDate,
                title: featuredEpisode.title,
                wikiPageId: featuredEpisode.wikiPageId,
                status: featuredEpisode.status,
                publishedAt: featuredEpisode.publishedAt,
                updatedAt: featuredEpisode.updatedAt,
                matchesSource: featuredMatchesSource,
              }
            : null,
          matchesSource: featuredMatchesSource,
          job: featuredJob
            ? {
                status: featuredJob.status,
                attempts: featuredJob.attempts,
                updatedAt: featuredJob.updatedAt,
                lastError: featuredJob.lastError ?? null,
              }
            : null,
        },
        trending: {
          enabled: isTrendingBriefEnabled(),
          source: {
            trendingDate: trendingSource.trendingDateIso,
            titles: trendingSource.articles.map((article) => article.title),
          },
          stored: trendingBrief
            ? {
                trendingDate: trendingBrief.trendingDate,
                title:
                  trendingBrief.headline?.trim() ||
                  `Wikipedia Trending Brief ${trendingBrief.trendingDate}`,
                status: trendingBrief.status,
                updatedAt: trendingBrief.updatedAt,
                lastError: trendingBrief.lastError ?? null,
                matchesSource: trendingMatchesSource,
              }
            : null,
          matchesSource: trendingMatchesSource,
          job: trendingJob
            ? {
                status: trendingJob.status,
                attempts: trendingJob.attempts,
                updatedAt: trendingJob.updatedAt,
                lastError: trendingJob.lastError ?? null,
              }
            : null,
        },
      },
      { status: 200, headers: NO_CACHE_HEADERS },
    );
  } catch (error) {
    return NextResponse.json(
      {
        error:
          error instanceof Error
            ? error.message
            : "Failed to inspect podcast publication status",
      },
      { status: 500, headers: NO_CACHE_HEADERS },
    );
  }
};
