import { anyApi } from "convex/server";
import { fetchMutation } from "convex/nextjs";
import { NextRequest, NextResponse } from "next/server";
import {
  buildProductFeedbackRateLimitKey,
  getProductFeedbackWriteSecret,
  normalizeProductFeedbackInput,
} from "@/lib/product-feedback";
import { createAttestedRouteQuotaArgs } from "@/lib/route-quota-attestation";
import { getRequestIpAddress } from "@/lib/route-rate-limit";

const NO_CACHE_HEADERS = { "Cache-Control": "no-store" } as const;
const MAX_REQUEST_BYTES = 8_192;
const RATE_LIMIT = 5;
const RATE_LIMIT_WINDOW_MS = 60 * 60 * 1_000;
const UNAVAILABLE_ERROR =
  "Feedback is temporarily unavailable. Try again later.";

export const dynamic = "force-dynamic";
export const revalidate = 0;
export const maxDuration = 15;

const unavailable = () =>
  NextResponse.json(
    { error: UNAVAILABLE_ERROR },
    { status: 503, headers: NO_CACHE_HEADERS },
  );

const readRequestTextWithLimit = async (request: Request): Promise<string> => {
  const declaredLength = request.headers.get("content-length")?.trim();
  if (
    declaredLength &&
    /^\d+$/u.test(declaredLength) &&
    Number(declaredLength) > MAX_REQUEST_BYTES
  ) {
    throw new Error("Feedback request is too large");
  }

  if (!request.body) throw new Error("Feedback body is required");

  const reader = request.body.getReader();
  const chunks: Uint8Array[] = [];
  let byteLength = 0;

  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;

      byteLength += value.byteLength;
      if (byteLength > MAX_REQUEST_BYTES) {
        await reader.cancel().catch(() => undefined);
        throw new Error("Feedback request is too large");
      }
      chunks.push(value);
    }
  } finally {
    reader.releaseLock();
  }

  if (byteLength === 0) throw new Error("Feedback body is required");

  const bytes = new Uint8Array(byteLength);
  let offset = 0;
  for (const chunk of chunks) {
    bytes.set(chunk, offset);
    offset += chunk.byteLength;
  }

  try {
    return new TextDecoder("utf-8", { fatal: true }).decode(bytes);
  } catch {
    throw new Error("Feedback body must be valid UTF-8");
  }
};

const parseFeedbackRequest = async (request: Request) => {
  const contentType = request.headers.get("content-type") ?? "";
  if (!/^application\/json(?:\s*;|$)/i.test(contentType)) {
    throw new Error("Feedback must be sent as JSON");
  }

  const text = await readRequestTextWithLimit(request);

  let body: unknown;
  try {
    body = JSON.parse(text);
  } catch {
    throw new Error("Feedback body must be valid JSON");
  }
  return normalizeProductFeedbackInput(body);
};

const consumeFeedbackQuota = async (
  request: NextRequest,
  writeSecret: string,
) => {
  const key = await buildProductFeedbackRateLimitKey(
    getRequestIpAddress(request.headers),
    writeSecret,
  );
  const quotaArgs = await createAttestedRouteQuotaArgs(
    {
      key,
      limit: RATE_LIMIT,
      windowMs: RATE_LIMIT_WINDOW_MS,
    },
    { secret: writeSecret },
  );
  return (await fetchMutation(
    anyApi.rateLimits.consumeRouteQuota,
    quotaArgs,
  )) as { allowed: boolean; resetAt: number };
};

export const POST = async (request: NextRequest) => {
  const writeSecret = getProductFeedbackWriteSecret();
  const convexConfigured =
    process.env.NEXT_PUBLIC_LOCAL_MODE !== "true" &&
    Boolean(process.env.NEXT_PUBLIC_CONVEX_URL?.trim());
  if (!convexConfigured || !writeSecret) return unavailable();

  let feedback: ReturnType<typeof normalizeProductFeedbackInput>;
  try {
    feedback = await parseFeedbackRequest(request);
  } catch (error) {
    return NextResponse.json(
      {
        error:
          error instanceof Error
            ? error.message
            : "Please check your feedback and try again.",
      },
      { status: 400, headers: NO_CACHE_HEADERS },
    );
  }

  let quota: Awaited<ReturnType<typeof consumeFeedbackQuota>>;
  try {
    quota = await consumeFeedbackQuota(request, writeSecret);
  } catch {
    console.error("[/api/feedback] Feedback quota check failed");
    return unavailable();
  }

  if (!quota.allowed) {
    const retryAfterSeconds = Math.max(
      1,
      Math.ceil((quota.resetAt - Date.now()) / 1_000),
    );
    return NextResponse.json(
      { error: "Feedback is being sent too often. Try again later." },
      {
        status: 429,
        headers: {
          ...NO_CACHE_HEADERS,
          "Retry-After": String(retryAfterSeconds),
        },
      },
    );
  }

  try {
    await fetchMutation(anyApi.productFeedback.submitProductFeedback, {
      adminSecret: writeSecret,
      ...feedback,
    });
    return NextResponse.json(
      { accepted: true },
      { status: 202, headers: NO_CACHE_HEADERS },
    );
  } catch (error) {
    console.error(
      "[/api/feedback] Feedback persistence failed",
      error instanceof Error ? error.name : typeof error,
    );
    return unavailable();
  }
};
