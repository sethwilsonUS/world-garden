import { anyApi } from "convex/server";
import { fetchQuery } from "convex/nextjs";
import { NextResponse } from "next/server";
import type { Doc } from "@/convex/_generated/dataModel";
import { getPodcastArtworkUrl } from "@/lib/podcast-feed";
import { renderTrendingPodcastArtworkResponse } from "@/lib/trending-podcast-artwork";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const revalidate = 0;

type TrendingPodcastEpisode = Doc<"trendingBriefs"> & {
  imageUrls?: string[];
};

export const GET = async (req: Request) => {
  try {
    const [latest] = (await fetchQuery(anyApi.trending.getRecentTrendingBriefs, {
      status: "ready",
      limit: 1,
    })) as TrendingPodcastEpisode[];

    if (!latest) {
      return NextResponse.redirect(getPodcastArtworkUrl(new URL(req.url).origin), {
        status: 307,
        headers: { "Cache-Control": "no-store" },
      });
    }

    const response = await renderTrendingPodcastArtworkResponse({
      trendingDate: latest.trendingDate,
      headline: latest.headline,
      articleTitles: latest.articleTitles,
      imageUrls: latest.imageUrls,
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
