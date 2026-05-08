import { NextResponse } from "next/server";
import { fetchWikipediaFeaturedSnapshot } from "@/lib/featured-article";
import { filterSafeTitles } from "@/lib/nsfw-filter";
import { syncPictureOfDayAudio } from "@/lib/picture-of-day-audio";
import { getPodcastSiteUrl } from "@/lib/podcast-feed";

const NO_CACHE_HEADERS = { "Cache-Control": "no-store" } as const;
const FEATURED_CACHE_HEADERS = {
  "Cache-Control":
    "public, max-age=900, s-maxage=900, stale-while-revalidate=3600",
} as const;
export const maxDuration = 300;

const shouldSyncPictureAudio = (): boolean =>
  process.env.NEXT_PUBLIC_LOCAL_MODE !== "true" &&
  Boolean(process.env.NEXT_PUBLIC_CONVEX_URL);

function errorResponse(reason: string, status = 502) {
  console.error(`[/api/featured] ${reason}`);
  return NextResponse.json(
    {
      tfa: null,
      trending: [],
      didYouKnow: [],
      inTheNews: [],
      pictureOfDay: null,
      onThisDay: [],
      error: reason,
    },
    { status, headers: NO_CACHE_HEADERS },
  );
}

export async function GET(req: Request) {
  try {
    const {
      tfa,
      trendingCandidates,
      didYouKnow,
      inTheNews,
      pictureOfDay: sourcePictureOfDay,
      onThisDay,
      trendingDate,
      trendingSource,
      trendingSourceType,
      trendingIsStale,
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

    let pictureOfDay = sourcePictureOfDay;
    let pictureAudioBlocksLongCache = Boolean(
      pictureOfDay && !shouldSyncPictureAudio(),
    );
    if (pictureOfDay && shouldSyncPictureAudio()) {
      try {
        const requestOrigin = new URL(req.url).origin;
        const audioResult = await syncPictureOfDayAudio({
          baseUrl: getPodcastSiteUrl(requestOrigin),
          feedDateIso,
          picture: pictureOfDay,
        });
        const audioUrl = audioResult.audio?.audioUrl ?? null;
        const audioStatus =
          audioResult.status === "created" ||
          audioResult.status === "already_exists"
            ? audioUrl
              ? "ready"
              : "failed"
            : audioResult.status;

        pictureOfDay = {
          ...pictureOfDay,
          audio: {
            status: audioStatus === "missing_source" ? "missing" : audioStatus,
            audioUrl,
            durationSeconds: audioResult.audio?.durationSeconds,
            lastError: audioResult.audio?.lastError,
          },
        };
        pictureAudioBlocksLongCache = audioStatus !== "ready";
      } catch (error) {
        const message =
          error instanceof Error ? error.message : "Picture audio sync failed";
        console.warn(`[/api/featured] picture audio sync failed: ${message}`);
        pictureOfDay = {
          ...pictureOfDay,
          audio: {
            status: "failed",
            audioUrl: null,
            lastError: message,
          },
        };
        pictureAudioBlocksLongCache = true;
      }
    }

    return NextResponse.json(
      {
        tfa,
        trending,
        didYouKnow,
        inTheNews,
        pictureOfDay,
        onThisDay,
        trendingDate,
        trendingSource,
        trendingSourceType,
        trendingIsStale,
        feedDate: feedDateIso,
      },
      {
        headers: pictureAudioBlocksLongCache
          ? NO_CACHE_HEADERS
          : FEATURED_CACHE_HEADERS,
      },
    );
  } catch (err) {
    return errorResponse(
      `Unhandled error: ${err instanceof Error ? err.message : String(err)}`,
    );
  }
}
