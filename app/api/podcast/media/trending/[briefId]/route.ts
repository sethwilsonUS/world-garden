import { anyApi } from "convex/server";
import { fetchQuery } from "convex/nextjs";
import { NextRequest, NextResponse } from "next/server";
import type { Doc, Id } from "@/convex/_generated/dataModel";

type TrendingPodcastEpisode = Doc<"trendingBriefs"> & {
  audioUrl: string | null;
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

    if (!brief || brief.status !== "ready" || !brief.audioUrl) {
      return NextResponse.json(
        { error: "Trending podcast episode not found" },
        { status: 404, headers: { "Cache-Control": "no-store" } },
      );
    }

    return NextResponse.redirect(brief.audioUrl, {
      status: 307,
      headers: {
        "Cache-Control":
          "public, max-age=300, s-maxage=300, stale-while-revalidate=900",
      },
    });
  } catch (error) {
    return NextResponse.json(
      {
        error:
          error instanceof Error
            ? error.message
            : "Failed to resolve trending podcast episode audio",
      },
      { status: 500, headers: { "Cache-Control": "no-store" } },
    );
  }
};
