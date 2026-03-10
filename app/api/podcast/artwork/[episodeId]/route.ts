import { anyApi } from "convex/server";
import { fetchQuery } from "convex/nextjs";
import { NextRequest, NextResponse } from "next/server";
import type { Doc, Id } from "@/convex/_generated/dataModel";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const revalidate = 0;

type FeaturedPodcastEpisode = Doc<"featuredPodcastEpisodes"> & {
  artworkUrl?: string | null;
};

const resolveArtworkResponse = async (episodeId: string) => {
  const episode = (await fetchQuery(anyApi.podcast.getFeaturedEpisodeById, {
    episodeId: episodeId as Id<"featuredPodcastEpisodes">,
  })) as FeaturedPodcastEpisode | null;

  if (!episode || episode.status !== "ready") {
    return NextResponse.json(
      { error: "Featured podcast artwork not found" },
      { status: 404, headers: { "Cache-Control": "no-store" } },
    );
  }

  const artworkUrl = episode.artworkUrl || episode.imageUrl;
  if (!artworkUrl) {
    return NextResponse.json(
      { error: "Featured podcast artwork not found" },
      { status: 404, headers: { "Cache-Control": "no-store" } },
    );
  }

  return NextResponse.redirect(artworkUrl, {
    status: 307,
    headers: { "Cache-Control": "public, max-age=300, s-maxage=300" },
  });
};

export const GET = async (
  _req: NextRequest,
  { params }: { params: Promise<{ episodeId: string }> },
) => {
  const { episodeId } = await params;

  try {
    return await resolveArtworkResponse(episodeId);
  } catch (error) {
    return NextResponse.json(
      {
        error:
          error instanceof Error
            ? error.message
            : "Failed to resolve featured podcast artwork",
      },
      { status: 500, headers: { "Cache-Control": "no-store" } },
    );
  }
};

export const HEAD = GET;
