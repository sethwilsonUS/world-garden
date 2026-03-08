import { NextRequest, NextResponse } from "next/server";
import { getPodcastAdminAuthError } from "@/lib/podcast-admin-auth";
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

  const body = (await req.json().catch(() => ({}))) as { force?: boolean };

  try {
    const result = await syncDailyTrendingBrief({
      baseUrl: req.nextUrl.origin,
      force: body.force === true,
    });

    return NextResponse.json(result, {
      status: result.status === "created" ? 201 : 200,
      headers: NO_CACHE_HEADERS,
    });
  } catch (error) {
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
