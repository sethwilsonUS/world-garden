import { fetchQuery } from "convex/nextjs";
import { anyApi } from "convex/server";
import { NextRequest, NextResponse } from "next/server";

const NO_CACHE_HEADERS = { "Cache-Control": "no-store" } as const;

export const dynamic = "force-dynamic";
export const revalidate = 0;

const getReportSecret = (): string | null => {
  const secret = process.env.ANALYTICS_REPORT_SECRET?.trim();
  return secret || null;
};

const isAuthorized = (req: NextRequest, secret: string): boolean =>
  req.headers.get("authorization") === `Bearer ${secret}`;

const parseRange = (
  req: NextRequest,
): { since: number; until: number } | { error: string } => {
  const since = Number(req.nextUrl.searchParams.get("since"));
  const until = Number(req.nextUrl.searchParams.get("until"));

  if (!Number.isFinite(since) || !Number.isFinite(until)) {
    return { error: "since and until must be millisecond timestamps" };
  }

  if (since < 0 || until <= since) {
    return { error: "since must be before until" };
  }

  return { since, until };
};

export const GET = async (req: NextRequest) => {
  const secret = getReportSecret();
  if (!secret) {
    return NextResponse.json(
      { error: "ANALYTICS_REPORT_SECRET is not configured" },
      { status: 500, headers: NO_CACHE_HEADERS },
    );
  }

  if (!isAuthorized(req, secret)) {
    return NextResponse.json(
      { error: "Unauthorized" },
      { status: 401, headers: NO_CACHE_HEADERS },
    );
  }

  const range = parseRange(req);
  if ("error" in range) {
    return NextResponse.json(
      { error: range.error },
      { status: 400, headers: NO_CACHE_HEADERS },
    );
  }

  const rollups = await fetchQuery(anyApi.analyticsRollups.getAnalyticsRollups, {
    since: range.since,
    until: range.until,
  });

  return NextResponse.json(
    { since: range.since, until: range.until, rollups },
    { headers: NO_CACHE_HEADERS },
  );
};
