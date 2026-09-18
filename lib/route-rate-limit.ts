import { createHash } from "node:crypto";
import { anyApi } from "convex/server";
import { fetchMutation } from "convex/nextjs";
import { NextRequest, NextResponse } from "next/server";
import { createAttestedRouteQuotaArgs } from "./route-quota-attestation";
import { fetchConvexMutationWithTimeout } from "./convex-request-timeout";

const NO_CACHE_HEADERS = { "Cache-Control": "no-store" } as const;

const RATE_LIMIT_IP_HEADERS = [
  "x-forwarded-for",
  "x-real-ip",
  "cf-connecting-ip",
  "x-vercel-forwarded-for",
] as const;

export const getRequestIpAddress = (headers: Headers): string | null => {
  for (const headerName of RATE_LIMIT_IP_HEADERS) {
    const value = headers.get(headerName);
    if (!value) continue;
    const candidate = value.split(",")[0]?.trim();
    if (candidate) return candidate;
  }

  return null;
};

export const buildRouteQuotaKey = ({
  scope,
  ipAddress,
}: {
  scope: string;
  ipAddress: string | null;
}): string => {
  const hash = createHash("sha256")
    .update(ipAddress || "unknown")
    .digest("hex")
    .slice(0, 32);

  return `route-quota:${scope}:${hash}`;
};

type RouteQuotaOptions = {
  req: NextRequest;
  scope: string;
  limit: number;
  windowMs: number;
  label: string;
  signal?: AbortSignal;
};

export const enforceRouteQuota = async ({
  req,
  scope,
  limit,
  windowMs,
  label,
  signal,
}: RouteQuotaOptions): Promise<NextResponse | null> => {
  let quota;
  try {
    const quotaArgs = await createAttestedRouteQuotaArgs({
      key: buildRouteQuotaKey({
        scope,
        ipAddress: getRequestIpAddress(req.headers),
      }),
      limit,
      windowMs,
    });
    quota = await (signal
      ? fetchConvexMutationWithTimeout(
          anyApi.rateLimits.consumeRouteQuota,
          quotaArgs,
          {
            signal,
            timeoutMs: 0,
            message: "Route quota check timed out",
          },
        )
      : fetchMutation(anyApi.rateLimits.consumeRouteQuota, quotaArgs));
  } catch (error) {
    console.error(`[route-quota] ${scope} quota check failed`, error);
    return NextResponse.json(
      { error: `${label} is temporarily unavailable. Try again later.` },
      {
        status: 503,
        headers: { ...NO_CACHE_HEADERS, "Retry-After": "60" },
      },
    );
  }

  if (quota.allowed) {
    return null;
  }

  const retryAfterSeconds = Math.max(
    1,
    Math.ceil((quota.resetAt - Date.now()) / 1000),
  );

  return NextResponse.json(
    {
      error: `${label} is being requested too often. Try again later.`,
    },
    {
      status: 429,
      headers: {
        ...NO_CACHE_HEADERS,
        "Retry-After": String(retryAfterSeconds),
      },
    },
  );
};
