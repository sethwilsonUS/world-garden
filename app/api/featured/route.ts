import { NextResponse } from "next/server";
import { getDidYouKnowAudioState } from "@/lib/did-you-know-audio";
import { getPictureOfDayAudioState } from "@/lib/picture-of-day-audio";
import { getTodayWikipediaData } from "@/lib/today-snapshot";

const NO_CACHE_HEADERS = { "Cache-Control": "no-store" } as const;
const FEATURED_CACHE_HEADERS = {
  "Cache-Control":
    "public, max-age=900, s-maxage=900, stale-while-revalidate=3600",
} as const;

const withAudioState = async (
  data: NonNullable<Awaited<ReturnType<typeof getTodayWikipediaData>>>,
) => {
  const [didYouKnowAudio, pictureAudio] = await Promise.all([
    getDidYouKnowAudioState({ feedDateIso: data.feedDate }).catch(() => null),
    data.pictureOfDay
      ? getPictureOfDayAudioState({
          feedDateIso: data.feedDate,
          picture: data.pictureOfDay,
        }).catch(() => null)
      : Promise.resolve(null),
  ]);

  return {
    ...data,
    ...(didYouKnowAudio ? { didYouKnowAudio } : {}),
    pictureOfDay:
      data.pictureOfDay && pictureAudio
        ? {
            ...data.pictureOfDay,
            audio: pictureAudio,
          }
        : data.pictureOfDay,
  };
};

export async function GET() {
  try {
    const data = await getTodayWikipediaData({ allowLiveFallback: true });

    if (!data) {
      return NextResponse.json(
        {
          tfa: null,
          trending: [],
          didYouKnow: [],
          inTheNews: [],
          pictureOfDay: null,
          onThisDay: [],
          error: "No Today on Wikipedia snapshot is available yet.",
        },
        { status: 503, headers: NO_CACHE_HEADERS },
      );
    }

    const body = await withAudioState(data);

    return NextResponse.json(body, {
      headers: body.snapshotIsStale ? NO_CACHE_HEADERS : FEATURED_CACHE_HEADERS,
    });
  } catch (err) {
    const reason = `Unhandled error: ${
      err instanceof Error ? err.message : String(err)
    }`;
    console.error(`[/api/featured] ${reason}`);
    return NextResponse.json(
      {
        tfa: null,
        trending: [],
        didYouKnow: [],
        inTheNews: [],
        pictureOfDay: null,
        onThisDay: [],
        error: reason,
      },
      { status: 502, headers: NO_CACHE_HEADERS },
    );
  }
}
