import { notFound } from "next/navigation";
import {
  calendarDayKey,
  formatCalendarDay,
  parseCalendarDaySlug,
} from "@/lib/calendar-day";
import {
  ON_THIS_DAY_SHARE_CARD_MIME_TYPE,
  ON_THIS_DAY_SHARE_CARD_VERSION,
  renderOnThisDayShareCardJpeg,
} from "@/lib/on-this-day-share-card";
import { getStoredOnThisDayShareCard } from "@/lib/on-this-day-share-card-store";
import { shouldUseOnThisDaySnapshotCache } from "@/lib/on-this-day-snapshot";
import { ON_THIS_DAY_OG_SIZE } from "../og-card";

export const dynamic = "force-dynamic";
export const alt =
  "On This Day — Historical events, notable lives, and holidays at Curio Garden";
export const size = ON_THIS_DAY_OG_SIZE;
export const contentType = "image/jpeg";

const STORED_CARD_FETCH_TIMEOUT_MS = 4_000;
const STORED_CARD_CACHE_CONTROL =
  "public, max-age=86400, s-maxage=604800, stale-while-revalidate=2592000";
const FALLBACK_CARD_CACHE_CONTROL = "public, max-age=300, s-maxage=900";

const normalizeStoredImageUrl = (value: string | null): string | null => {
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  if (!trimmed || !URL.canParse(trimmed)) return null;
  const parsed = new URL(trimmed);
  if (parsed.protocol !== "https:" && parsed.protocol !== "http:") {
    return null;
  }
  return parsed.toString();
};

const fetchStoredCardBlob = async (
  imageUrl: string,
  monthDay: string,
): Promise<Uint8Array | null> => {
  const controller = new AbortController();
  const timeout = setTimeout(
    () => controller.abort(),
    STORED_CARD_FETCH_TIMEOUT_MS,
  );

  try {
    const response = await fetch(imageUrl, {
      cache: "no-store",
      signal: controller.signal,
    });

    if (!response.ok) {
      try {
        await response.body?.cancel();
      } catch (cancelError: unknown) {
        console.warn(
          `[on-this-day-og] Failed to cancel non-OK stored card response for ${monthDay}:`,
          cancelError,
        );
      }
      console.warn(
        `[on-this-day-og] Stored share card blob returned HTTP ${response.status} for ${monthDay}`,
      );
      return null;
    }

    const bytes = new Uint8Array(await response.arrayBuffer());
    if (bytes.byteLength === 0) {
      console.warn(
        `[on-this-day-og] Stored share card blob was empty for ${monthDay}`,
      );
      return null;
    }

    return bytes;
  } catch (error: unknown) {
    console.warn(
      `[on-this-day-og] Failed to fetch stored share card blob for ${monthDay}:`,
      error,
    );
    return null;
  } finally {
    clearTimeout(timeout);
  }
};

export default async function OnThisDayCalendarOgImage({
  params,
}: {
  params: Promise<{ day: string }>;
}): Promise<Response> {
  const { day } = await params;
  const parsed = parseCalendarDaySlug(day);
  if (!parsed) {
    notFound();
  }

  const monthDay = calendarDayKey(parsed);

  if (shouldUseOnThisDaySnapshotCache()) {
    try {
      const stored = await getStoredOnThisDayShareCard(monthDay);
      const storedUrl =
        stored && stored.version === ON_THIS_DAY_SHARE_CARD_VERSION
          ? normalizeStoredImageUrl(stored.imageUrl)
          : null;

      if (stored && storedUrl) {
        const storedBytes = await fetchStoredCardBlob(storedUrl, monthDay);
        if (storedBytes) {
          return new Response(Buffer.from(storedBytes), {
            headers: {
              "Content-Type":
                stored.mimeType?.trim() || ON_THIS_DAY_SHARE_CARD_MIME_TYPE,
              "Cache-Control": STORED_CARD_CACHE_CONTROL,
            },
          });
        }
      }
    } catch (error: unknown) {
      console.warn(
        `[on-this-day-og] Failed to load stored share card metadata for ${monthDay}:`,
        error,
      );
    }
  }

  const fallbackBytes = await renderOnThisDayShareCardJpeg({
    dayLabel: formatCalendarDay(parsed),
  });

  return new Response(Buffer.from(fallbackBytes), {
    headers: {
      "Content-Type": ON_THIS_DAY_SHARE_CARD_MIME_TYPE,
      "Cache-Control": FALLBACK_CARD_CACHE_CONTROL,
    },
  });
}
