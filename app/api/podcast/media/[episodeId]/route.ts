import { anyApi } from "convex/server";
import { fetchQuery } from "convex/nextjs";
import { NextRequest, NextResponse } from "next/server";
import type { Doc, Id } from "@/convex/_generated/dataModel";
import {
  createPodcastAttachmentResponse,
  isPodcastDownloadRequest,
  PODCAST_MEDIA_CACHE_CONTROL,
} from "@/lib/podcast-media-response";

type FeaturedPodcastEpisode = Doc<"featuredPodcastEpisodes"> & {
  audioUrl: string | null;
};

export const GET = async (
  req: NextRequest,
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

    if (isPodcastDownloadRequest(req)) {
      return await createPodcastAttachmentResponse({
        audioUrl: episode.audioUrl,
        title: episode.title,
        fallbackFilename: "featured-podcast-episode.mp3",
      });
    }

    return NextResponse.redirect(episode.audioUrl, {
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
            : "Failed to resolve podcast episode audio",
      },
      { status: 500, headers: { "Cache-Control": "no-store" } },
    );
  }
};
