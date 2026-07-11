import { NextRequest, NextResponse } from "next/server";
import { warmLatestHomepageArticleSummaries } from "@/lib/homepage-audio-warm";
import { getPodcastAdminAuthError } from "@/lib/podcast-admin-auth";
import { getPodcastSiteUrl } from "@/lib/podcast-feed";
import { enforceRouteQuota } from "@/lib/route-rate-limit";

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
    scope: "homepage-article-summary-audio-warm",
    limit: 6,
    windowMs: 10 * 60 * 1000,
    label: "Homepage article summary audio warm",
  });
  if (quotaResponse) return quotaResponse;

  try {
    const result = await warmLatestHomepageArticleSummaries({
      baseUrl: getPodcastSiteUrl(req.nextUrl.origin),
    });
    return NextResponse.json(result, { headers: NO_CACHE_HEADERS });
  } catch (error) {
    console.error("[/api/featured/audio-warm/cron] warm failed", error);
    return NextResponse.json(
      { error: "Homepage article summary audio warm failed" },
      { status: 500, headers: NO_CACHE_HEADERS },
    );
  }
};
