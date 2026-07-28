import { fetchAction } from "convex/nextjs";
import { anyApi } from "convex/server";
import { NextRequest, NextResponse } from "next/server";
import { parseAiCostStatementInput } from "@/lib/ai-cost-ledger-contract";
import { createAiCostStatementAttestation } from "@/lib/ai-cost-owner-attestation";
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

  let statement;
  try {
    statement = parseAiCostStatementInput(await request.json());
  } catch (error) {
    return NextResponse.json(
      {
        error:
          error instanceof Error
            ? error.message
            : "Statement payload is invalid.",
      },
      { status: 400, headers: NO_STORE_HEADERS },
    );
  }

  try {
    const attestation = await createAiCostStatementAttestation(statement);
    const result = await fetchAction(anyApi.aiCostLedger.upsertCostStatement, {
      statement,
      attestation,
    });
    return NextResponse.json(result, { headers: NO_STORE_HEADERS });
  } catch {
    console.warn("[ai-cost-ledger] Cost statement upsert failed.");
    return NextResponse.json(
      { error: "Cost statement could not be stored" },
      { status: 502, headers: NO_STORE_HEADERS },
    );
  }
};
