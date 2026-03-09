import { NextResponse } from "next/server";
import { getOrCreatePodcastShowArtworkUrl } from "@/lib/podcast-show-artwork-cache";
import { renderFeaturedShowPodcastArtworkPng } from "@/lib/featured-show-podcast-artwork";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const revalidate = 0;

export const GET = async () => {
  try {
    const artworkUrl = await getOrCreatePodcastShowArtworkUrl({
      slug: "featured",
      render: renderFeaturedShowPodcastArtworkPng,
    });

    return NextResponse.redirect(artworkUrl, {
      status: 307,
      headers: {
        "Cache-Control":
          "public, max-age=86400, s-maxage=86400, stale-while-revalidate=604800",
      },
    });
  } catch (error) {
    return NextResponse.json(
      {
        error:
          error instanceof Error
            ? error.message
            : "Failed to resolve featured show artwork",
      },
      { status: 500, headers: { "Cache-Control": "no-store" } },
    );
  }
};
