import { createHash } from "node:crypto";
import { anyApi } from "convex/server";
import { fetchMutation } from "convex/nextjs";
import { NextRequest, NextResponse } from "next/server";

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
};

export const enforceRouteQuota = async ({
  req,
  scope,
  limit,
  windowMs,
  label,
}: RouteQuotaOptions): Promise<NextResponse | null> => {
  const quota = await fetchMutation(anyApi.rateLimits.consumeRouteQuota, {
    key: buildRouteQuotaKey({
      scope,
      ipAddress: getRequestIpAddress(req.headers),
    }),
    limit,
    windowMs,
  });

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
