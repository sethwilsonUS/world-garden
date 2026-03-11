import { NextResponse } from "next/server";
import { getDailyTrendingBriefState } from "@/lib/trending-brief";

const NO_CACHE_HEADERS = { "Cache-Control": "no-store" } as const;

export const GET = async (req: Request) => {
  try {
    void req;
    const state = await getDailyTrendingBriefState();

    return NextResponse.json(
      state,
      { status: 200, headers: NO_CACHE_HEADERS },
    );
  } catch (error) {
    const message =
      error instanceof Error
        ? error.message
        : "Failed to generate trending brief";

    return NextResponse.json(
      {
        enabled: false,
        error: message,
      },
      {
        status: 500,
        headers: NO_CACHE_HEADERS,
      },
    );
  }
};
