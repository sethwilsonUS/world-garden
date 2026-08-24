import type { AiCostProviderAttempt } from "./ai-cost-ledger-contract";

export const AI_COST_PRICING_VERSION = "openai-2026-08-24-v2";
export const AI_COST_PRICING_EFFECTIVE_FROM = "2026-08-24";

const GPT_5_6_SHORT_CONTEXT_MAX_INPUT_TOKENS = 272_000;

export type Gpt56ModelFamily = "luna" | "terra" | "sol";

const GPT_5_6_MODEL_FAMILIES = new Map<string, Gpt56ModelFamily>([
  ["gpt-5.6-luna", "luna"],
  ["gpt-5.6-luna-2026-07-01", "luna"],
  ["gpt-5.6-terra", "terra"],
  ["gpt-5.6-sol", "sol"],
  ["gpt-5.6", "sol"],
]);

type StandardPricingInHundredthMicros = {
  uncachedInput: bigint;
  cachedInput: bigint;
  cacheWriteInput: bigint;
  output: bigint;
};

const STANDARD_PRICING_IN_HUNDREDTH_MICROS: Record<
  Gpt56ModelFamily,
  StandardPricingInHundredthMicros
> = {
  luna: {
    uncachedInput: BigInt(20),
    cachedInput: BigInt(2),
    cacheWriteInput: BigInt(25),
    output: BigInt(120),
  },
  terra: {
    uncachedInput: BigInt(200),
    cachedInput: BigInt(20),
    cacheWriteInput: BigInt(250),
    output: BigInt(1_200),
  },
  sol: {
    uncachedInput: BigInt(400),
    cachedInput: BigInt(40),
    cacheWriteInput: BigInt(500),
    output: BigInt(2_000),
  },
};

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

export const getGpt56ModelFamily = (
  model: string | null,
): Gpt56ModelFamily | null =>
  model === null ? null : (GPT_5_6_MODEL_FAMILIES.get(model) ?? null);

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
  const modelFamily = getGpt56ModelFamily(attempt.model);
  const pricing = modelFamily
    ? STANDARD_PRICING_IN_HUNDREDTH_MICROS[modelFamily]
    : null;
  if (!pricing) {
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
  if (inputTokens > GPT_5_6_SHORT_CONTEXT_MAX_INPUT_TOKENS) {
    return unknownEstimate("long_context");
  }

  const uncachedInputTokens =
    inputTokens - cachedInputTokens - cacheWriteInputTokens;

  // The common denominator of 100 keeps all documented rates exact in integer
  // arithmetic before one final half-up rounding to currency micros.
  const numeratorInHundredthMicros =
    BigInt(uncachedInputTokens) * pricing.uncachedInput +
    BigInt(cachedInputTokens) * pricing.cachedInput +
    BigInt(cacheWriteInputTokens) * pricing.cacheWriteInput +
    BigInt(outputTokens) * pricing.output +
    BigInt(effectiveWebSearchCalls) * BigInt(1_000_000);
  const amount = roundPositiveRatio(numeratorInHundredthMicros, BigInt(100));
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
