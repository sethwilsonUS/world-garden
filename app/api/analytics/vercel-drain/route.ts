import { createHash } from "node:crypto";
import { fetchAction } from "convex/nextjs";
import { anyApi } from "convex/server";
import { NextRequest, NextResponse } from "next/server";
import {
  buildAnalyticsRollups,
  parseVercelAnalyticsDrainPayload,
  verifyVercelDrainSignature,
} from "@/lib/vercel-analytics-drain";

const NO_CACHE_HEADERS = { "Cache-Control": "no-store" } as const;
const DELIVERY_TTL_MS = 48 * 60 * 60 * 1000;

export const dynamic = "force-dynamic";
export const revalidate = 0;

const getDrainSecret = (): string | null => {
  const secret = process.env.VERCEL_ANALYTICS_DRAIN_SECRET?.trim();
  return secret || null;
};

const getReportSecret = (): string | null => {
  const secret = process.env.ANALYTICS_REPORT_SECRET?.trim();
  return secret || null;
};

const getDeliveryKey = (rawBody: string): string =>
  createHash("sha256").update(rawBody).digest("hex");

export const POST = async (req: NextRequest) => {
  const secret = getDrainSecret();
  if (!secret) {
    return NextResponse.json(
      { error: "VERCEL_ANALYTICS_DRAIN_SECRET is not configured" },
      { status: 500, headers: NO_CACHE_HEADERS },
    );
  }
  const reportSecret = getReportSecret();
  if (!reportSecret) {
    return NextResponse.json(
      { error: "ANALYTICS_REPORT_SECRET is not configured" },
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

  const deliveryKey = getDeliveryKey(rawBody);
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
    const result = await fetchAction(anyApi.analyticsRollups.ingestAnalyticsRollups, {
      adminSecret: reportSecret,
      deliveryKey,
      deliveryExpiresAt: Date.now() + DELIVERY_TTL_MS,
      rollups,
    });
    return NextResponse.json(
      { accepted, rollups: rollups.length, duplicate: Boolean(result?.duplicate) },
      { headers: NO_CACHE_HEADERS },
    );
  }

  return NextResponse.json(
    { accepted, rollups: rollups.length, duplicate: false },
    { headers: NO_CACHE_HEADERS },
  );
};
