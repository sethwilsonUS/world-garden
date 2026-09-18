import { NextRequest, NextResponse } from "next/server";
import { getRequestAudioGenerationBaseUrl } from "@/lib/audio-generation-url";
import {
  HOMEPAGE_AUDIO_WARM_DEADLINE_MS,
  HOMEPAGE_AUDIO_WARM_DEADLINE_MESSAGE,
  warmLatestHomepageArticleSummaries,
} from "@/lib/homepage-audio-warm";
import {
  createRequestDeadline,
  runWithAbortSignal,
} from "@/lib/request-deadline";
import { getPodcastAdminAuthError } from "@/lib/podcast-admin-auth";
import { enforceRouteQuota } from "@/lib/route-rate-limit";

const NO_CACHE_HEADERS = { "Cache-Control": "no-store" } as const;
export const maxDuration = 300;

export const GET = async (req: NextRequest) => {
  const startedAt = Date.now();
  const authError = getPodcastAdminAuthError(req.headers.get("authorization"));
  if (authError) {
    return NextResponse.json(
      { error: authError },
      {
        status: authError === "Unauthorized" ? 401 : 500,
        headers: NO_CACHE_HEADERS,
      },
    );
  }

  const deadline = createRequestDeadline(
    HOMEPAGE_AUDIO_WARM_DEADLINE_MS - (Date.now() - startedAt),
    HOMEPAGE_AUDIO_WARM_DEADLINE_MESSAGE,
    req.signal,
  );
  try {
    const quotaResponse = await runWithAbortSignal(deadline.signal, () =>
      enforceRouteQuota({
        req,
        scope: "homepage-article-summary-audio-warm",
        limit: 6,
        windowMs: 10 * 60 * 1000,
        label: "Homepage article summary audio warm",
        signal: deadline.signal,
      }),
    );
    if (quotaResponse) return quotaResponse;

    const result = await warmLatestHomepageArticleSummaries({
      baseUrl: getRequestAudioGenerationBaseUrl(req.url),
      signal: deadline.signal,
    });
    console.info("[homepage-audio-warm] run completed", {
      status: result.status,
      targets: result.targets,
      reused: result.reused,
      generated: result.generated,
      degraded: result.degraded,
      failed: result.failed,
      capped: result.capped,
      deadlineSkipped: result.deadlineSkipped,
      deadlineExceeded: result.deadlineExceeded,
      elapsedMs: Date.now() - startedAt,
    });
    return NextResponse.json(result, { headers: NO_CACHE_HEADERS });
  } catch (error) {
    console.error("[/api/featured/audio-warm/cron] warm failed", error);
    return NextResponse.json(
      { error: "Homepage article summary audio warm failed" },
      {
        status: deadline.signal.aborted ? 503 : 500,
        headers: NO_CACHE_HEADERS,
      },
    );
  } finally {
    deadline.dispose();
  }
};
