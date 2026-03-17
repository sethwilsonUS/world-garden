import { NextResponse } from "next/server";
import { renderPersonalShowPodcastArtworkPng } from "@/lib/personal-show-podcast-artwork";
import { getOrCreatePodcastShowArtworkUrl } from "@/lib/podcast-show-artwork-cache";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const revalidate = 0;

export const GET = async () => {
  try {
    const artworkUrl = await getOrCreatePodcastShowArtworkUrl({
      slug: "personal",
      render: renderPersonalShowPodcastArtworkPng,
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
            : "Failed to resolve personal show artwork",
      },
      { status: 500, headers: { "Cache-Control": "no-store" } },
    );
  }
};

export const HEAD = GET;
