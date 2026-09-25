import { describe, expect, it } from "vitest";
import type { AiCostProviderAttempt } from "./ai-cost-ledger-contract";
import {
  AI_COST_PRICING_EFFECTIVE_FROM,
  AI_COST_PRICING_VERSION,
  estimateDirectAiCost,
} from "./ai-cost-pricing";

const attempt = (
  overrides: Partial<AiCostProviderAttempt> = {},
): AiCostProviderAttempt => ({
  eventKey: "pricing.event-0001",
  correlationId: "pricing.correlation-0001",
  lifecycleVersion: 1,
  operation: "trending_brief_research",
  source: "trending_brief",
  requestedProvider: "openai",
  effectiveProvider: "openai",
  model: "gpt-6-luna",
  serviceTier: "auto",
  profile: null,
  state: "succeeded",
  failureCategory: null,
  dispatchedAt: 1_800_000_000_000,
  completedAt: 1_800_000_000_100,
  inputCharacters: 800,
  inputWords: 120,
  inputTokens: 200,
  cachedInputTokens: 20,
  cacheWriteInputTokens: 4,
  outputTokens: 10,
  reasoningOutputTokens: 3,
  audioInputTokens: null,
  audioOutputTokens: null,
  webSearchCalls: 2,
  responseAudioBytes: null,
  audioDurationMs: null,
  durationMeasurement: "unknown",
  isFallbackAttempt: false,
  ...overrides,
});

describe("AI cost pricing", () => {
  it("uses the current published Standard pricing revision", () => {
    expect(AI_COST_PRICING_VERSION).toBe("openai-2026-09-24-v3");
    expect(AI_COST_PRICING_EFFECTIVE_FROM).toBe("2026-09-24");
  });

  it("prices each GPT-6 Luna token class once and rounds to integer micros", () => {
    expect(estimateDirectAiCost(attempt())).toEqual({
      amountMicros: 20_023,
      currency: "USD",
      quality: "derived_from_provider_usage",
      pricingVersion: AI_COST_PRICING_VERSION,
      effectiveFrom: AI_COST_PRICING_EFFECTIVE_FROM,
      reason: null,
    });
    expect(
      estimateDirectAiCost(
        attempt({
          inputTokens: 5,
          cachedInputTokens: 5,
          cacheWriteInputTokens: 0,
          outputTokens: 0,
          webSearchCalls: 0,
        }),
      ).amountMicros,
    ).toBe(0);
  });

  it("retains separate GPT-5.6 Luna rates for historical research and writing", () => {
    expect(
      estimateDirectAiCost(attempt({ model: "gpt-5.6-luna" })).amountMicros,
    ).toBe(20_049);
    expect(
      estimateDirectAiCost(
        attempt({
          model: "gpt-5.6-luna",
          operation: "trending_brief_writing",
          webSearchCalls: null,
        }),
      ).amountMicros,
    ).toBe(49);
  });

  it("preserves fractional GPT-6 Luna cache-write rates until final rounding", () => {
    expect(
      estimateDirectAiCost(
        attempt({
          model: "gpt-6-luna",
          inputTokens: 4,
          cachedInputTokens: 0,
          cacheWriteInputTokens: 4,
          outputTokens: 0,
          webSearchCalls: 0,
        }),
      ).amountMicros,
    ).toBe(1);
  });

  it.each([
    ["gpt-6-luna", 10_000, 1_000, 12_500, 50_000],
    ["gpt-5.6-luna", 20_000, 2_000, 25_000, 120_000],
  ] as const)(
    "prices every token class independently for %s",
    (model, uncachedInput, cachedInput, cacheWriteInput, output) => {
      const pricedWritingAttempt = (
        overrides: Partial<AiCostProviderAttempt>,
      ) =>
        estimateDirectAiCost(
          attempt({
            model,
            operation: "trending_brief_writing",
            inputTokens: 0,
            cachedInputTokens: 0,
            cacheWriteInputTokens: 0,
            outputTokens: 0,
            webSearchCalls: null,
            ...overrides,
          }),
        ).amountMicros;

      expect(pricedWritingAttempt({ inputTokens: 100_000 })).toBe(
        uncachedInput,
      );
      expect(
        pricedWritingAttempt({
          inputTokens: 100_000,
          cachedInputTokens: 100_000,
        }),
      ).toBe(cachedInput);
      expect(
        pricedWritingAttempt({
          inputTokens: 100_000,
          cacheWriteInputTokens: 100_000,
        }),
      ).toBe(cacheWriteInput);
      expect(pricedWritingAttempt({ outputTokens: 100_000 })).toBe(output);
    },
  );

  it("prices web search at one cent per call", () => {
    expect(
      estimateDirectAiCost(
        attempt({
          inputTokens: 0,
          cachedInputTokens: 0,
          cacheWriteInputTokens: 0,
          outputTokens: 0,
          webSearchCalls: 1,
        }),
      ).amountMicros,
    ).toBe(10_000);
  });

  it.each(["gpt-5.6-luna", "gpt-6-luna"])(
    "does not estimate unsupported tiers or long context for %s",
    (model) => {
      expect(
        estimateDirectAiCost(attempt({ model, serviceTier: "priority" })),
      ).toMatchObject({ amountMicros: null, reason: "unsupported_service_tier" });
      expect(
        estimateDirectAiCost(attempt({ model, inputTokens: 272_001 })),
      ).toMatchObject({ amountMicros: null, reason: "long_context" });
      expect(
        estimateDirectAiCost(attempt({ model, inputTokens: 272_000 })),
      ).toMatchObject({ reason: null });
    },
  );

  it("requires search-call usage only for the research operation", () => {
    expect(
      estimateDirectAiCost(
        attempt({
          operation: "article_context_generation",
          source: "article_context",
          webSearchCalls: null,
        }),
      ).amountMicros,
    ).toBe(23);
    expect(
      estimateDirectAiCost(
        attempt({
          operation: "trending_brief_writing",
          webSearchCalls: null,
        }),
      ).amountMicros,
    ).toBe(23);
    expect(
      estimateDirectAiCost(attempt({ webSearchCalls: null })),
    ).toMatchObject({ amountMicros: null, reason: "missing_usage" });
  });

  it("recognizes the historical Luna snapshot and rejects unknown model names", () => {
    expect(
      estimateDirectAiCost(attempt({ model: "gpt-5.6-luna-2026-07-01" }))
        .amountMicros,
    ).toBe(20_049);
    expect(
      estimateDirectAiCost(
        attempt({ model: "gpt-5.6-luna-2026-07-01-lookalike" }),
      ),
    ).toMatchObject({ amountMicros: null, reason: "unsupported_model" });
    expect(
      estimateDirectAiCost(attempt({ model: "gpt-5.6-luna-2099-01-01" })),
    ).toMatchObject({ amountMicros: null, reason: "unsupported_model" });
    expect(
      estimateDirectAiCost(attempt({ model: "unknown-model" })),
    ).toMatchObject({ amountMicros: null, reason: "unsupported_model" });
    expect(
      estimateDirectAiCost(attempt({ model: "gpt-6-luna-2026-09-24" })),
    ).toMatchObject({ amountMicros: null, reason: "unsupported_model" });
  });

  it("does not invent speech usage or Edge cost", () => {
    expect(
      estimateDirectAiCost(
        attempt({
          operation: "tts",
          model: "gpt-4o-mini-tts",
          inputTokens: null,
          cachedInputTokens: null,
          cacheWriteInputTokens: null,
          outputTokens: null,
          webSearchCalls: null,
          responseAudioBytes: 123_456,
        }),
      ),
    ).toMatchObject({
      amountMicros: null,
      quality: "unknown",
      reason: "speech_usage_unavailable",
    });
    expect(
      estimateDirectAiCost(
        attempt({ effectiveProvider: "edge", model: "edge-tts" }),
      ),
    ).toMatchObject({ amountMicros: null, reason: "unsupported_provider" });
  });

  it("records a pre-dispatch failure as known non-billable", () => {
    expect(
      estimateDirectAiCost(
        attempt({
          state: "failed_before_dispatch",
          failureCategory: "validation",
          dispatchedAt: null,
          completedAt: 1_800_000_000_000,
        }),
      ),
    ).toMatchObject({
      amountMicros: 0,
      quality: "locally_measured_estimate",
      reason: "not_dispatched",
    });
  });
});
