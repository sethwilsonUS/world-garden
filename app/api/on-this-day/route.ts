import { revalidatePath } from "next/cache";
import { after, NextRequest, NextResponse } from "next/server";
import {
  calendarDayFromUtcDate,
  onThisDayPath,
  parseCalendarDayKey,
  parseLegacyFeedDateToCalendarDay,
  type CalendarDay,
} from "@/lib/calendar-day";
import { paginateOnThisDaySnapshot } from "@/lib/on-this-day";
import {
  ON_THIS_DAY_CATEGORIES,
  type OnThisDayCategory,
  type OnThisDayOrder,
} from "@/lib/on-this-day-contracts";
import {
  getOnThisDayDayRecord,
  triggerSafetyNetRefresh,
} from "@/lib/on-this-day-snapshot";

const NO_CACHE_HEADERS = { "Cache-Control": "no-store" } as const;
const NORMAL_CACHE_HEADERS = {
  "Cache-Control":
    "public, max-age=900, s-maxage=3600, stale-while-revalidate=86400",
} as const;

const buildUndatedCacheHeaders = (nowMs = Date.now()): { "Cache-Control": string } => {
  const now = new Date(nowMs);
  const nextUtcMidnightMs = Date.UTC(
    now.getUTCFullYear(),
    now.getUTCMonth(),
    now.getUTCDate() + 1,
  );
  const secondsUntilMidnight = Math.max(
    1,
    Math.floor((nextUtcMidnightMs - nowMs) / 1000),
  );
  const sMaxAge = Math.min(3600, secondsUntilMidnight);
  const maxAge = Math.min(900, sMaxAge);
  return {
    "Cache-Control": `public, max-age=${maxAge}, s-maxage=${sMaxAge}`,
  };
};

const parseInteger = (
  value: string | null,
  fallback: number,
): number | null => {
  if (value == null) return fallback;
  if (!/^\d+$/u.test(value)) return null;
  const parsed = Number(value);
  return Number.isSafeInteger(parsed) ? parsed : null;
};

const resolveRequestedDay = (
  params: URLSearchParams,
  now = new Date(),
): { day: CalendarDay | null; isExplicitDay: boolean } => {
  const dayParam = params.get("day");
  if (dayParam != null) {
    return { day: parseCalendarDayKey(dayParam), isExplicitDay: true };
  }
  const legacyDateParam = params.get("date");
  if (legacyDateParam != null) {
    return {
      day: parseLegacyFeedDateToCalendarDay(legacyDateParam),
      isExplicitDay: true,
    };
  }
  return { day: calendarDayFromUtcDate(now), isExplicitDay: false };
};

export const GET = async (request: NextRequest) => {
  const nowMs = Date.now();
  const params = request.nextUrl.searchParams;
  const { day: requestedDay, isExplicitDay } = resolveRequestedDay(
    params,
    new Date(nowMs),
  );
  const categoryValue = params.get("category") ?? "selected";
  const orderValue = params.get("order") ?? "newest";
  const offset = parseInteger(params.get("offset"), 0);
  const limit = parseInteger(params.get("limit"), 25);

  if (
    !requestedDay ||
    !ON_THIS_DAY_CATEGORIES.includes(categoryValue as OnThisDayCategory) ||
    (orderValue !== "newest" && orderValue !== "oldest") ||
    offset == null ||
    limit == null ||
    limit < 1
  ) {
    return NextResponse.json(
      { error: "Invalid On This Day request parameters." },
      { status: 400, headers: NO_CACHE_HEADERS },
    );
  }

  try {
    const record = await getOnThisDayDayRecord({
      day: requestedDay,
      allowColdBuild: true,
      now: nowMs,
    });
    if (!record) {
      return NextResponse.json(
        { error: "This day isn't available right now." },
        { status: 503, headers: NO_CACHE_HEADERS },
      );
    }

    if (record.needsSafetyNetRefresh) {
      after(async () => {
        try {
          const result = await triggerSafetyNetRefresh(requestedDay);
          if (
            result &&
            (result.status === "refreshed" || result.status === "degraded")
          ) {
            revalidatePath("/on-this-day");
            revalidatePath(onThisDayPath(requestedDay));
          }
        } catch (refreshError) {
          console.error(
            "[/api/on-this-day] safety-net refresh failed",
            refreshError,
          );
        }
      });
    }

    const body = paginateOnThisDaySnapshot(record.snapshot, {
      category: categoryValue as OnThisDayCategory,
      order: orderValue as OnThisDayOrder,
      offset,
      limit,
      checkedAt: record.checkedAt,
      changedAt: record.changedAt,
      degraded: record.degraded,
    });

    const headers = record.degraded
      ? NO_CACHE_HEADERS
      : isExplicitDay
        ? NORMAL_CACHE_HEADERS
        : buildUndatedCacheHeaders(nowMs);

    return NextResponse.json(body, { headers });
  } catch (error) {
    console.error(
      `[/api/on-this-day] ${error instanceof Error ? error.message : String(error)}`,
    );
    return NextResponse.json(
      { error: "This day isn't available right now." },
      { status: 503, headers: NO_CACHE_HEADERS },
    );
  }
};
