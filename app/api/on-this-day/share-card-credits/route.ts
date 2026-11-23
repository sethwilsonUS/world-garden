import { NextRequest, NextResponse } from "next/server";
import { calendarDayKey, parseCalendarDaySlug } from "@/lib/calendar-day";
import {
  getStoredOnThisDayShareCard,
  getStoredOnThisDayShareCardCreditsByRevision,
  isValidShareCardCreditRevisionId,
  type StoredOnThisDayShareCardPlate,
} from "@/lib/on-this-day-share-card-store";

export const dynamic = "force-dynamic";

const NO_CACHE_HEADERS = { "Cache-Control": "no-store" } as const;
const CREDITS_CACHE_HEADERS = {
  "Cache-Control":
    "public, max-age=3600, s-maxage=86400, stale-while-revalidate=604800",
} as const;
const IMMUTABLE_CREDITS_CACHE_HEADERS = {
  "Cache-Control": "public, max-age=86400, s-maxage=31536000, immutable",
} as const;

const serializePlates = (
  plates: readonly StoredOnThisDayShareCardPlate[],
): StoredOnThisDayShareCardPlate[] =>
  plates.map((plate) => ({
    ...(plate.year === undefined ? {} : { year: plate.year }),
    articleTitle: plate.articleTitle,
    imageUrl: plate.imageUrl,
    ...(plate.licenseName ? { licenseName: plate.licenseName } : {}),
    ...(plate.creator ? { creator: plate.creator } : {}),
    ...(plate.sourceUrl ? { sourceUrl: plate.sourceUrl } : {}),
  }));

export const GET = async (request: NextRequest) => {
  const params = request.nextUrl.searchParams;
  const rawRev = params.get("rev");
  const rawDay = params.get("day");

  const parsedDay = rawDay !== null ? parseCalendarDaySlug(rawDay) : null;
  if (rawDay !== null && !parsedDay) {
    return NextResponse.json(
      {
        error:
          "Invalid 'day' query parameter. Expected MM-DD (e.g. 10-18) or a calendar day slug (e.g. october-18).",
      },
      { status: 400, headers: NO_CACHE_HEADERS },
    );
  }

  const expectedMonthDay = parsedDay ? calendarDayKey(parsedDay) : null;

  if (rawRev !== null) {
    const trimmedRev = rawRev.trim();
    if (!isValidShareCardCreditRevisionId(trimmedRev)) {
      return NextResponse.json(
        {
          error:
            "Invalid 'rev' query parameter. Expected 6-64 characters matching [a-z0-9_-].",
        },
        { status: 400, headers: NO_CACHE_HEADERS },
      );
    }

    try {
      const revision =
        await getStoredOnThisDayShareCardCreditsByRevision(trimmedRev);
      if (
        !revision ||
        (expectedMonthDay !== null && revision.monthDay !== expectedMonthDay)
      ) {
        return NextResponse.json(
          {
            error: `No stored On This Day Share Card credit revision found for ${trimmedRev}.`,
          },
          { status: 404, headers: NO_CACHE_HEADERS },
        );
      }

      return NextResponse.json(
        {
          revisionId: revision.revisionId,
          monthDay: revision.monthDay,
          version: revision.version,
          generatedAt: revision.generatedAt,
          plates: serializePlates(revision.plates),
        },
        { headers: IMMUTABLE_CREDITS_CACHE_HEADERS },
      );
    } catch (error: unknown) {
      console.error(
        `[/api/on-this-day/share-card-credits] Failed loading revision ${trimmedRev}:`,
        error,
      );
      return NextResponse.json(
        { error: "Share card credits are temporarily unavailable." },
        { status: 503, headers: NO_CACHE_HEADERS },
      );
    }
  }

  if (!expectedMonthDay) {
    return NextResponse.json(
      {
        error:
          "Missing 'day' or 'rev' query parameter. Expected MM-DD (e.g. 10-18), a calendar day slug (e.g. october-18), or rev.",
      },
      { status: 400, headers: NO_CACHE_HEADERS },
    );
  }

  try {
    const card = await getStoredOnThisDayShareCard(expectedMonthDay);
    if (!card) {
      return NextResponse.json(
        {
          error: `No stored On This Day Share Card found for ${expectedMonthDay}.`,
        },
        { status: 404, headers: NO_CACHE_HEADERS },
      );
    }

    return NextResponse.json(
      {
        monthDay: card.monthDay,
        version: card.version,
        generatedAt: card.generatedAt,
        ...(card.creditRevisionId
          ? { creditRevisionId: card.creditRevisionId }
          : {}),
        plates: serializePlates(card.plates),
      },
      { headers: CREDITS_CACHE_HEADERS },
    );
  } catch (error: unknown) {
    console.error(
      `[/api/on-this-day/share-card-credits] Failed loading credits for ${expectedMonthDay}:`,
      error,
    );
    return NextResponse.json(
      { error: "Share card credits are temporarily unavailable." },
      { status: 503, headers: NO_CACHE_HEADERS },
    );
  }
};
