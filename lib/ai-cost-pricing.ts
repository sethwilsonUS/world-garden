import type { AiCostProviderAttempt } from "./ai-cost-ledger-contract";

export const AI_COST_PRICING_VERSION = "openai-2026-09-24-v3";
export const AI_COST_PRICING_EFFECTIVE_FROM = "2026-09-24";

const SHORT_CONTEXT_MAX_INPUT_TOKENS = 272_000;

export type Gpt56ModelFamily = "luna" | "terra" | "sol";

const GPT_5_6_MODEL_FAMILIES = new Map<string, Gpt56ModelFamily>([
  ["gpt-5.6-luna", "luna"],
  ["gpt-5.6-luna-2026-07-01", "luna"],
  ["gpt-5.6-terra", "terra"],
  ["gpt-5.6-sol", "sol"],
  ["gpt-5.6", "sol"],
]);

type StandardPricingInThousandthMicros = {
  uncachedInput: bigint;
  cachedInput: bigint;
  cacheWriteInput: bigint;
  output: bigint;
};

const GPT_5_6_STANDARD_PRICING_IN_THOUSANDTH_MICROS: Record<
  Gpt56ModelFamily,
  StandardPricingInThousandthMicros
> = {
  luna: {
    uncachedInput: BigInt(200),
    cachedInput: BigInt(20),
    cacheWriteInput: BigInt(250),
    output: BigInt(1_200),
  },
  terra: {
    uncachedInput: BigInt(2_000),
    cachedInput: BigInt(200),
    cacheWriteInput: BigInt(2_500),
    output: BigInt(12_000),
  },
  sol: {
    uncachedInput: BigInt(4_000),
    cachedInput: BigInt(400),
    cacheWriteInput: BigInt(5_000),
    output: BigInt(20_000),
  },
};

const GPT_6_LUNA_STANDARD_PRICING_IN_THOUSANDTH_MICROS: StandardPricingInThousandthMicros =
  {
    uncachedInput: BigInt(100),
    cachedInput: BigInt(10),
    cacheWriteInput: BigInt(125),
    output: BigInt(500),
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
  const pricing =
    attempt.model === "gpt-6-luna"
      ? GPT_6_LUNA_STANDARD_PRICING_IN_THOUSANDTH_MICROS
      : modelFamily
        ? GPT_5_6_STANDARD_PRICING_IN_THOUSANDTH_MICROS[modelFamily]
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
  if (inputTokens > SHORT_CONTEXT_MAX_INPUT_TOKENS) {
    return unknownEstimate("long_context");
  }

  const uncachedInputTokens =
    inputTokens - cachedInputTokens - cacheWriteInputTokens;

  // The common denominator of 1,000 keeps all documented rates exact in integer
  // arithmetic before one final half-up rounding to currency micros.
  const numeratorInThousandthMicros =
    BigInt(uncachedInputTokens) * pricing.uncachedInput +
    BigInt(cachedInputTokens) * pricing.cachedInput +
    BigInt(cacheWriteInputTokens) * pricing.cacheWriteInput +
    BigInt(outputTokens) * pricing.output +
    BigInt(effectiveWebSearchCalls) * BigInt(10_000_000);
  const amount = roundPositiveRatio(numeratorInThousandthMicros, BigInt(1_000));
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
