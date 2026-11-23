import { NextRequest, NextResponse } from "next/server";
import { calendarDayKey, parseCalendarDaySlug } from "@/lib/calendar-day";
import { getStoredOnThisDayShareCard } from "@/lib/on-this-day-share-card-store";

export const dynamic = "force-dynamic";

const NO_CACHE_HEADERS = { "Cache-Control": "no-store" } as const;
const CREDITS_CACHE_HEADERS = {
  "Cache-Control":
    "public, max-age=3600, s-maxage=86400, stale-while-revalidate=604800",
} as const;

export const GET = async (request: NextRequest) => {
  const rawDay = request.nextUrl.searchParams.get("day");
  const parsed = rawDay ? parseCalendarDaySlug(rawDay) : null;
  if (!parsed) {
    return NextResponse.json(
      {
        error:
          "Invalid or missing 'day' query parameter. Expected MM-DD (e.g. 10-18) or a calendar day slug (e.g. october-18).",
      },
      { status: 400, headers: NO_CACHE_HEADERS },
    );
  }

  const monthDay = calendarDayKey(parsed);

  try {
    const card = await getStoredOnThisDayShareCard(monthDay);
    if (!card) {
      return NextResponse.json(
        { error: `No stored On This Day Share Card found for ${monthDay}.` },
        { status: 404, headers: NO_CACHE_HEADERS },
      );
    }

    return NextResponse.json(
      {
        monthDay: card.monthDay,
        version: card.version,
        generatedAt: card.generatedAt,
        plates: card.plates.map((plate) => ({
          ...(plate.year === undefined ? {} : { year: plate.year }),
          articleTitle: plate.articleTitle,
          imageUrl: plate.imageUrl,
          ...(plate.licenseName ? { licenseName: plate.licenseName } : {}),
          ...(plate.creator ? { creator: plate.creator } : {}),
          ...(plate.sourceUrl ? { sourceUrl: plate.sourceUrl } : {}),
        })),
      },
      { headers: CREDITS_CACHE_HEADERS },
    );
  } catch (error: unknown) {
    console.error(
      `[/api/on-this-day/share-card-credits] Failed loading credits for ${monthDay}:`,
      error,
    );
    return NextResponse.json(
      { error: "Share card credits are temporarily unavailable." },
      { status: 503, headers: NO_CACHE_HEADERS },
    );
  }
};
