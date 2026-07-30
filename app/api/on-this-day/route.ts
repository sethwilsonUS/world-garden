import { NextRequest, NextResponse } from "next/server";
import {
  paginateOnThisDaySnapshot,
} from "@/lib/on-this-day";
import {
  ON_THIS_DAY_CATEGORIES,
  type OnThisDayCategory,
  type OnThisDayOrder,
} from "@/lib/on-this-day-contracts";
import {
  getOnThisDaySnapshot,
  resolveOnThisDayFeedDate,
} from "@/lib/on-this-day-snapshot";

const NO_CACHE_HEADERS = { "Cache-Control": "no-store" } as const;
const CURRENT_CACHE_HEADERS = {
  "Cache-Control":
    "public, max-age=900, s-maxage=900, stale-while-revalidate=3600",
} as const;
const ARCHIVE_CACHE_HEADERS = {
  "Cache-Control":
    "public, max-age=3600, s-maxage=86400, stale-while-revalidate=604800",
} as const;

const isValidDate = (value: string): boolean => {
  const match = value.match(/^(\d{4})-(\d{2})-(\d{2})$/u);
  if (!match) return false;
  const date = new Date(`${value}T00:00:00Z`);
  return (
    !Number.isNaN(date.getTime()) &&
    date.getUTCFullYear() === Number(match[1]) &&
    date.getUTCMonth() + 1 === Number(match[2]) &&
    date.getUTCDate() === Number(match[3])
  );
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

export const GET = async (request: NextRequest) => {
  const params = request.nextUrl.searchParams;
  const currentDate = resolveOnThisDayFeedDate();
  const requestedDate = params.get("date") ?? currentDate;
  const categoryValue = params.get("category") ?? "selected";
  const orderValue = params.get("order") ?? "newest";
  const offset = parseInteger(params.get("offset"), 0);
  const limit = parseInteger(params.get("limit"), 25);

  if (
    !isValidDate(requestedDate) ||
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
    const snapshot = await getOnThisDaySnapshot({
      requestedDate,
      allowLiveFallback: requestedDate === currentDate,
    });
    if (!snapshot) {
      return NextResponse.json(
        {
          error:
            requestedDate === currentDate
              ? "Today's On This Day edition is not available yet."
              : "That archived On This Day edition is not available.",
        },
        {
          status: requestedDate === currentDate ? 503 : 404,
          headers: NO_CACHE_HEADERS,
        },
      );
    }

    const body = paginateOnThisDaySnapshot(snapshot, {
      requestedDate,
      category: categoryValue as OnThisDayCategory,
      order: orderValue as OnThisDayOrder,
      offset,
      limit,
    });
    return NextResponse.json(body, {
      headers: body.snapshotIsStale
        ? NO_CACHE_HEADERS
        : requestedDate === currentDate
          ? CURRENT_CACHE_HEADERS
          : ARCHIVE_CACHE_HEADERS,
    });
  } catch (error) {
    console.error(
      `[/api/on-this-day] ${error instanceof Error ? error.message : String(error)}`,
    );
    return NextResponse.json(
      { error: "Unable to load On This Day right now." },
      { status: 502, headers: NO_CACHE_HEADERS },
    );
  }
};
