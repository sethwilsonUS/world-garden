import { NextResponse } from "next/server";
import { filterSafeTitles } from "@/lib/nsfw-filter";

const WIKI_FEATURED_API = "https://en.wikipedia.org/api/rest_v1/feed/featured";
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
  try {
    const todayRes = await fetch(`${WIKI_FEATURED_API}/${dateString(0)}`);
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
        }
      : null;

    // mostread may not be compiled yet for today — fall back to yesterday
    let mostRead: any[] = todayData.mostread?.articles ?? [];
    if (mostRead.length === 0) {
      try {
        const yesterdayRes = await fetch(
          `${WIKI_FEATURED_API}/${dateString(1)}`,
        );
        if (yesterdayRes.ok) {
          const yesterdayData = await yesterdayRes.json();
          mostRead = yesterdayData.mostread?.articles ?? [];
        }
      } catch {
        // Fall through with empty mostRead
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

    return NextResponse.json(
      { tfa: tfaResult, trending },
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
