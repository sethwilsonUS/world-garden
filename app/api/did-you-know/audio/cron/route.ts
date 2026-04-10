import { revalidatePath } from "next/cache";
import { NextRequest, NextResponse } from "next/server";
import {
  resolveDidYouKnowFeedDateIso,
  syncDidYouKnowAudio,
} from "@/lib/did-you-know-audio";
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
    scope: "did-you-know-daily-audio-sync",
    limit: 6,
    windowMs: 10 * 60 * 1000,
    label: "Did You Know daily audio generation",
  });
  if (quotaResponse) {
    return quotaResponse;
  }

  try {
    const result = await syncDidYouKnowAudio({
      baseUrl: getPodcastSiteUrl(req.nextUrl.origin),
    });

    if (
      result.status !== "pending" &&
      result.feedDate === resolveDidYouKnowFeedDateIso()
    ) {
      revalidatePath("/did-you-know");
    }

    return NextResponse.json(result, {
      status:
        result.status === "created"
          ? 201
          : result.status === "pending"
            ? 202
            : 200,
      headers: NO_CACHE_HEADERS,
    });
  } catch (error) {
    console.error("[/api/did-you-know/audio/cron] sync failed", error);
    return NextResponse.json(
      {
        error:
          error instanceof Error
            ? error.message
            : "Did You Know audio cron run failed",
      },
      {
        status: 500,
        headers: NO_CACHE_HEADERS,
      },
    );
  }
};
