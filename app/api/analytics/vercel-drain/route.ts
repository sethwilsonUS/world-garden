import { fetchMutation } from "convex/nextjs";
import { anyApi } from "convex/server";
import { NextRequest, NextResponse } from "next/server";
import {
  buildAnalyticsRollups,
  parseVercelAnalyticsDrainPayload,
  verifyVercelDrainSignature,
} from "@/lib/vercel-analytics-drain";

const NO_CACHE_HEADERS = { "Cache-Control": "no-store" } as const;

export const dynamic = "force-dynamic";
export const revalidate = 0;

const getDrainSecret = (): string | null => {
  const secret = process.env.VERCEL_ANALYTICS_DRAIN_SECRET?.trim();
  return secret || null;
};

export const POST = async (req: NextRequest) => {
  const secret = getDrainSecret();
  if (!secret) {
    return NextResponse.json(
      { error: "VERCEL_ANALYTICS_DRAIN_SECRET is not configured" },
      { status: 500, headers: NO_CACHE_HEADERS },
    );
  }

  const rawBody = await req.text();
  const signature = req.headers.get("x-vercel-signature");
  if (!verifyVercelDrainSignature(rawBody, signature, secret)) {
    return NextResponse.json(
      { error: "Invalid Vercel Analytics Drain signature" },
      { status: 403, headers: NO_CACHE_HEADERS },
    );
  }

  let rollups;
  let accepted = 0;
  try {
    const events = parseVercelAnalyticsDrainPayload(rawBody);
    accepted = events.length;
    rollups = buildAnalyticsRollups(events);
  } catch {
    return NextResponse.json(
      { error: "Invalid Vercel Analytics Drain payload" },
      { status: 400, headers: NO_CACHE_HEADERS },
    );
  }

  if (rollups.length > 0) {
    await fetchMutation(anyApi.analyticsRollups.upsertAnalyticsRollups, {
      rollups,
    });
  }

  return NextResponse.json(
    { accepted, rollups: rollups.length },
    { headers: NO_CACHE_HEADERS },
  );
};
