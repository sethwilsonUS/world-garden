import { fetchAction } from "convex/nextjs";
import { anyApi } from "convex/server";
import { NextRequest, NextResponse } from "next/server";
import { createAiCostReportAttestation } from "@/lib/ai-cost-owner-attestation";
import {
  isAuthorizedAiCostOwnerRequest,
  parseAiCostReportRange,
} from "@/lib/ai-cost-report-request";

const NO_STORE_HEADERS = { "Cache-Control": "no-store" } as const;

export const dynamic = "force-dynamic";
export const revalidate = 0;

export const GET = async (request: NextRequest) => {
  const secret = process.env.ANALYTICS_REPORT_SECRET?.trim();
  if (!secret) {
    return NextResponse.json(
      { error: "ANALYTICS_REPORT_SECRET is not configured" },
      { status: 500, headers: NO_STORE_HEADERS },
    );
  }

  if (
    !isAuthorizedAiCostOwnerRequest(
      request.headers.get("authorization"),
      secret,
    )
  ) {
    return NextResponse.json(
      { error: "Unauthorized" },
      { status: 401, headers: NO_STORE_HEADERS },
    );
  }

  const range = parseAiCostReportRange(request.nextUrl);
  if ("error" in range) {
    return NextResponse.json(range, {
      status: 400,
      headers: NO_STORE_HEADERS,
    });
  }

  const { fromDay, toDay } = range;
  try {
    const attestation = await createAiCostReportAttestation({ fromDay, toDay });
    const report = await fetchAction(anyApi.aiCostLedger.readCostReport, {
      fromDay,
      toDay,
      attestation,
    });
    return NextResponse.json(report, { headers: NO_STORE_HEADERS });
  } catch {
    console.warn("[ai-cost-ledger] Owner report generation failed.");
    return NextResponse.json(
      { error: "AI cost report is temporarily unavailable" },
      { status: 502, headers: NO_STORE_HEADERS },
    );
  }
};
