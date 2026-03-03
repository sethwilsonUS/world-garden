import { NextResponse } from "next/server";
import { filterSafeTitles } from "@/lib/nsfw-filter";

const WIKI_FEATURED_API = "https://en.wikipedia.org/api/rest_v1/feed/featured";
const USER_AGENT =
  "CurioGarden/1.0 (https://curiogarden.org; accessibility-first Wikipedia audio reader)";

const WIKI_HEADERS = { "User-Agent": USER_AGENT } as const;

type Thumbnail = { source: string; width: number; height: number };

const NO_CACHE_HEADERS = { "Cache-Control": "no-store" } as const;

function errorResponse(reason: string, status = 502) {
  console.error(`[/api/featured] ${reason}`);
  return NextResponse.json(
    { tfa: null, trending: [], error: reason },
    { status, headers: NO_CACHE_HEADERS },
  );
}

function dateString(daysAgo = 0): string {
  const d = new Date();
  d.setUTCDate(d.getUTCDate() - daysAgo);
  return `${d.getUTCFullYear()}/${String(d.getUTCMonth() + 1).padStart(2, "0")}/${String(d.getUTCDate()).padStart(2, "0")}`;
}

/* eslint-disable @typescript-eslint/no-explicit-any */
export async function GET() {
  const feedDate = dateString(0);
  try {
    const todayRes = await fetch(`${WIKI_FEATURED_API}/${feedDate}`, {
      headers: WIKI_HEADERS,
    });
    if (!todayRes.ok) {
      return errorResponse(
        `Wikipedia feed returned ${todayRes.status} for ${feedDate}`,
      );
    }
    const todayData = await todayRes.json();

    const tfa = todayData.tfa;
    const tfaResult = tfa
      ? {
          title: (tfa.titles?.normalized ?? tfa.title ?? "") as string,
          extract: (tfa.extract ?? "") as string,
          thumbnail: tfa.thumbnail as Thumbnail | undefined,
          featuredDate: (tfa.timestamp ?? null) as string | null,
        }
      : null;

    // mostread is "previous day's" pageview data — may not be ready for today yet.
    let mostRead: any[] = todayData.mostread?.articles ?? [];
    let trendingDate: string | null = todayData.mostread?.date ?? null;
    let trendingSource = mostRead.length > 0 ? feedDate : null;

    for (let daysAgo = 1; mostRead.length === 0 && daysAgo <= 4; daysAgo++) {
      const fallbackDate = dateString(daysAgo);
      try {
        const res = await fetch(
          `${WIKI_FEATURED_API}/${fallbackDate}`,
          { headers: WIKI_HEADERS },
        );
        if (res.ok) {
          const data = await res.json();
          mostRead = data.mostread?.articles ?? [];
          trendingDate = data.mostread?.date ?? trendingDate;
          if (mostRead.length > 0) trendingSource = fallbackDate;
        }
      } catch {
        // Fall through to next day
      }
    }

    console.log(
      `[/api/featured] feed=${feedDate}, tfa=${tfaResult?.title ?? "none"}, ` +
      `mostread=${mostRead.length} from ${trendingSource ?? "none"}`,
    );

    const candidates = mostRead.map((a: any) => ({
      title: (a.titles?.normalized ?? a.title ?? "") as string,
      extract: (a.extract ?? "") as string,
      views: (a.views ?? 0) as number,
      thumbnail: a.thumbnail as Thumbnail | undefined,
    }));

    let trending = candidates;
    if (candidates.length > 0) {
      const candidateTitles = candidates.map((c) => c.title);
      const safeTitles = await filterSafeTitles(candidateTitles);
      trending = candidates.filter((c) => safeTitles.has(c.title));

      const filtered = candidates.length - trending.length;
      if (filtered > 0) {
        const removed = candidateTitles.filter((t) => !safeTitles.has(t));
        console.log(
          `[/api/featured] NSFW filter removed ${filtered}/${candidates.length}: ${removed.slice(0, 5).join(", ")}${removed.length > 5 ? "..." : ""}`,
        );
      }

      // If filter removed everything, something went wrong — fall back to unfiltered
      if (trending.length === 0 && candidates.length > 0) {
        console.warn(
          `[/api/featured] NSFW filter removed ALL ${candidates.length} articles — returning unfiltered`,
        );
        trending = candidates;
      }
    }

    const feedDateIso = feedDate.replace(/\//g, "-");
    return NextResponse.json(
      { tfa: tfaResult, trending, trendingDate, feedDate: feedDateIso },
      {
        headers: {
          "Cache-Control":
            "public, max-age=900, s-maxage=900, stale-while-revalidate=3600",
        },
      },
    );
  } catch (err) {
    return errorResponse(
      `Unhandled error: ${err instanceof Error ? err.message : String(err)}`,
    );
  }
}
