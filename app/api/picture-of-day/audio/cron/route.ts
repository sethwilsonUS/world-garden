import { revalidatePath } from "next/cache";
import { NextRequest, NextResponse } from "next/server";
import {
  resolvePictureOfDayFeedDateIso,
  syncCurrentPictureOfDayAudio,
} from "@/lib/picture-of-day-audio";
import { getPodcastAdminAuthError } from "@/lib/podcast-admin-auth";
import { getPodcastSiteUrl } from "@/lib/podcast-feed";
import { enforceRouteQuota } from "@/lib/route-rate-limit";

const NO_CACHE_HEADERS = { "Cache-Control": "no-store" } as const;
export const maxDuration = 300;

export const GET = async (req: NextRequest) => {
  const authError = getPodcastAdminAuthError(
    req.headers.get("authorization"),
  );
  if (authError) {
    return NextResponse.json(
      { error: authError },
      {
        status: authError === "Unauthorized" ? 401 : 500,
        headers: NO_CACHE_HEADERS,
      },
    );
  }

  const quotaResponse = await enforceRouteQuota({
    req,
    scope: "picture-of-day-daily-audio-sync",
    limit: 6,
    windowMs: 10 * 60 * 1000,
    label: "Picture of the Day audio generation",
  });
  if (quotaResponse) {
    return quotaResponse;
  }

  try {
    const result = await syncCurrentPictureOfDayAudio({
      baseUrl: getPodcastSiteUrl(req.nextUrl.origin),
    });

    if (
      result.status !== "pending" &&
      result.status !== "missing_source" &&
      result.feedDate === resolvePictureOfDayFeedDateIso()
    ) {
      revalidatePath("/");
    }

    return NextResponse.json(result, {
      status:
        result.status === "created"
          ? 201
          : result.status === "pending"
            ? 202
            : result.status === "missing_source"
              ? 404
              : 200,
      headers: NO_CACHE_HEADERS,
    });
  } catch (error) {
    console.error("[/api/picture-of-day/audio/cron] sync failed", error);
    return NextResponse.json(
      {
        error:
          error instanceof Error
            ? error.message
            : "Picture of the Day audio cron run failed",
      },
      {
        status: 500,
        headers: NO_CACHE_HEADERS,
      },
    );
  }
};
