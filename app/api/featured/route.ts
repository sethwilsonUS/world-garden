import { NextResponse } from "next/server";
import { filterSafeTitles } from "@/lib/nsfw-filter";

const WIKI_FEATURED_API = "https://en.wikipedia.org/api/rest_v1/feed/featured";
const USER_AGENT =
  "CurioGarden/1.0 (https://curiogarden.org; accessibility-first Wikipedia audio reader)";

const WIKI_HEADERS = { "User-Agent": USER_AGENT } as const;
const FILTER_BATCH_SIZE = 50;

type Thumbnail = { source: string; width: number; height: number };

function dateString(daysAgo = 0): string {
  const d = new Date();
  d.setDate(d.getDate() - daysAgo);
  return `${d.getFullYear()}/${String(d.getMonth() + 1).padStart(2, "0")}/${String(d.getDate()).padStart(2, "0")}`;
}

async function batchFilterSafeTitles(
  titles: string[],
): Promise<Set<string>> {
  const safe = new Set<string>();
  for (let i = 0; i < titles.length; i += FILTER_BATCH_SIZE) {
    const batch = titles.slice(i, i + FILTER_BATCH_SIZE);
    const result = await filterSafeTitles(batch);
    for (const t of result) safe.add(t);
  }
  return safe;
}

/* eslint-disable @typescript-eslint/no-explicit-any */
export async function GET() {
  const feedDate = dateString(0); // which date's feed we requested (for debugging/fallback)
  try {
    const todayRes = await fetch(`${WIKI_FEATURED_API}/${feedDate}`, {
      headers: WIKI_HEADERS,
    });
    if (!todayRes.ok) {
      return NextResponse.json(
        { tfa: null, trending: [] },
        { status: 502 },
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
    // Try today, then yesterday, then 2–3 days back.
    let mostRead: any[] = todayData.mostread?.articles ?? [];
    let trendingDate: string | null = todayData.mostread?.date ?? null;
    for (let daysAgo = 1; mostRead.length === 0 && daysAgo <= 4; daysAgo++) {
      try {
        const res = await fetch(
          `${WIKI_FEATURED_API}/${dateString(daysAgo)}`,
          { headers: WIKI_HEADERS },
        );
        if (res.ok) {
          const data = await res.json();
          mostRead = data.mostread?.articles ?? [];
          trendingDate = data.mostread?.date ?? trendingDate;
        }
      } catch {
        // Fall through to next day
      }
    }

    const candidates = mostRead.map((a: any) => ({
      title: (a.titles?.normalized ?? a.title ?? "") as string,
      extract: (a.extract ?? "") as string,
      views: (a.views ?? 0) as number,
      thumbnail: a.thumbnail as Thumbnail | undefined,
    }));

    let trending = candidates;
    if (candidates.length > 0) {
      const safeTitles = await batchFilterSafeTitles(
        candidates.map((c) => c.title),
      );
      trending = candidates.filter((c) => safeTitles.has(c.title));
    }

    const feedDateIso = feedDate.replace(/\//g, "-"); // YYYY-MM-DD for client parsing
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
    console.error("Featured feed fetch failed:", err);
    return NextResponse.json(
      { tfa: null, trending: [] },
      { status: 502 },
    );
  }
}
