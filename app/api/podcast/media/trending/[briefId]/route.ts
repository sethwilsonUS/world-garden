import { anyApi } from "convex/server";
import { fetchQuery } from "convex/nextjs";
import { NextRequest, NextResponse } from "next/server";
import type { Doc, Id } from "@/convex/_generated/dataModel";
import {
  createPodcastAttachmentResponse,
  isPodcastDownloadRequest,
  PODCAST_MEDIA_CACHE_CONTROL,
} from "@/lib/podcast-media-response";

type TrendingPodcastEpisode = Doc<"trendingBriefs"> & {
  audioUrl: string | null;
};

export const GET = async (
  req: NextRequest,
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

    if (isPodcastDownloadRequest(req)) {
      return await createPodcastAttachmentResponse({
        audioUrl: brief.audioUrl,
        title:
          brief.headline?.trim() ||
          `Wikipedia Trending Brief ${brief.trendingDate}`,
        fallbackFilename: "trending-podcast-episode.mp3",
      });
    }

    return NextResponse.redirect(brief.audioUrl, {
      status: 307,
      headers: {
        "Cache-Control": PODCAST_MEDIA_CACHE_CONTROL,
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

export const HEAD = GET;
