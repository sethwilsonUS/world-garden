import { NextRequest, NextResponse } from "next/server";
import { getPodcastAdminAuthError } from "@/lib/podcast-admin-auth";
import { getPodcastSiteUrl } from "@/lib/podcast-feed";
import { enforceRouteQuota } from "@/lib/route-rate-limit";
import { syncDailyTrendingBrief } from "@/lib/trending-brief";

const NO_CACHE_HEADERS = { "Cache-Control": "no-store" } as const;
export const maxDuration = 300;

export const POST = async (req: NextRequest) => {
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
    scope: "trending-daily-audio-sync",
    limit: 6,
    windowMs: 10 * 60 * 1000,
    label: "Trending daily audio generation",
  });
  if (quotaResponse) {
    return quotaResponse;
  }

  const body = (await req.json().catch(() => ({}))) as {
    force?: boolean;
    regenArt?: boolean;
  };

  try {
    const baseUrl = getPodcastSiteUrl(req.nextUrl.origin);
    const result = await syncDailyTrendingBrief({
      baseUrl,
      force: body.force === true,
      regenArt: body.regenArt === true,
    });

    return NextResponse.json(result, {
      status: result.status === "created" ? 201 : 200,
      headers: NO_CACHE_HEADERS,
    });
  } catch (error) {
    console.error("[/api/podcast/trending/sync] sync failed", error);
    return NextResponse.json(
      {
        error:
          error instanceof Error
            ? error.message
            : "Trending podcast sync failed",
      },
      {
        status: 500,
        headers: NO_CACHE_HEADERS,
      },
    );
  }
};
