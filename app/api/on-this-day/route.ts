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

const parseInteger = (
  value: string | null,
  fallback: number,
): number | null => {
  if (value == null) return fallback;
  if (!/^\d+$/u.test(value)) return null;
  const parsed = Number(value);
  return Number.isSafeInteger(parsed) ? parsed : null;
};

const resolveRequestedDay = (params: URLSearchParams): CalendarDay | null => {
  const dayParam = params.get("day");
  if (dayParam != null) {
    return parseCalendarDayKey(dayParam);
  }
  const legacyDateParam = params.get("date");
  if (legacyDateParam != null) {
    return parseLegacyFeedDateToCalendarDay(legacyDateParam);
  }
  return calendarDayFromUtcDate();
};

export const GET = async (request: NextRequest) => {
  const params = request.nextUrl.searchParams;
  const requestedDay = resolveRequestedDay(params);
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

    return NextResponse.json(body, {
      headers: record.degraded ? NO_CACHE_HEADERS : NORMAL_CACHE_HEADERS,
    });
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
