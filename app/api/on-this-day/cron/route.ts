import { revalidatePath } from "next/cache";
import { NextRequest, NextResponse } from "next/server";
import { syncOnThisDaySnapshot } from "@/lib/on-this-day-snapshot";
import { getPodcastAdminAuthError } from "@/lib/podcast-admin-auth";
import { enforceRouteQuota } from "@/lib/route-rate-limit";

const NO_CACHE_HEADERS = { "Cache-Control": "no-store" } as const;
export const maxDuration = 300;

export const GET = async (request: NextRequest) => {
  const authError = getPodcastAdminAuthError(
    request.headers.get("authorization"),
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
    req: request,
    scope: "on-this-day-snapshot-sync",
    limit: 6,
    windowMs: 10 * 60 * 1000,
    label: "On This Day snapshot sync",
  });
  if (quotaResponse) return quotaResponse;

  try {
    const snapshot = await syncOnThisDaySnapshot();
    revalidatePath("/on-this-day");
    revalidatePath("/api/on-this-day");
    return NextResponse.json(snapshot, {
      status: 201,
      headers: NO_CACHE_HEADERS,
    });
  } catch (error) {
    console.error("[/api/on-this-day/cron] sync failed", error);
    return NextResponse.json(
      { error: "On This Day snapshot sync failed." },
      { status: 500, headers: NO_CACHE_HEADERS },
    );
  }
};
