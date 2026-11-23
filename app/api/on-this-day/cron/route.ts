import { revalidatePath } from "next/cache";
import { NextRequest, NextResponse } from "next/server";
import {
  onThisDayPath,
  parseCalendarDayKey,
  parseCalendarDaySlug,
} from "@/lib/calendar-day";
import { DEFAULT_WORKER_BUDGET_SECONDS } from "@/lib/on-this-day-refresh";
import {
  refreshSingleOnThisDayCalendarDay,
  runOnThisDayRollingRefresh,
} from "@/lib/on-this-day-snapshot";
import { getPodcastAdminAuthError } from "@/lib/podcast-admin-auth";
import { enforceRouteQuota } from "@/lib/route-rate-limit";

const NO_CACHE_HEADERS = { "Cache-Control": "no-store" } as const;
const MIN_BUDGET_SECONDS = 10;
const MAX_BUDGET_SECONDS = 270;
export const maxDuration = 300;

const parseBudgetSeconds = (raw: string | null): number | null => {
  if (raw == null) return DEFAULT_WORKER_BUDGET_SECONDS;
  if (!/^\d+$/u.test(raw)) return null;
  const parsed = Number(raw);
  if (!Number.isSafeInteger(parsed)) return null;
  return Math.max(MIN_BUDGET_SECONDS, Math.min(MAX_BUDGET_SECONDS, parsed));
};

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
    label: "On This Day snapshot refresh",
  });
  if (quotaResponse) return quotaResponse;

  const params = request.nextUrl.searchParams;
  const dayParam = params.get("day");
  const force = params.get("force") === "1" || params.get("force") === "true";

  if (dayParam) {
    const parsedDay =
      parseCalendarDayKey(dayParam) ?? parseCalendarDaySlug(dayParam);
    if (!parsedDay) {
      return NextResponse.json(
        { error: "Invalid Calendar Day parameter." },
        { status: 400, headers: NO_CACHE_HEADERS },
      );
    }

    try {
      const result = await refreshSingleOnThisDayCalendarDay({
        day: parsedDay,
        force,
      });
      if (result.status === "refreshed" || result.status === "degraded") {
        revalidatePath("/on-this-day");
        revalidatePath("/api/on-this-day");
        revalidatePath(onThisDayPath(parsedDay));
      }
      return NextResponse.json(result, {
        status: result.status === "failed" ? 502 : 200,
        headers: NO_CACHE_HEADERS,
      });
    } catch (error) {
      console.error("[/api/on-this-day/cron] single-day refresh failed", error);
      return NextResponse.json(
        { error: "On This Day snapshot refresh failed." },
        { status: 500, headers: NO_CACHE_HEADERS },
      );
    }
  }

  const budgetSeconds = parseBudgetSeconds(params.get("budgetSeconds"));
  if (budgetSeconds == null) {
    return NextResponse.json(
      { error: "Invalid budgetSeconds parameter." },
      { status: 400, headers: NO_CACHE_HEADERS },
    );
  }

  try {
    const summary = await runOnThisDayRollingRefresh({ budgetSeconds });
    if (summary.refreshedDays.length > 0) {
      revalidatePath("/on-this-day");
      revalidatePath("/api/on-this-day");
      for (const day of summary.refreshedDays) {
        revalidatePath(onThisDayPath(day));
      }
    }

    return NextResponse.json(
      {
        refreshed: summary.refreshed,
        unchanged: summary.unchanged,
        degraded: summary.degraded,
        suspicious: summary.suspicious,
        failed: summary.failed,
        remainingStale: summary.remainingStale,
        oldestCheckedAt: summary.oldestCheckedAt,
        ...(summary.stoppedEarlyReason
          ? { stoppedEarlyReason: summary.stoppedEarlyReason }
          : {}),
      },
      {
        status: 200,
        headers: NO_CACHE_HEADERS,
      },
    );
  } catch (error) {
    console.error("[/api/on-this-day/cron] rolling refresh failed", error);
    return NextResponse.json(
      { error: "On This Day rolling refresh failed." },
      { status: 500, headers: NO_CACHE_HEADERS },
    );
  }
};
