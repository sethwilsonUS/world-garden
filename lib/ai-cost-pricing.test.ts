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
  model: "gpt-5.6-luna",
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
  it("prices each Luna token class once and rounds to integer micros", () => {
    expect(estimateDirectAiCost(attempt())).toEqual({
      amountMicros: 20_243,
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
    ).toBe(1);
  });

  it("does not estimate unsupported tiers or long context", () => {
    expect(
      estimateDirectAiCost(attempt({ serviceTier: "priority" })),
    ).toMatchObject({ amountMicros: null, reason: "unsupported_service_tier" });
    expect(
      estimateDirectAiCost(attempt({ inputTokens: 272_001 })),
    ).toMatchObject({ amountMicros: null, reason: "long_context" });
  });

  it("requires search-call usage only for the research operation", () => {
    expect(
      estimateDirectAiCost(
        attempt({
          operation: "article_context_generation",
          source: "article_context",
          webSearchCalls: null,
        }),
      ).amountMicros,
    ).toBe(243);
    expect(
      estimateDirectAiCost(
        attempt({
          operation: "trending_brief_writing",
          webSearchCalls: null,
        }),
      ).amountMicros,
    ).toBe(243);
    expect(
      estimateDirectAiCost(attempt({ webSearchCalls: null })),
    ).toMatchObject({ amountMicros: null, reason: "missing_usage" });
  });

  it("recognizes only an exact dated Luna snapshot pattern", () => {
    expect(
      estimateDirectAiCost(attempt({ model: "gpt-5.6-luna-2026-07-01" }))
        .amountMicros,
    ).toBe(20_243);
    expect(
      estimateDirectAiCost(
        attempt({ model: "gpt-5.6-luna-2026-07-01-lookalike" }),
      ),
    ).toMatchObject({ amountMicros: null, reason: "unsupported_model" });
    expect(
      estimateDirectAiCost(attempt({ model: "gpt-5.6-luna-2099-01-01" })),
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
