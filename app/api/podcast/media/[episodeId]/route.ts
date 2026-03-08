import { anyApi } from "convex/server";
import { fetchQuery } from "convex/nextjs";
import { NextRequest, NextResponse } from "next/server";
import type { Doc, Id } from "@/convex/_generated/dataModel";

type FeaturedPodcastEpisode = Doc<"featuredPodcastEpisodes"> & {
  audioUrl: string | null;
};

export const GET = async (
  _req: NextRequest,
  { params }: { params: Promise<{ episodeId: string }> },
) => {
  const { episodeId } = await params;

  try {
    const episode = (await fetchQuery(anyApi.podcast.getFeaturedEpisodeById, {
      episodeId: episodeId as Id<"featuredPodcastEpisodes">,
    })) as FeaturedPodcastEpisode | null;

    if (!episode || episode.status !== "ready" || !episode.audioUrl) {
      return NextResponse.json(
        { error: "Podcast episode not found" },
        { status: 404, headers: { "Cache-Control": "no-store" } },
      );
    }

    return NextResponse.redirect(episode.audioUrl, {
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
            : "Failed to resolve podcast episode audio",
      },
      { status: 500, headers: { "Cache-Control": "no-store" } },
    );
  }
};
