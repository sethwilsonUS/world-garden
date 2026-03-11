import { anyApi } from "convex/server";
import { fetchQuery } from "convex/nextjs";
import { NextRequest, NextResponse } from "next/server";
import type { Doc, Id } from "@/convex/_generated/dataModel";
import { renderTrendingPodcastArtworkResponse } from "@/lib/trending-podcast-artwork";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const revalidate = 0;

type TrendingPodcastEpisode = Doc<"trendingBriefs"> & {
  artworkItems?: { title: string; imageUrl: string }[];
  imageUrls?: string[];
  artworkUrl?: string | null;
};

export const GET = async (
  _req: NextRequest,
  { params }: { params: Promise<{ briefId: string }> },
) => {
  const { briefId } = await params;

  try {
    const brief = (await fetchQuery(anyApi.trending.getTrendingBriefById, {
      briefId: briefId as Id<"trendingBriefs">,
    })) as TrendingPodcastEpisode | null;

    if (!brief || brief.status !== "ready") {
      return NextResponse.json(
        { error: "Trending podcast artwork not found" },
        { status: 404, headers: { "Cache-Control": "no-store" } },
      );
    }

    if (brief.artworkUrl) {
      return NextResponse.redirect(brief.artworkUrl, {
        status: 307,
        headers: { "Cache-Control": "public, max-age=300, s-maxage=300" },
      });
    }

    const response = await renderTrendingPodcastArtworkResponse({
      trendingDate: brief.trendingDate,
      headline: brief.headline,
      artworkItems: brief.artworkItems,
      articleTitles: brief.articleTitles,
      imageUrls: brief.imageUrls,
    });
    response.headers.set("Cache-Control", "public, max-age=300, s-maxage=300");
    return response;
  } catch (error) {
    return NextResponse.json(
      {
        error:
          error instanceof Error
            ? error.message
            : "Failed to render trending podcast artwork",
      },
      { status: 500, headers: { "Cache-Control": "no-store" } },
    );
  }
};

export const HEAD = GET;
