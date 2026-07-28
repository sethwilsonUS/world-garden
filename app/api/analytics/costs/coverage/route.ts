import { fetchAction } from "convex/nextjs";
import { anyApi } from "convex/server";
import { NextRequest, NextResponse } from "next/server";
import {
  createAiCostCoverageResetAttestation,
  parseAiCostCoverageReset,
} from "@/lib/ai-cost-owner-attestation";
import { isAuthorizedAiCostOwnerRequest } from "@/lib/ai-cost-report-request";

const NO_STORE_HEADERS = { "Cache-Control": "no-store" } as const;

export const dynamic = "force-dynamic";
export const revalidate = 0;

export const POST = async (request: NextRequest) => {
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

  let reset;
  try {
    reset = parseAiCostCoverageReset(await request.json());
  } catch {
    return NextResponse.json(
      { error: "Coverage epoch reset is invalid" },
      { status: 400, headers: NO_STORE_HEADERS },
    );
  }

  try {
    const attestation = await createAiCostCoverageResetAttestation(reset);
    const result = await fetchAction(anyApi.aiCostLedger.resetCoverageEpoch, {
      reset,
      attestation,
    });
    return NextResponse.json(result, { headers: NO_STORE_HEADERS });
  } catch {
    console.warn("[ai-cost-ledger] Coverage epoch reset failed.");
    return NextResponse.json(
      { error: "Coverage epoch could not be reset" },
      { status: 502, headers: NO_STORE_HEADERS },
    );
  }
};
