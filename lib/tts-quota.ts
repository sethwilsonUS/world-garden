import { anyApi } from "convex/server";
import { fetchMutation } from "convex/nextjs";
import {
  buildRouteQuotaKey,
  getRequestIpAddress,
} from "./route-rate-limit";
import { TTS_QUOTA_BYPASS_HEADER } from "./tts-quota-headers";
import type { TtsFallbackReason, TtsProvider } from "./tts-profile";

export { TTS_QUOTA_BYPASS_HEADER };

export type TtsQuotaMode = "public" | "bypass" | "edge_requested";
export type TtsQuotaWindow = "burst" | "daily";

type RouteQuotaResult = {
  allowed: boolean;
  remaining: number;
  resetAt: number;
};

export type ConsumeTtsQuota = (args: {
  scope: string;
  ipAddress: string | null;
  limit: number;
  windowMs: number;
}) => Promise<RouteQuotaResult>;

export type TtsQuotaDecision = {
  mode: TtsQuotaMode;
  exceeded: boolean;
  exceededWindow?: TtsQuotaWindow;
  fallbackReason?: TtsFallbackReason;
  quotaError?: string;
};

const DEFAULT_BURST_LIMIT = 120;
const DEFAULT_BURST_WINDOW_MS = 10 * 60 * 1000;
const DEFAULT_DAILY_LIMIT = 800;
const DEFAULT_DAILY_WINDOW_MS = 24 * 60 * 60 * 1000;

const readPositiveInteger = (
  name: string,
  fallback: number,
): number => {
  const parsed = Number.parseInt(process.env[name] ?? "", 10);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
};

export const getOpenAiTtsQuotaConfig = () => ({
  burstLimit: readPositiveInteger(
    "TTS_PUBLIC_OPENAI_BURST_LIMIT",
    DEFAULT_BURST_LIMIT,
  ),
  burstWindowMs: readPositiveInteger(
    "TTS_PUBLIC_OPENAI_BURST_WINDOW_MS",
    DEFAULT_BURST_WINDOW_MS,
  ),
  dailyLimit: readPositiveInteger(
    "TTS_PUBLIC_OPENAI_DAILY_LIMIT",
    DEFAULT_DAILY_LIMIT,
  ),
  dailyWindowMs: readPositiveInteger(
    "TTS_PUBLIC_OPENAI_DAILY_WINDOW_MS",
    DEFAULT_DAILY_WINDOW_MS,
  ),
});

const getErrorMessage = (error: unknown): string =>
  error instanceof Error ? error.message : "TTS quota check failed";

export const isTtsQuotaBypassRequest = (headers: Headers): boolean => {
  const secret = process.env.TTS_QUOTA_BYPASS_SECRET?.trim();
  if (!secret) return false;
  return headers.get(TTS_QUOTA_BYPASS_HEADER) === secret;
};

const consumeQuotaViaConvex: ConsumeTtsQuota = async ({
  scope,
  ipAddress,
  limit,
  windowMs,
}) =>
  await fetchMutation(anyApi.rateLimits.consumeRouteQuota, {
    key: buildRouteQuotaKey({ scope, ipAddress }),
    limit,
    windowMs,
  });

export const resolveOpenAiTtsQuota = async ({
  headers,
  provider,
  consumeQuota = consumeQuotaViaConvex,
}: {
  headers: Headers;
  provider: TtsProvider;
  consumeQuota?: ConsumeTtsQuota;
}): Promise<TtsQuotaDecision> => {
  if (provider === "edge") {
    return { mode: "edge_requested", exceeded: false };
  }

  if (isTtsQuotaBypassRequest(headers)) {
    return { mode: "bypass", exceeded: false };
  }

  const ipAddress = getRequestIpAddress(headers);
  const config = getOpenAiTtsQuotaConfig();

  try {
    const burst = await consumeQuota({
      scope: "tts-openai-public-burst",
      ipAddress,
      limit: config.burstLimit,
      windowMs: config.burstWindowMs,
    });

    if (!burst.allowed) {
      return {
        mode: "public",
        exceeded: true,
        exceededWindow: "burst",
        fallbackReason: "openai_quota",
      };
    }

    const daily = await consumeQuota({
      scope: "tts-openai-public-daily",
      ipAddress,
      limit: config.dailyLimit,
      windowMs: config.dailyWindowMs,
    });

    if (!daily.allowed) {
      return {
        mode: "public",
        exceeded: true,
        exceededWindow: "daily",
        fallbackReason: "openai_quota",
      };
    }

    return { mode: "public", exceeded: false };
  } catch (error) {
    // Fail open by design: quota storage issues should not block public audio.
    // The route logs quotaError and continues through the primary provider.
    return {
      mode: "public",
      exceeded: false,
      quotaError: getErrorMessage(error),
    };
  }
};
