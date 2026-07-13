import { createHash } from "node:crypto";
import { anyApi } from "convex/server";
import { fetchAction } from "convex/nextjs";
import { NextRequest, NextResponse } from "next/server";
import { getArticleContextWriteSecret } from "@/lib/article-context-persistence";
import { consumeArticleContextRouteQuota } from "@/lib/article-context-route";
import { getRequestIpAddress } from "@/lib/route-rate-limit";

const NO_CACHE_HEADERS = { "Cache-Control": "no-store" } as const;
const MAX_REPORT_BODY_CHARS = 4_096;

export const dynamic = "force-dynamic";
export const revalidate = 0;
export const maxDuration = 30;

type PublicReportReason =
  | "incorrect"
  | "inaccessible"
  | "confusing"
  | "other";

const REASON_MAP = {
  incorrect: "inaccurate",
  inaccessible: "accessibility",
  confusing: "misleading",
  other: "other",
} as const;

const isRecord = (value: unknown): value is Record<string, unknown> =>
  Boolean(value) && typeof value === "object" && !Array.isArray(value);

const parseReport = async (request: Request) => {
  const text = await request.text();
  if (!text || text.length > MAX_REPORT_BODY_CHARS) {
    throw new Error(text ? "Report is too large" : "Report body is required");
  }

  let body: unknown;
  try {
    body = JSON.parse(text);
  } catch {
    throw new Error("Report body must be valid JSON");
  }
  if (!isRecord(body)) throw new Error("Report body must be a JSON object");

  const wikiPageId = String(body.wikiPageId ?? "").trim();
  const revisionId = String(body.revisionId ?? "").trim();
  const blockId = String(body.blockId ?? "").trim();
  const sourceHash = String(body.sourceHash ?? "").trim();
  const reason = String(body.reason ?? "");
  const details = String(body.details ?? "").trim();

  if (!/^\d{1,20}$/.test(wikiPageId) || !/^\d{1,20}$/.test(revisionId)) {
    throw new Error("Article and revision IDs must be numeric");
  }
  if (!blockId || blockId.length > 256 || /\p{Cc}/u.test(blockId)) {
    throw new Error("blockId is invalid");
  }
  if (!/^[A-Za-z0-9._~:+/=-]{1,256}$/.test(sourceHash)) {
    throw new Error("sourceHash is invalid");
  }
  if (!Object.prototype.hasOwnProperty.call(REASON_MAP, reason)) {
    throw new Error("Report reason is invalid");
  }
  if (details.length > 2_000) throw new Error("Report details are too long");
  if (reason === "other" && !details) {
    throw new Error("Please add details for an other report");
  }

  return {
    wikiPageId,
    revisionId,
    blockId,
    sourceHash,
    reason: REASON_MAP[reason as PublicReportReason],
    ...(details ? { details } : {}),
  };
};

const reporterKey = (request: NextRequest, secret: string): string =>
  `context-reporter:${createHash("sha256")
    .update(getRequestIpAddress(request.headers) || "unknown")
    .update("\0")
    .update(request.headers.get("user-agent") || "unknown")
    .update("\0")
    .update(secret)
    .digest("hex")
    .slice(0, 40)}`;

export const POST = async (request: NextRequest) => {
  const quota = consumeArticleContextRouteQuota(request.headers);
  if (!quota.allowed) {
    return NextResponse.json(
      { error: "Context reports are being sent too often. Try again later." },
      {
        status: 429,
        headers: {
          ...NO_CACHE_HEADERS,
          "Retry-After": String(quota.retryAfterSeconds),
        },
      },
    );
  }

  let report: Awaited<ReturnType<typeof parseReport>>;
  try {
    report = await parseReport(request);
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Report is invalid" },
      { status: 400, headers: NO_CACHE_HEADERS },
    );
  }

  const localMode = process.env.NEXT_PUBLIC_LOCAL_MODE === "true";
  const convexConfigured = Boolean(process.env.NEXT_PUBLIC_CONVEX_URL?.trim());
  const adminSecret = getArticleContextWriteSecret();
  if (localMode || !convexConfigured) {
    return NextResponse.json(
      { accepted: true, persisted: false },
      { status: 202, headers: NO_CACHE_HEADERS },
    );
  }
  if (!adminSecret) {
    return NextResponse.json(
      { error: "Context reporting is temporarily unavailable" },
      { status: 503, headers: NO_CACHE_HEADERS },
    );
  }

  try {
    await fetchAction(anyApi.articleContexts.submitArticleContextReport, {
      adminSecret,
      ...report,
      reporterKey: reporterKey(request, adminSecret),
    });
    return NextResponse.json(
      { accepted: true, persisted: true },
      { status: 202, headers: NO_CACHE_HEADERS },
    );
  } catch (error) {
    console.error(
      "[/api/article-context/report] Report persistence failed",
      error instanceof Error ? error.message : "Unknown error",
    );
    return NextResponse.json(
      { error: "Context reporting is temporarily unavailable" },
      { status: 503, headers: NO_CACHE_HEADERS },
    );
  }
};
