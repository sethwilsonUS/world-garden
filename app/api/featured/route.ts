import { NextResponse } from "next/server";
import { fetchWikipediaFeaturedSnapshot } from "@/lib/featured-article";
import { filterSafeTitles } from "@/lib/nsfw-filter";

const NO_CACHE_HEADERS = { "Cache-Control": "no-store" } as const;

function errorResponse(reason: string, status = 502) {
  console.error(`[/api/featured] ${reason}`);
  return NextResponse.json(
    { tfa: null, trending: [], error: reason },
    { status, headers: NO_CACHE_HEADERS },
  );
}

export async function GET() {
  try {
    const {
      tfa,
      trendingCandidates,
      trendingDate,
      trendingSource,
      feedDate,
      feedDateIso,
    } = await fetchWikipediaFeaturedSnapshot();

    console.log(
      `[/api/featured] feed=${feedDate}, tfa=${tfa?.title ?? "none"}, ` +
      `mostread=${trendingCandidates.length} from ${trendingSource ?? "none"}`,
    );

    let trending = trendingCandidates;
    if (trendingCandidates.length > 0) {
      const candidateTitles = trendingCandidates.map((c) => c.title);
      const safeTitles = await filterSafeTitles(candidateTitles);
      trending = trendingCandidates.filter((c) => safeTitles.has(c.title));

      const filtered = trendingCandidates.length - trending.length;
      if (filtered > 0) {
        const removed = candidateTitles.filter((t) => !safeTitles.has(t));
        console.log(
          `[/api/featured] NSFW filter removed ${filtered}/${trendingCandidates.length}: ${removed.slice(0, 5).join(", ")}${removed.length > 5 ? "..." : ""}`,
        );
      }

      // If filter removed everything, something went wrong — fall back to unfiltered
      if (trending.length === 0 && trendingCandidates.length > 0) {
        console.warn(
          `[/api/featured] NSFW filter removed ALL ${trendingCandidates.length} articles — returning unfiltered`,
        );
        trending = trendingCandidates;
      }
    }

    return NextResponse.json(
      { tfa, trending, trendingDate, feedDate: feedDateIso },
      {
        headers: {
          "Cache-Control":
            "public, max-age=900, s-maxage=900, stale-while-revalidate=3600",
        },
      },
    );
  } catch (err) {
    return errorResponse(
      `Unhandled error: ${err instanceof Error ? err.message : String(err)}`,
    );
  }
}
