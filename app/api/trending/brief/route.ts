import { NextResponse } from "next/server";
import { getDailyTrendingBrief, isTrendingBriefEnabled } from "@/lib/trending-brief";

const NO_CACHE_HEADERS = { "Cache-Control": "no-store" } as const;

export const GET = async (req: Request) => {
  try {
    const brief = await getDailyTrendingBrief({
      baseUrl: new URL(req.url).origin,
    });

    return NextResponse.json(
      { enabled: true, brief },
      { status: 200, headers: NO_CACHE_HEADERS },
    );
  } catch (error) {
    const message =
      error instanceof Error
        ? error.message
        : "Failed to generate trending brief";

    return NextResponse.json(
      {
        enabled: isTrendingBriefEnabled(),
        error: message,
      },
      {
        status:
          message === "AI trend briefing is not configured." ? 503 : 500,
        headers: NO_CACHE_HEADERS,
      },
    );
  }
};
