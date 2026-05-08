import { revalidatePath } from "next/cache";
import { NextRequest, NextResponse } from "next/server";
import { getPodcastAdminAuthError } from "@/lib/podcast-admin-auth";
import { getPodcastSiteUrl } from "@/lib/podcast-feed";
import { enforceRouteQuota } from "@/lib/route-rate-limit";
import {
  resolveTodayFeedDateIso,
  syncTodayWikipediaSnapshot,
} from "@/lib/today-snapshot";

const NO_CACHE_HEADERS = { "Cache-Control": "no-store" } as const;
export const maxDuration = 300;

export const GET = async (req: NextRequest) => {
  const authError = getPodcastAdminAuthError(req.headers.get("authorization"));
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
    scope: "today-wikipedia-snapshot-sync",
    limit: 6,
    windowMs: 10 * 60 * 1000,
    label: "Today on Wikipedia snapshot sync",
  });
  if (quotaResponse) return quotaResponse;

  try {
    const result = await syncTodayWikipediaSnapshot({
      baseUrl: getPodcastSiteUrl(req.nextUrl.origin),
    });

    if (result.feedDate === resolveTodayFeedDateIso()) {
      revalidatePath("/");
    }

    return NextResponse.json(result, {
      status: 201,
      headers: NO_CACHE_HEADERS,
    });
  } catch (error) {
    console.error("[/api/featured/cron] sync failed", error);
    return NextResponse.json(
      {
        error:
          error instanceof Error
            ? error.message
            : "Today on Wikipedia snapshot cron run failed",
      },
      {
        status: 500,
        headers: NO_CACHE_HEADERS,
      },
    );
  }
};
