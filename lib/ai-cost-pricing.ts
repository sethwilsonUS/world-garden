import type { AiCostProviderAttempt } from "./ai-cost-ledger-contract";

export const AI_COST_PRICING_VERSION = "openai-2026-07-28-v1";
export const AI_COST_PRICING_EFFECTIVE_FROM = "2026-07-28";

const LUNA_SHORT_CONTEXT_MAX_INPUT_TOKENS = 272_000;
const SUPPORTED_LUNA_MODELS = new Set([
  "gpt-5.6-luna",
  "gpt-5.6-luna-2026-07-01",
]);

export type AiCostEstimateReason =
  | "not_dispatched"
  | "unsupported_provider"
  | "unsupported_model"
  | "unsupported_service_tier"
  | "long_context"
  | "missing_usage"
  | "speech_usage_unavailable"
  | null;

export type AiCostEstimate = {
  amountMicros: number | null;
  currency: "USD";
  quality:
    | "derived_from_provider_usage"
    | "locally_measured_estimate"
    | "unknown";
  pricingVersion: string | null;
  effectiveFrom: string | null;
  reason: AiCostEstimateReason;
};

const unknownEstimate = (
  reason: Exclude<AiCostEstimateReason, "not_dispatched" | null>,
): AiCostEstimate => ({
  amountMicros: null,
  currency: "USD",
  quality: "unknown",
  pricingVersion: null,
  effectiveFrom: null,
  reason,
});

const roundPositiveRatio = (numerator: bigint, denominator: bigint): bigint =>
  (numerator + denominator / BigInt(2)) / denominator;

const isSupportedLunaModel = (model: string | null): boolean =>
  model !== null && SUPPORTED_LUNA_MODELS.has(model);

export const estimateDirectAiCost = (
  attempt: AiCostProviderAttempt,
): AiCostEstimate => {
  if (
    attempt.state === "failed_before_dispatch" ||
    attempt.dispatchedAt === null
  ) {
    return {
      amountMicros: 0,
      currency: "USD",
      quality: "locally_measured_estimate",
      pricingVersion: null,
      effectiveFrom: null,
      reason: "not_dispatched",
    };
  }
  if (attempt.effectiveProvider !== "openai") {
    return unknownEstimate("unsupported_provider");
  }
  if (attempt.operation === "tts") {
    return unknownEstimate("speech_usage_unavailable");
  }
  if (!isSupportedLunaModel(attempt.model)) {
    return unknownEstimate("unsupported_model");
  }
  if (
    attempt.serviceTier !== null &&
    attempt.serviceTier !== "default" &&
    attempt.serviceTier !== "auto"
  ) {
    return unknownEstimate("unsupported_service_tier");
  }

  const {
    inputTokens,
    cachedInputTokens,
    cacheWriteInputTokens,
    outputTokens,
    webSearchCalls,
  } = attempt;
  const effectiveWebSearchCalls =
    attempt.operation === "trending_brief_research" ? webSearchCalls : 0;
  if (
    inputTokens === null ||
    cachedInputTokens === null ||
    cacheWriteInputTokens === null ||
    outputTokens === null ||
    effectiveWebSearchCalls === null ||
    cachedInputTokens + cacheWriteInputTokens > inputTokens
  ) {
    return unknownEstimate("missing_usage");
  }
  if (inputTokens > LUNA_SHORT_CONTEXT_MAX_INPUT_TOKENS) {
    return unknownEstimate("long_context");
  }

  const uncachedInputTokens =
    inputTokens - cachedInputTokens - cacheWriteInputTokens;

  // The common denominator of 20 keeps all documented rates exact in integer
  // arithmetic before one final half-up rounding to currency micros.
  const numeratorInTwentiethMicros =
    BigInt(uncachedInputTokens) * BigInt(20) +
    BigInt(cachedInputTokens) * BigInt(2) +
    BigInt(cacheWriteInputTokens) * BigInt(25) +
    BigInt(outputTokens) * BigInt(120) +
    BigInt(effectiveWebSearchCalls) * BigInt(200_000);
  const amount = roundPositiveRatio(numeratorInTwentiethMicros, BigInt(20));
  if (amount > BigInt(Number.MAX_SAFE_INTEGER)) {
    return unknownEstimate("missing_usage");
  }

  return {
    amountMicros: Number(amount),
    currency: "USD",
    quality: "derived_from_provider_usage",
    pricingVersion: AI_COST_PRICING_VERSION,
    effectiveFrom: AI_COST_PRICING_EFFECTIVE_FROM,
    reason: null,
  };
};
