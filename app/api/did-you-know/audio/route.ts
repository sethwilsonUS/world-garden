import { NextRequest, NextResponse } from "next/server";
import {
  getDidYouKnowAudioState,
  resolveDidYouKnowFeedDateIso,
  syncDidYouKnowAudio,
} from "@/lib/did-you-know-audio";
import { getPodcastSiteUrl } from "@/lib/podcast-feed";
import { enforceRouteQuota } from "@/lib/route-rate-limit";

const NO_CACHE_HEADERS = { "Cache-Control": "no-store" } as const;
export const maxDuration = 300;

export const GET = async (req: NextRequest) => {
  try {
    const feedDateIso = resolveDidYouKnowFeedDateIso(
      req.nextUrl.searchParams.get("feedDate") ?? undefined,
    );
    const state = await getDidYouKnowAudioState({ feedDateIso });

    return NextResponse.json(state, {
      status: 200,
      headers: NO_CACHE_HEADERS,
    });
  } catch (error) {
    return NextResponse.json(
      {
        error:
          error instanceof Error
            ? error.message
            : "Failed to load Did You Know audio state",
      },
      {
        status: 500,
        headers: NO_CACHE_HEADERS,
      },
    );
  }
};

export const POST = async (req: NextRequest) => {
  try {
    const body = (await req.json().catch(() => ({}))) as {
      feedDate?: string;
    };
    const feedDateIso = resolveDidYouKnowFeedDateIso(
      body.feedDate ??
        req.nextUrl.searchParams.get("feedDate") ??
        undefined,
    );

    const currentState = await getDidYouKnowAudioState({ feedDateIso });
    if (currentState.status === "ready" || currentState.status === "pending") {
      return NextResponse.json(currentState, {
        status: currentState.status === "ready" ? 200 : 202,
        headers: NO_CACHE_HEADERS,
      });
    }

    const quotaResponse = await enforceRouteQuota({
      req,
      scope: "did-you-know-daily-audio-sync",
      limit: 4,
      windowMs: 10 * 60 * 1000,
      label: "Did You Know audio generation",
    });
    if (quotaResponse) {
      return quotaResponse;
    }

    const result = await syncDidYouKnowAudio({
      baseUrl: getPodcastSiteUrl(req.nextUrl.origin),
      feedDateIso,
    });
    const state = await getDidYouKnowAudioState({ feedDateIso });

    return NextResponse.json(state, {
      status:
        result.status === "created"
          ? 201
          : result.status === "pending"
            ? 202
            : 200,
      headers: NO_CACHE_HEADERS,
    });
  } catch (error) {
    console.error("[/api/did-you-know/audio] sync failed", error);
    return NextResponse.json(
      {
        error:
          error instanceof Error
            ? error.message
            : "Did You Know audio sync failed",
      },
      {
        status: 500,
        headers: NO_CACHE_HEADERS,
      },
    );
  }
};
