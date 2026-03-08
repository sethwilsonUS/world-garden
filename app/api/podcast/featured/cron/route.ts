import { NextRequest, NextResponse } from "next/server";
import { getPodcastAdminAuthError } from "@/lib/podcast-admin-auth";
import { syncFeaturedPodcastEpisode } from "@/lib/podcast-episode";

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

  try {
    const result = await syncFeaturedPodcastEpisode({
      baseUrl: req.nextUrl.origin,
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
            : "Featured podcast cron run failed",
      },
      {
        status: 500,
        headers: NO_CACHE_HEADERS,
      },
    );
  }
};
