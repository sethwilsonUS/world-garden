import { describe, expect, it } from "vitest";
import {
  allocateMicrosByLargestRemainder,
  buildAiCostReport,
  type AiCostDailyRollupInput,
} from "./ai-cost-report";

const EMPTY_COUNTERS = {
  providerAttempts: 0,
  successfulAttempts: 0,
  failedBeforeDispatchAttempts: 0,
  failedAfterDispatchAttempts: 0,
  ambiguousAfterDispatchAttempts: 0,
  potentiallyBillableAttempts: 0,
  fallbackAttempts: 0,
  fallbackSucceededAttempts: 0,
  inputCharacters: 0,
  inputWords: 0,
  inputTokens: 0,
  cachedInputTokens: 0,
  cacheWriteInputTokens: 0,
  outputTokens: 0,
  webSearchCalls: 0,
  providerResponseAudioBytes: 0,
  providerAudioDurationMeasuredMs: 0,
  providerAudioDurationEstimatedMs: 0,
  estimatedDirectAiCostMicros: 0,
  estimatedCostKnownAttempts: 0,
  estimatedCostProviderUsageAttempts: 0,
  estimatedCostLocalEstimateAttempts: 0,
  estimatedCostUnknownAttempts: 0,
  cacheRequests: 0,
  cacheHits: 0,
  cacheMisses: 0,
  reusedAssetServes: 0,
  avoidedGeneration: 0,
  uniqueGeneratedAssets: 0,
  concurrentGenerationRaces: 0,
  cacheWriteFailures: 0,
  idempotentRetryWrites: 0,
  cacheServedBytes: 0,
  cacheServedDurationMs: 0,
  uniqueGeneratedBytes: 0,
  uniqueGeneratedDurationMeasuredMs: 0,
  uniqueGeneratedDurationEstimatedMs: 0,
  pipelineGeneratedSections: 0,
  pipelineReusedSections: 0,
  signedInUniqueHeardMs: 0,
  generationAwaitingObservation: 0,
  generationObservedMeaningfulUse: 0,
  generationNoObservedMeaningfulUse: 0,
  generationExternalConsumptionUnknown: 0,
} as const;

const rollup = (
  overrides: Partial<AiCostDailyRollupInput> = {},
): AiCostDailyRollupInput => ({
  key: "rollup-a",
  bucketStart: Date.UTC(2026, 6, 1),
  source: "article_context",
  provider: "openai",
  operation: "article_context_generation",
  ...EMPTY_COUNTERS,
  ...overrides,
});

describe("AI cost report", () => {
  it("uses deterministic largest-remainder allocation that sums exactly", () => {
    const result = allocateMicrosByLargestRemainder(10, [
      { key: "c", weight: 1 },
      { key: "a", weight: 1 },
      { key: "b", weight: 1 },
    ]);

    expect(result).toEqual({
      allocations: { a: 4, b: 3, c: 3 },
      unallocatedMicros: 0,
    });
    expect(
      Object.values(result.allocations).reduce((sum, value) => sum + value, 0),
    ).toBe(10);
  });

  it("allocates a provider statement exactly while preserving its source total", () => {
    const report = buildAiCostReport({
      fromDay: "2026-07-01",
      toDay: "2026-07-03",
      coverageStartedAt: Date.UTC(2026, 6, 1),
      rollups: [
        rollup({
          key: "day-a",
          estimatedDirectAiCostMicros: 1,
          estimatedCostKnownAttempts: 1,
          inputTokens: 1,
          potentiallyBillableAttempts: 1,
          providerAttempts: 1,
          successfulAttempts: 1,
          signedInUniqueHeardMs: 3_600_000,
        }),
        rollup({
          key: "day-b",
          bucketStart: Date.UTC(2026, 6, 2),
          estimatedDirectAiCostMicros: 1,
          estimatedCostKnownAttempts: 1,
          inputTokens: 1,
          potentiallyBillableAttempts: 1,
          providerAttempts: 1,
          successfulAttempts: 1,
        }),
      ],
      statements: [
        {
          statementKey: "statement.2026-07.openai",
          provider: "openai",
          serviceScope: "responses",
          periodStartDay: "2026-07-01",
          periodEndDay: "2026-07-03",
          periodStart: Date.UTC(2026, 6, 1),
          periodEnd: Date.UTC(2026, 6, 3),
          amountMicros: 5,
          currency: "USD",
          source: "manual_entry",
          allocationMethod: "input_tokens",
        },
      ],
    });

    expect(report.costs.reconciled_direct_ai_cost_micros).toBe(5);
    expect(report.costs.reconciled_allocated_micros).toBe(5);
    expect(report.costs.reconciled_unallocated_micros).toBe(0);
    expect(
      report.costs.daily.reduce(
        (sum, day) => sum + (day.reconciled_direct_ai_cost_micros ?? 0),
        0,
      ),
    ).toBe(5);
    expect(
      report.unit_costs.reconciled_direct_ai_cost_per_observed_useful_hour,
    ).toBe(5);
    expect(JSON.stringify(report)).not.toContain("statement.2026-07.openai");
    expect(JSON.stringify(report)).not.toContain("day-a");
  });

  it("keeps response-model and web-search billing scopes disjoint", () => {
    const reportInput = {
      fromDay: "2026-07-01",
      toDay: "2026-07-03",
      coverageStartedAt: Date.UTC(2026, 6, 1),
      rollups: [
        rollup({
          key: "research-day-a",
          operation: "trending_brief_research" as const,
          potentiallyBillableAttempts: 1,
          providerAttempts: 1,
          successfulAttempts: 1,
          inputTokens: 10,
          estimatedDirectAiCostMicros: 10,
          estimatedCostKnownAttempts: 1,
        }),
        rollup({
          key: "research-day-b",
          bucketStart: Date.UTC(2026, 6, 2),
          operation: "trending_brief_research" as const,
          potentiallyBillableAttempts: 1,
          providerAttempts: 1,
          successfulAttempts: 1,
          inputTokens: 10,
          webSearchCalls: 10,
          estimatedDirectAiCostMicros: 110,
          estimatedCostKnownAttempts: 1,
        }),
      ],
      statements: [
        {
          statementKey: "statement.responses.openai",
          provider: "openai" as const,
          serviceScope: "responses" as const,
          periodStartDay: "2026-07-01",
          periodEndDay: "2026-07-03",
          periodStart: Date.UTC(2026, 6, 1),
          periodEnd: Date.UTC(2026, 6, 3),
          amountMicros: 100,
          currency: "USD" as const,
          source: "manual_entry" as const,
          allocationMethod: "input_tokens" as const,
        },
        {
          statementKey: "statement.search.openai",
          provider: "openai" as const,
          serviceScope: "web_search" as const,
          periodStartDay: "2026-07-01",
          periodEndDay: "2026-07-03",
          periodStart: Date.UTC(2026, 6, 1),
          periodEnd: Date.UTC(2026, 6, 3),
          amountMicros: 50,
          currency: "USD" as const,
          source: "manual_entry" as const,
          allocationMethod: "web_search_calls" as const,
        },
      ],
    };
    const report = buildAiCostReport(reportInput);

    expect(report.costs.reconciled_direct_ai_cost_micros).toBe(150);
    expect(report.costs.reconciliation).toMatchObject({
      quality: "provider_reported",
      exact_statement_count: 2,
      conflicting_statement_count: 0,
    });
    expect(report.costs.daily).toEqual([
      expect.objectContaining({ reconciled_direct_ai_cost_micros: 50 }),
      expect.objectContaining({ reconciled_direct_ai_cost_micros: 100 }),
    ]);

    const incompatible = buildAiCostReport({
      ...reportInput,
      statements: [
        {
          ...reportInput.statements[0],
          allocationMethod: "estimated_cost_weight" as const,
        },
        reportInput.statements[1],
      ],
    });
    expect(incompatible.costs.reconciled_direct_ai_cost_micros).toBe(150);
    expect(incompatible.costs.reconciled_allocated_micros).toBe(50);
    expect(incompatible.costs.reconciled_unallocated_micros).toBe(100);
    expect(
      incompatible.costs.daily[0].reconciled_direct_ai_cost_micros,
    ).toBeNull();
    expect(
      incompatible.costs.daily[1].reconciled_direct_ai_cost_micros,
    ).toBeNull();
  });

  it("returns null with reasons when reconciliation or useful hours are absent", () => {
    const report = buildAiCostReport({
      fromDay: "2026-07-01",
      toDay: "2026-07-02",
      rollups: [rollup()],
      statements: [],
    });

    expect(report.costs.reconciled_direct_ai_cost_micros).toBeNull();
    expect(report.costs.reconciled_allocated_micros).toBeNull();
    expect(report.costs.reconciled_unallocated_micros).toBeNull();
    expect(
      report.unit_costs.reconciled_direct_ai_cost_per_observed_useful_hour,
    ).toBeNull();
    expect(
      report.unit_costs
        .reconciled_direct_ai_cost_per_observed_useful_hour_reason,
    ).toMatch(/statement/i);

    const zeroListening = buildAiCostReport({
      fromDay: "2026-07-01",
      toDay: "2026-07-02",
      coverageStartedAt: Date.UTC(2026, 6, 1),
      rollups: [rollup()],
      statements: [
        {
          statementKey: "statement.2026-07.openai",
          provider: "openai",
          serviceScope: "all_direct_ai",
          periodStartDay: "2026-07-01",
          periodEndDay: "2026-07-02",
          periodStart: Date.UTC(2026, 6, 1),
          periodEnd: Date.UTC(2026, 6, 2),
          amountMicros: 1_000,
          currency: "USD",
          source: "manual_entry",
          allocationMethod: "unallocated",
        },
      ],
    });
    expect(
      zeroListening.unit_costs
        .reconciled_direct_ai_cost_per_observed_useful_hour,
    ).toBeNull();
    expect(
      zeroListening.unit_costs
        .reconciled_direct_ai_cost_per_observed_useful_hour_reason,
    ).toMatch(/zero/i);
  });

  it("separates observed activity from immutable coverage-marker evidence", () => {
    const input = {
      fromDay: "2026-07-01",
      toDay: "2026-07-02",
      rollups: [
        rollup({
          potentiallyBillableAttempts: 1,
          providerAttempts: 1,
          successfulAttempts: 1,
          estimatedCostUnknownAttempts: 1,
          signedInUniqueHeardMs: 3_600_000,
        }),
      ],
      statements: [
        {
          statementKey: "statement.coverage.openai",
          provider: "openai" as const,
          serviceScope: "all_direct_ai" as const,
          periodStartDay: "2026-07-01",
          periodEndDay: "2026-07-02",
          periodStart: Date.UTC(2026, 6, 1),
          periodEnd: Date.UTC(2026, 6, 2),
          amountMicros: 1_000,
          currency: "USD" as const,
          source: "manual_entry" as const,
          allocationMethod: "unallocated" as const,
        },
      ],
    };

    const unknownCoverage = buildAiCostReport(input);
    expect(unknownCoverage.coverage).toMatchObject({
      starts_at: null,
      observed_activity_start_day: "2026-07-01",
      range_coverage: "unknown",
      instrumentation_completeness: "unknown",
    });
    expect(
      unknownCoverage.unit_costs
        .reconciled_direct_ai_cost_per_observed_useful_hour,
    ).toBeNull();
    expect(
      unknownCoverage.unit_costs
        .reconciled_direct_ai_cost_per_observed_useful_hour_reason,
    ).toMatch(/coverage/i);
    expect(
      unknownCoverage.unit_costs
        .reconciled_direct_ai_cost_per_observed_useful_hour_coverage_quality,
    ).toBe("unknown");

    const partialSameDayCoverage = buildAiCostReport({
      ...input,
      coverageStartedAt: Date.UTC(2026, 6, 1) + 1,
    });
    expect(partialSameDayCoverage.coverage.range_coverage).toBe(
      "partial_from_marker",
    );
    expect(
      partialSameDayCoverage.unit_costs
        .reconciled_direct_ai_cost_per_observed_useful_hour,
    ).toBeNull();
    expect(
      partialSameDayCoverage.unit_costs
        .reconciled_direct_ai_cost_per_observed_useful_hour_coverage_quality,
    ).toBe("partial_from_marker");

    const confirmedCoverage = buildAiCostReport({
      ...input,
      coverageStartedAt: Date.UTC(2026, 6, 1),
    });
    expect(confirmedCoverage.coverage).toMatchObject({
      starts_at: "2026-07-01T00:00:00.000Z",
      observed_activity_start_day: "2026-07-01",
      range_coverage: "marker_precedes_requested_range",
      instrumentation_completeness: "no_known_gaps",
    });
    expect(
      confirmedCoverage.unit_costs
        .reconciled_direct_ai_cost_per_observed_useful_hour,
    ).toBe(1_000);
    expect(
      confirmedCoverage.unit_costs
        .reconciled_direct_ai_cost_per_observed_useful_hour_coverage_quality,
    ).toBe("marker_precedes_range_no_known_gaps");
  });

  it("does not call partial or conflicting statements reconciled", () => {
    const statement = {
      statementKey: "statement.2026-07.openai",
      provider: "openai" as const,
      serviceScope: "all_direct_ai" as const,
      periodStartDay: "2026-07-01",
      periodEndDay: "2026-07-02",
      periodStart: Date.UTC(2026, 6, 1),
      periodEnd: Date.UTC(2026, 6, 2),
      amountMicros: 100,
      currency: "USD" as const,
      source: "manual_entry" as const,
      allocationMethod: "unallocated" as const,
    };
    const partial = buildAiCostReport({
      fromDay: "2026-07-01",
      toDay: "2026-07-03",
      rollups: [rollup()],
      statements: [statement],
    });
    expect(partial.costs.reconciled_direct_ai_cost_micros).toBeNull();

    const exact = {
      ...statement,
      periodEndDay: "2026-07-03",
      periodEnd: Date.UTC(2026, 6, 3),
    };
    const conflict = buildAiCostReport({
      fromDay: "2026-07-01",
      toDay: "2026-07-03",
      rollups: [rollup()],
      statements: [
        exact,
        { ...exact, statementKey: "statement.duplicate.openai" },
      ],
    });
    expect(conflict.costs.reconciled_direct_ai_cost_micros).toBeNull();
    expect(
      conflict.costs.reconciliation.conflicting_statement_count,
    ).toBeGreaterThan(0);
    expect(conflict.coverage.reconciliation_status).toBe(
      "ambiguous_or_conflicting_statements",
    );

    const exactPlusPartial = buildAiCostReport({
      fromDay: "2026-07-01",
      toDay: "2026-07-03",
      rollups: [rollup({ potentiallyBillableAttempts: 1 })],
      statements: [exact, statement],
    });
    expect(exactPlusPartial.costs.reconciled_direct_ai_cost_micros).toBeNull();
    expect(exactPlusPartial.costs.reconciliation.explanation).toMatch(
      /partially overlapping/i,
    );

    const extraInactiveScope = buildAiCostReport({
      fromDay: "2026-07-01",
      toDay: "2026-07-03",
      rollups: [rollup({ potentiallyBillableAttempts: 1 })],
      statements: [
        { ...exact, serviceScope: "responses" },
        {
          ...exact,
          statementKey: "statement.inactive-speech.openai",
          serviceScope: "speech",
        },
      ],
    });
    expect(
      extraInactiveScope.costs.reconciled_direct_ai_cost_micros,
    ).toBeNull();
    expect(
      extraInactiveScope.costs.reconciliation.conflicting_statement_count,
    ).toBeGreaterThan(0);

    const missingSpeechScopeAfterFailOpen = buildAiCostReport({
      fromDay: "2026-07-01",
      toDay: "2026-07-03",
      rollups: [
        rollup({ potentiallyBillableAttempts: 1 }),
        rollup({
          key: "generated-speech-without-attempt",
          operation: "tts",
          source: "interactive_article",
          uniqueGeneratedAssets: 1,
          uniqueGeneratedBytes: 1234,
        }),
      ],
      statements: [{ ...exact, serviceScope: "responses" }],
    });
    expect(
      missingSpeechScopeAfterFailOpen.costs.reconciled_direct_ai_cost_micros,
    ).toBeNull();
    expect(
      missingSpeechScopeAfterFailOpen.costs.reconciliation.explanation,
    ).toMatch(/active service scopes/i);
  });

  it("exposes unknown estimate coverage and honors the CLI field contract", () => {
    const report = buildAiCostReport({
      fromDay: "2026-07-01",
      toDay: "2026-07-02",
      rollups: [
        rollup({
          estimatedDirectAiCostMicros: 243,
          estimatedCostUnknownAttempts: 1,
        }),
      ],
      statements: [],
    });

    expect(report.range).toMatchObject({
      from: "2026-07-01",
      to: "2026-07-02",
      timezone: "UTC",
    });
    expect(report.costs.estimated_direct_ai_cost_micros).toBeNull();
    expect(report.costs.estimated_direct_ai_cost_known_subtotal_micros).toBe(
      243,
    );
    expect(report.audio).toHaveProperty("response_audio_bytes");
    expect(report.cache).toHaveProperty("cache_hits");
    expect(report.unit_costs).toHaveProperty(
      "reconciled_direct_ai_cost_per_observed_useful_hour",
    );
  });

  it("does not require source-split generation evidence to share a provider-attempt row", () => {
    const report = buildAiCostReport({
      fromDay: "2026-07-01",
      toDay: "2026-07-02",
      coverageStartedAt: Date.UTC(2026, 5, 30),
      rollups: [
        rollup({
          key: "attempt",
          source: "unknown",
          operation: "tts",
          providerAttempts: 1,
          successfulAttempts: 1,
          estimatedCostKnownAttempts: 1,
        }),
        rollup({
          key: "generation",
          source: "featured_podcast",
          operation: "tts",
          uniqueGeneratedAssets: 1,
          uniqueGeneratedBytes: 2_048,
        }),
      ],
      statements: [],
    });

    expect(report.costs.estimated_direct_ai_cost_micros).toBe(0);
    expect(report.coverage.measurement_quality_counts).toMatchObject({
      provider_attempt_accounting_gap_rows: 0,
    });
  });

  it("does not require a generation save after midnight to share its dispatch day", () => {
    const report = buildAiCostReport({
      fromDay: "2026-07-01",
      toDay: "2026-07-03",
      coverageStartedAt: Date.UTC(2026, 5, 30),
      rollups: [
        rollup({
          key: "dispatch",
          source: "featured_podcast",
          operation: "tts",
          providerAttempts: 1,
          successfulAttempts: 1,
          estimatedCostKnownAttempts: 1,
        }),
        rollup({
          key: "save",
          bucketStart: Date.UTC(2026, 6, 2),
          source: "featured_podcast",
          operation: "tts",
          uniqueGeneratedAssets: 1,
          uniqueGeneratedBytes: 2_048,
        }),
      ],
      statements: [],
    });

    expect(report.costs.estimated_direct_ai_cost_micros).toBe(0);
    expect(
      report.costs.daily.map(
        ({ estimated_direct_ai_cost_micros }) =>
          estimated_direct_ai_cost_micros,
      ),
    ).toEqual([0, 0]);
    expect(
      report.coverage.measurement_quality_counts
        .provider_attempt_accounting_gap_rows,
    ).toBe(0);
  });

  it("withholds an estimate when attempt and estimate counts disagree", () => {
    const report = buildAiCostReport({
      fromDay: "2026-07-01",
      toDay: "2026-07-02",
      coverageStartedAt: Date.UTC(2026, 5, 30),
      rollups: [
        rollup({
          providerAttempts: 1,
          successfulAttempts: 1,
        }),
      ],
      statements: [],
    });

    expect(report.costs.estimated_direct_ai_cost_micros).toBeNull();
    expect(report.costs.estimated_direct_ai_cost_reason).toMatch(
      /provider-attempt accounting/i,
    );
    expect(report.costs.estimated_direct_ai_cost_reason).toMatch(
      /estimate-quality counts/i,
    );
    expect(report.coverage.instrumentation_completeness_reason).toMatch(
      /estimate-quality counts/i,
    );
    expect(
      report.coverage.measurement_quality_counts
        .provider_attempt_accounting_gap_rows,
    ).toBe(1);
  });

  it("preserves actual totals but withholds estimates and allocations for a partially covered range", () => {
    const report = buildAiCostReport({
      fromDay: "2026-07-01",
      toDay: "2026-07-02",
      coverageStartedAt: Date.UTC(2026, 6, 1) + 1,
      rollups: [
        rollup({
          providerAttempts: 1,
          successfulAttempts: 1,
          potentiallyBillableAttempts: 1,
          estimatedCostKnownAttempts: 1,
          estimatedCostProviderUsageAttempts: 1,
          estimatedDirectAiCostMicros: 100,
          inputTokens: 10,
          signedInUniqueHeardMs: 3_600_000,
        }),
      ],
      statements: [
        {
          statementKey: "statement.partial-coverage.openai",
          provider: "openai",
          serviceScope: "responses",
          periodStartDay: "2026-07-01",
          periodEndDay: "2026-07-02",
          periodStart: Date.UTC(2026, 6, 1),
          periodEnd: Date.UTC(2026, 6, 2),
          amountMicros: 200,
          currency: "USD",
          source: "manual_entry",
          allocationMethod: "input_tokens",
        },
      ],
    });

    expect(report.costs.estimated_direct_ai_cost_micros).toBeNull();
    expect(report.costs.estimated_direct_ai_cost_known_subtotal_micros).toBe(
      100,
    );
    expect(report.costs.estimated_direct_ai_cost_reason).toMatch(/coverage/i);
    expect(report.costs.reconciled_direct_ai_cost_micros).toBe(200);
    expect(report.costs.reconciled_allocated_micros).toBe(0);
    expect(report.costs.reconciled_unallocated_micros).toBe(200);
    expect(report.costs.daily[0].reconciled_direct_ai_cost_micros).toBeNull();
  });

  it("calculates large reconciled unit costs without Number overflow", () => {
    const report = buildAiCostReport({
      fromDay: "2026-07-01",
      toDay: "2026-07-02",
      coverageStartedAt: Date.UTC(2026, 6, 1),
      rollups: [rollup({ signedInUniqueHeardMs: 3_600_000 })],
      statements: [
        {
          statementKey: "statement.large.openai",
          provider: "openai",
          serviceScope: "all_direct_ai",
          periodStartDay: "2026-07-01",
          periodEndDay: "2026-07-02",
          periodStart: Date.UTC(2026, 6, 1),
          periodEnd: Date.UTC(2026, 6, 2),
          amountMicros: 3_000_000_000,
          currency: "USD",
          source: "manual_entry",
          allocationMethod: "unallocated",
        },
      ],
    });
    expect(
      report.unit_costs.reconciled_direct_ai_cost_per_observed_useful_hour,
    ).toBe(3_000_000_000);
  });

  it("rejects an unsafe aggregate even when each statement amount is safe", () => {
    expect(() =>
      buildAiCostReport({
        fromDay: "2026-07-01",
        toDay: "2026-07-02",
        coverageStartedAt: Date.UTC(2026, 6, 1),
        rollups: [
          rollup({
            operation: "trending_brief_research",
            providerAttempts: 1,
            successfulAttempts: 1,
            potentiallyBillableAttempts: 1,
            estimatedCostKnownAttempts: 1,
            inputTokens: 1,
            webSearchCalls: 1,
          }),
        ],
        statements: [
          {
            statementKey: "statement.overflow.responses",
            provider: "openai",
            serviceScope: "responses",
            periodStartDay: "2026-07-01",
            periodEndDay: "2026-07-02",
            periodStart: Date.UTC(2026, 6, 1),
            periodEnd: Date.UTC(2026, 6, 2),
            amountMicros: Number.MAX_SAFE_INTEGER,
            currency: "USD",
            source: "manual_entry",
            allocationMethod: "unallocated",
          },
          {
            statementKey: "statement.overflow.search",
            provider: "openai",
            serviceScope: "web_search",
            periodStartDay: "2026-07-01",
            periodEndDay: "2026-07-02",
            periodStart: Date.UTC(2026, 6, 1),
            periodEnd: Date.UTC(2026, 6, 2),
            amountMicros: Number.MAX_SAFE_INTEGER,
            currency: "USD",
            source: "manual_entry",
            allocationMethod: "unallocated",
          },
        ],
      }),
    ).toThrow(/safe integer/i);
  });
});
