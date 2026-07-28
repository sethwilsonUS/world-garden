import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  getProviderAttemptRollupContribution,
  getProviderAttemptFromEvent,
  getGenerationMaturation,
  cleanupExpiredAiCostLedgerEventsForCtx,
  ensureAiCostLedgerCoverageForCtx,
  finalizeGenerationUseCohortsForCtx,
  normalizeCacheDecisionInput,
  normalizeListeningContributionInput,
  readAiCostLedgerCoverageStartedAtForCtx,
  recordCacheDecisionForCtx,
  recordListeningContributionForCtx,
  recordProviderAttemptForCtx,
  resetAiCostLedgerCoverageForCtx,
  resolveProviderAttemptWrite,
  selectGenerationForObservedUse,
  toProviderAttemptEvent,
} from "./aiCostLedger";
import type { AiCostProviderAttempt } from "../../lib/ai-cost-ledger-contract";
import { estimateDirectAiCost } from "../../lib/ai-cost-pricing";

const providerAttempt = (
  overrides: Partial<AiCostProviderAttempt> = {},
): AiCostProviderAttempt => ({
  eventKey: "provider.event-0001",
  correlationId: "provider.correlation-0001",
  lifecycleVersion: 0,
  operation: "article_context_generation",
  source: "article_context",
  requestedProvider: "openai",
  effectiveProvider: "openai",
  model: "gpt-5.6-luna",
  serviceTier: "auto",
  profile: null,
  state: "unknown_after_dispatch",
  failureCategory: "unknown",
  dispatchedAt: 1_800_000_000_000,
  completedAt: null,
  inputCharacters: 800,
  inputWords: 120,
  inputTokens: null,
  cachedInputTokens: null,
  cacheWriteInputTokens: null,
  outputTokens: null,
  reasoningOutputTokens: null,
  audioInputTokens: null,
  audioOutputTokens: null,
  webSearchCalls: null,
  responseAudioBytes: null,
  audioDurationMs: null,
  durationMeasurement: "unknown",
  isFallbackAttempt: false,
  ...overrides,
});

type LedgerHarnessRow = Record<string, unknown> & { _id: string };

const createProviderAttemptLedgerHarness = (
  initialTables: Record<string, LedgerHarnessRow[]>,
) => {
  const tables: Record<string, LedgerHarnessRow[]> = {
    aiCostLedgerCoverage: [
      {
        _id: "coverage",
        key: "observe-v1",
        epochKey: "implicit.initial-observe-v1",
        epochVersion: 1,
        firstObservedAt: 1_700_000_000_000,
        resetAt: 1_700_000_000_000,
      },
    ],
    aiCostLedgerDeliveries: [],
    aiCostLedgerEvents: [],
    aiCostDailyRollups: [],
    ...initialTables,
  };
  const ctx = {
    db: {
      query: (table: string) => ({
        withIndex: (
          _index: string,
          callback: (range: {
            eq: (field: string, value: unknown) => unknown;
            gt: (field: string, value: unknown) => unknown;
            lte: (field: string, value: unknown) => unknown;
          }) => unknown,
        ) => {
          let field: string | null = null;
          let value: unknown;
          const range = {
            eq: (nextField: string, nextValue: unknown) => {
              field = nextField;
              value = nextValue;
              return range;
            },
            gt: () => range,
            lte: () => range,
          };
          callback(range);
          const matchingRows = () =>
            (tables[table] ?? []).filter(
              (row) => field === null || row[field] === value,
            );
          return {
            unique: async () => matchingRows()[0] ?? null,
            collect: async () => matchingRows(),
            take: async (limit: number) => matchingRows().slice(0, limit),
          };
        },
      }),
      insert: async (table: string, value: Record<string, unknown>) => {
        const rows = (tables[table] ??= []);
        const id = `${table}-${rows.length + 1}`;
        rows.push({ _id: id, ...value });
        return id;
      },
      patch: async (id: unknown, value: Record<string, unknown>) => {
        const row = Object.values(tables)
          .flat()
          .find((candidate) => candidate._id === id);
        if (!row) throw new Error(`Unknown ledger harness row: ${String(id)}`);
        Object.assign(row, value);
      },
      delete: async (id: unknown) => {
        for (const rows of Object.values(tables)) {
          const index = rows.findIndex((row) => row._id === id);
          if (index !== -1) {
            rows.splice(index, 1);
            return;
          }
        }
      },
    },
  };
  return { ctx, tables };
};

describe("AI cost ledger mutation inputs", () => {
  beforeEach(() => {
    vi.stubEnv("AI_COST_LEDGER_MODE", "off");
  });

  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it("starts a new marker after an idempotent explicit epoch reset", async () => {
    let coverage: {
      _id: string;
      key: string;
      epochKey: string;
      epochVersion: number;
      firstObservedAt: number | null;
      resetAt: number;
    } | null = null;
    let coverageInsertCount = 0;
    const resetReceipts = new Map<string, Record<string, unknown>>();
    let equalityValue: unknown;
    const range = {
      eq: (_field: string, value: unknown) => {
        equalityValue = value;
        return range;
      },
      gt: () => range,
      lte: () => range,
    };
    const ctx = {
      db: {
        query: (table: string) => ({
          withIndex: (
            _index: string,
            callback: (value: typeof range) => typeof range,
          ) => {
            equalityValue = undefined;
            callback(range);
            return {
              unique: async () => {
                if (table === "aiCostLedgerCoverage") return coverage;
                if (table === "aiCostLedgerCoverageResets") {
                  return resetReceipts.get(String(equalityValue)) ?? null;
                }
                return null;
              },
            };
          },
        }),
        insert: async (table: string, value: Record<string, unknown>) => {
          if (table === "aiCostLedgerCoverageResets") {
            const receipt = {
              _id: `reset-${resetReceipts.size + 1}`,
              ...value,
            };
            resetReceipts.set(String(value.epochKey), receipt);
            return receipt._id;
          }
          coverageInsertCount += 1;
          coverage = {
            _id: "coverage",
            key: String(value.key),
            epochKey: String(value.epochKey),
            epochVersion: Number(value.epochVersion),
            firstObservedAt:
              typeof value.firstObservedAt === "number"
                ? value.firstObservedAt
                : null,
            resetAt: Number(value.resetAt),
          };
          return coverage._id;
        },
        patch: async (_id: unknown, value: Record<string, unknown>) => {
          coverage = { ...coverage!, ...value };
        },
      },
    };

    await expect(
      ensureAiCostLedgerCoverageForCtx(ctx as never, 1_800_000_000_000),
    ).resolves.toBe(1_800_000_000_000);
    await expect(
      resetAiCostLedgerCoverageForCtx(ctx as never, {
        epochKey: "epoch.reset-0001",
        now: 1_850_000_000_000,
      }),
    ).resolves.toEqual({
      reset: true,
      disposition: "updated",
      epochVersion: 2,
    });
    await expect(
      readAiCostLedgerCoverageStartedAtForCtx(ctx as never),
    ).resolves.toBeNull();
    await expect(
      ensureAiCostLedgerCoverageForCtx(ctx as never, 1_900_000_000_000),
    ).resolves.toBe(1_900_000_000_000);
    await expect(
      resetAiCostLedgerCoverageForCtx(ctx as never, {
        epochKey: "epoch.reset-0001",
        now: 1_950_000_000_000,
      }),
    ).resolves.toEqual({
      reset: false,
      disposition: "duplicate",
      epochVersion: 2,
    });
    await expect(
      readAiCostLedgerCoverageStartedAtForCtx(ctx as never),
    ).resolves.toBe(1_900_000_000_000);
    await expect(
      resetAiCostLedgerCoverageForCtx(ctx as never, {
        epochKey: "epoch.reset-0002",
        now: 2_000_000_000_000,
      }),
    ).resolves.toEqual({
      reset: true,
      disposition: "updated",
      epochVersion: 3,
    });
    await expect(
      ensureAiCostLedgerCoverageForCtx(ctx as never, 2_050_000_000_000),
    ).resolves.toBe(2_050_000_000_000);
    await expect(
      resetAiCostLedgerCoverageForCtx(ctx as never, {
        epochKey: "epoch.reset-0001",
        now: 2_100_000_000_000,
      }),
    ).resolves.toEqual({
      reset: false,
      disposition: "duplicate",
      epochVersion: 2,
    });
    await expect(
      readAiCostLedgerCoverageStartedAtForCtx(ctx as never),
    ).resolves.toBe(2_050_000_000_000);
    expect(coverageInsertCount).toBe(1);
  });

  it("upgrades a legacy coverage marker when starting an explicit epoch", async () => {
    const legacyCoverage = {
      _id: "legacy-coverage",
      key: "observe-v1",
      firstObservedAt: 1_800_000_000_000,
      createdAt: 1_800_000_000_000,
    };
    let patch: Record<string, unknown> | null = null;
    const range = {
      eq: () => range,
      gt: () => range,
      lte: () => range,
    };
    const ctx = {
      db: {
        query: (table: string) => ({
          withIndex: (
            _index: string,
            callback: (value: typeof range) => typeof range,
          ) => {
            callback(range);
            return {
              unique: async () =>
                table === "aiCostLedgerCoverage" ? legacyCoverage : null,
            };
          },
        }),
        insert: async () => "reset-receipt",
        patch: async (_id: unknown, value: Record<string, unknown>) => {
          patch = value;
        },
      },
    };

    await expect(
      resetAiCostLedgerCoverageForCtx(ctx as never, {
        epochKey: "epoch.reset-legacy-0001",
        now: 1_850_000_000_000,
      }),
    ).resolves.toEqual({
      reset: true,
      disposition: "updated",
      epochVersion: 2,
    });
    expect(patch).toMatchObject({
      epochKey: "epoch.reset-legacy-0001",
      epochVersion: 2,
      firstObservedAt: null,
    });
  });

  it("refuses to reset coverage while Convex observation is enabled", async () => {
    const previousMode = process.env.AI_COST_LEDGER_MODE;
    process.env.AI_COST_LEDGER_MODE = "observe";
    try {
      await expect(
        resetAiCostLedgerCoverageForCtx(
          {
            db: {
              query: () => {
                throw new Error("database must not be read");
              },
            },
          },
          { epochKey: "epoch.reset-live-0001" },
        ),
      ).rejects.toThrow("only be reset while the ledger mode is off");
    } finally {
      if (previousMode === undefined) delete process.env.AI_COST_LEDGER_MODE;
      else process.env.AI_COST_LEDGER_MODE = previousMode;
    }
  });

  it("creates coverage atomically with the first accepted operational event", async () => {
    const previousMode = process.env.AI_COST_LEDGER_MODE;
    process.env.AI_COST_LEDGER_MODE = "observe";
    const now = 1_800_000_000_000;
    const nowSpy = vi.spyOn(Date, "now").mockReturnValue(now);
    const rows = new Map<string, Record<string, unknown>>();
    let insertion = 0;
    const range = {
      eq: () => range,
      gt: () => range,
      lte: () => range,
    };
    const ctx = {
      db: {
        query: (table: string) => ({
          withIndex: (
            _index: string,
            callback: (value: typeof range) => typeof range,
          ) => {
            callback(range);
            return {
              unique: async () => rows.get(table) ?? null,
            };
          },
        }),
        insert: async (table: string, value: Record<string, unknown>) => {
          insertion += 1;
          rows.set(table, { _id: `${table}-${insertion}`, ...value });
          return `${table}-${insertion}`;
        },
      },
    };
    const input = {
      eventKey: "cache.event-first-observed",
      source: "interactive_article" as const,
      provider: "openai" as const,
      operation: "tts" as const,
      requests: 1,
      hits: 1,
      misses: 0,
      reusedAssetServes: 1,
      avoidedGeneration: 1,
      uniqueGeneratedAssets: 0,
      concurrentGenerationRaces: 0,
      cacheWriteFailures: 0,
      idempotentRetryWrites: 0,
      bytes: 100,
      seconds: 1,
    };

    try {
      await expect(
        recordCacheDecisionForCtx(ctx as never, input),
      ).resolves.toEqual({ created: true, disposition: "inserted" });
      expect(rows.get("aiCostLedgerCoverage")).toMatchObject({
        key: "observe-v1",
        firstObservedAt: now,
      });
      await expect(
        recordCacheDecisionForCtx(ctx as never, input),
      ).resolves.toEqual({ created: false, disposition: "duplicate" });
      expect(rows.get("aiCostLedgerCoverage")?.firstObservedAt).toBe(now);
    } finally {
      nowSpy.mockRestore();
      if (previousMode === undefined) delete process.env.AI_COST_LEDGER_MODE;
      else process.env.AI_COST_LEDGER_MODE = previousMode;
    }
  });

  it("performs no database work while the ledger mode is off", async () => {
    const previousMode = process.env.AI_COST_LEDGER_MODE;
    delete process.env.AI_COST_LEDGER_MODE;
    try {
      await expect(
        recordCacheDecisionForCtx(
          {
            db: {
              query: () => {
                throw new Error("database must not be read");
              },
            },
          },
          {
            eventKey: "cache.event-0001",
            source: "interactive_article",
            provider: "openai",
            operation: "tts",
            requests: 1,
            hits: 1,
            misses: 0,
            reusedAssetServes: 1,
            avoidedGeneration: 1,
            uniqueGeneratedAssets: 0,
            concurrentGenerationRaces: 0,
            cacheWriteFailures: 0,
            idempotentRetryWrites: 0,
            bytes: 100,
            seconds: 1,
          },
        ),
      ).resolves.toEqual({ created: false, disposition: "disabled" });
    } finally {
      if (previousMode === undefined) delete process.env.AI_COST_LEDGER_MODE;
      else process.env.AI_COST_LEDGER_MODE = previousMode;
    }
  });

  it("preserves authoritative cache counters without accepting content fields", () => {
    const normalized = normalizeCacheDecisionInput({
      eventKey: "cache.event-0001",
      source: "interactive_article",
      provider: "openai",
      operation: "tts",
      requests: 1,
      hits: 1,
      misses: 0,
      reusedAssetServes: 1,
      avoidedGeneration: 1,
      uniqueGeneratedAssets: 0,
      concurrentGenerationRaces: 0,
      cacheWriteFailures: 0,
      idempotentRetryWrites: 0,
      bytes: 12_345,
      seconds: 4.25,
    });

    expect(normalized).toMatchObject({
      requests: 1,
      hits: 1,
      misses: 0,
      bytes: 12_345,
      durationMs: 4_250,
    });
    expect(() =>
      normalizeCacheDecisionInput({
        ...normalized,
        seconds: 4.25,
        articleTitle: "The Fellowship of the Ring",
      } as never),
    ).toThrow("unsupported field");
    for (const invalid of [
      { requests: 1, hits: 1, misses: 1 },
      { requests: 1, hits: 0, misses: 1, reusedAssetServes: 1 },
      { requests: 1, hits: 0, misses: 1, avoidedGeneration: 1 },
    ]) {
      const validDecision = {
        eventKey: "cache.event-0002",
        source: "interactive_article" as const,
        provider: "openai" as const,
        operation: "tts" as const,
        requests: 1,
        hits: 1,
        misses: 0,
        reusedAssetServes: 1,
        avoidedGeneration: 1,
        uniqueGeneratedAssets: 0,
        concurrentGenerationRaces: 0,
        cacheWriteFailures: 0,
        idempotentRetryWrites: 0,
        bytes: 0,
        seconds: 0,
      };
      expect(() =>
        normalizeCacheDecisionInput({
          ...validDecision,
          ...invalid,
        }),
      ).toThrow("cache decision counters");
    }
  });

  it("converts fractional unique heard seconds to integer milliseconds once", () => {
    expect(
      normalizeListeningContributionInput({
        eventKey: "listen.event-0001",
        articleId: "article-id" as never,
        sectionKeys: ["lead"],
        newUniqueSeconds: 1.2345,
        meaningfulUse: false,
        progressStartedAt: 1_799_999_999_000,
        observedAt: 1_800_000_000_000,
      }).newUniqueHeardMs,
    ).toBe(1_235);
  });

  it("selects one latest eligible generation across multiple cache variants", () => {
    const candidate = (eventKey: string, generatedAt: number) => ({
      _id: eventKey,
      eventKey,
      eventDay: 1_799_971_200_000,
      event: {
        kind: "generation_asset",
        generationUseState: "awaiting_observation",
        generatedAt,
        observationEndsAt: generatedAt + 30 * 24 * 60 * 60 * 1_000,
      },
    });
    const observedAt = 1_800_000_000_000;

    expect(
      selectGenerationForObservedUse(
        [
          candidate("asset.variant-old", observedAt - 2_000),
          candidate("asset.variant-current", observedAt - 1_000),
          candidate("asset.variant-future", observedAt + 1_000),
        ],
        observedAt,
      )?.eventKey,
    ).toBe("asset.variant-current");
    expect(
      selectGenerationForObservedUse(
        [candidate("asset.generated-during-session", observedAt - 100)],
        observedAt - 500,
        observedAt,
      ),
    ).toBeNull();
    expect(
      selectGenerationForObservedUse(
        [
          candidate(
            "asset.variant-expired",
            observedAt - 31 * 24 * 60 * 60 * 1_000,
          ),
        ],
        observedAt,
      ),
    ).toBeNull();
    const external = candidate(
      "asset.variant-external",
      observedAt - 31 * 24 * 60 * 60 * 1_000,
    );
    external.event.generationUseState = "external_consumption_unknown";
    expect(selectGenerationForObservedUse([external], observedAt)).toBeNull();
    const recentExternal = candidate(
      "asset.variant-recent-external",
      observedAt - 29 * 24 * 60 * 60 * 1_000,
    );
    recentExternal.event.generationUseState = "external_consumption_unknown";
    expect(
      selectGenerationForObservedUse([recentExternal], observedAt)?.eventKey,
    ).toBe("asset.variant-recent-external");
  });

  it("does not credit a generation created after an earlier section was heard", async () => {
    vi.stubEnv("AI_COST_LEDGER_MODE", "observe");
    const sessionStartedAt = 1_800_000_000_000;
    const finalThresholdAt = sessionStartedAt + 60_000;
    vi.spyOn(Date, "now").mockReturnValue(finalThresholdAt);
    const observationEndsAt = finalThresholdAt + 86_400_000;
    const events = [
      {
        _id: "generation-before-session",
        eventKey: "asset.summary-before-session",
        eventDay: 1_799_971_200_000,
        observationEndsAt,
        event: {
          kind: "generation_asset",
          articleId: "article-1",
          sectionKey: "summary",
          source: "interactive_article",
          provider: "openai",
          generatedAt: sessionStartedAt - 1_000,
          observationEndsAt,
          generationUseState: "awaiting_observation",
        },
      },
      {
        _id: "generation-during-session",
        eventKey: "asset.summary-during-session",
        eventDay: 1_799_971_200_000,
        observationEndsAt,
        event: {
          kind: "generation_asset",
          articleId: "article-1",
          sectionKey: "summary",
          source: "interactive_article",
          provider: "openai",
          generatedAt: sessionStartedAt + 30_000,
          observationEndsAt,
          generationUseState: "awaiting_observation",
        },
      },
    ];
    const sectionAudio = [
      {
        _id: "audio-before-session",
        articleId: "article-1",
        sectionKey: "summary",
        ledgerAssetKey: "asset.summary-before-session",
      },
      {
        _id: "audio-during-session",
        articleId: "article-1",
        sectionKey: "summary",
        ledgerAssetKey: "asset.summary-during-session",
      },
    ];
    const deliveries: Array<Record<string, unknown>> = [];
    const rollups: Array<Record<string, unknown>> = [];
    const coverage = {
      _id: "coverage",
      key: "observe-v1",
      firstObservedAt: sessionStartedAt - 10_000,
    };
    const ctx = {
      db: {
        query: (table: string) => {
          const filters = new Map<string, unknown>();
          const range = {
            eq: (field: string, value: unknown) => {
              filters.set(field, value);
              return range;
            },
            gt: () => range,
            lte: () => range,
          };
          return {
            withIndex: (
              _index: string,
              apply: (builder: typeof range) => typeof range,
            ) => {
              apply(range);
              const matchingEvents = () =>
                events.filter(
                  (event) =>
                    !filters.has("eventKey") ||
                    event.eventKey === filters.get("eventKey"),
                );
              return {
                unique: async () => {
                  if (table === "aiCostLedgerDeliveries") {
                    return (
                      deliveries.find(
                        (delivery) =>
                          delivery.eventKey === filters.get("eventKey"),
                      ) ?? null
                    );
                  }
                  if (table === "aiCostLedgerEvents") {
                    return matchingEvents()[0] ?? null;
                  }
                  if (table === "aiCostLedgerCoverage") return coverage;
                  if (table === "aiCostDailyRollups") {
                    return (
                      rollups.find(
                        (rollup) => rollup.key === filters.get("key"),
                      ) ?? null
                    );
                  }
                  return null;
                },
                collect: async () =>
                  table === "sectionAudio"
                    ? sectionAudio.filter(
                        (audio) =>
                          audio.articleId === filters.get("articleId") &&
                          audio.sectionKey === filters.get("sectionKey"),
                      )
                    : [],
              };
            },
          };
        },
        insert: async (table: string, value: Record<string, unknown>) => {
          const stored = {
            _id: `${table}-${deliveries.length + events.length + rollups.length}`,
            ...value,
          };
          if (table === "aiCostLedgerDeliveries") deliveries.push(stored);
          if (table === "aiCostLedgerEvents") events.push(stored as never);
          if (table === "aiCostDailyRollups") rollups.push(stored);
          return stored._id;
        },
        patch: async (id: string, value: Record<string, unknown>) => {
          const event = events.find((candidate) => candidate._id === id);
          if (event) Object.assign(event, value);
          const audio = sectionAudio.find((candidate) => candidate._id === id);
          if (audio) Object.assign(audio, value);
        },
      },
    };

    await expect(
      recordListeningContributionForCtx(ctx as never, {
        eventKey: "listen.cross-section-session",
        articleId: "article-1" as never,
        sectionKeys: ["summary", "section-0"],
        newUniqueSeconds: 30,
        meaningfulUse: true,
        progressStartedAt: sessionStartedAt,
        observedAt: finalThresholdAt,
      }),
    ).resolves.toEqual({ created: true, disposition: "inserted" });

    expect(events[0]?.event).toMatchObject({
      generationUseState: "observed_meaningful_use",
    });
    expect(events[0]?.event).not.toHaveProperty("articleId");
    expect(events[1]?.event).toMatchObject({
      articleId: "article-1",
      generationUseState: "awaiting_observation",
    });
    expect(sectionAudio[0]?.ledgerAssetKey).toBeUndefined();
    expect(sectionAudio[1]?.ledgerAssetKey).toBe(
      "asset.summary-during-session",
    );
  });

  it("finalizes an ambiguous attempt once and never downgrades it", () => {
    const initial = providerAttempt();
    const terminal = providerAttempt({
      lifecycleVersion: 1,
      state: "succeeded",
      failureCategory: null,
      completedAt: 1_800_000_000_100,
      inputTokens: 200,
      cachedInputTokens: 20,
      cacheWriteInputTokens: 4,
      outputTokens: 10,
      webSearchCalls: 0,
    });

    expect(resolveProviderAttemptWrite(null, initial)).toBe("inserted");
    expect(resolveProviderAttemptWrite(initial, terminal)).toBe("updated");
    expect(resolveProviderAttemptWrite(terminal, terminal)).toBe("duplicate");
    expect(resolveProviderAttemptWrite(terminal, initial)).toBe("stale");
    expect(
      resolveProviderAttemptWrite(
        terminal,
        providerAttempt({ lifecycleVersion: 2 }),
      ),
    ).toBe("stale");
  });

  it("does not seed a missing rollup bucket with a provider-attempt reversal", async () => {
    vi.stubEnv("AI_COST_LEDGER_MODE", "observe");
    const initial = providerAttempt();
    const terminal = providerAttempt({
      lifecycleVersion: 1,
      state: "succeeded",
      failureCategory: null,
      completedAt: initial.dispatchedAt! + 100,
    });
    const eventDay = Date.UTC(
      new Date(initial.dispatchedAt!).getUTCFullYear(),
      new Date(initial.dispatchedAt!).getUTCMonth(),
      new Date(initial.dispatchedAt!).getUTCDate(),
    );
    const { ctx, tables } = createProviderAttemptLedgerHarness({
      aiCostLedgerEvents: [
        {
          _id: "provider-event",
          eventKey: initial.eventKey,
          eventDay,
          observationEndsAt: null,
          event: toProviderAttemptEvent(initial, estimateDirectAiCost(initial)),
        },
      ],
      aiCostLedgerDeliveries: [
        {
          _id: "provider-delivery",
          eventKey: initial.eventKey,
          eventKind: "provider_attempt",
          latestLifecycleVersion: initial.lifecycleVersion,
        },
      ],
    });

    await expect(
      recordProviderAttemptForCtx(ctx as never, terminal),
    ).resolves.toEqual({ recorded: true, disposition: "updated" });
    expect(tables.aiCostDailyRollups).toHaveLength(1);
    expect(tables.aiCostDailyRollups[0]).toMatchObject({
      providerAttempts: 1,
      successfulAttempts: 1,
      ambiguousAfterDispatchAttempts: 0,
      inputCharacters: initial.inputCharacters,
    });
  });

  it.each([true, false])(
    "does not reinsert an existing provider event whose payload cannot be reconstructed (delivery present: %s)",
    async (hasDelivery) => {
      vi.stubEnv("AI_COST_LEDGER_MODE", "observe");
      const attempt = providerAttempt();
      const deliveries: LedgerHarnessRow[] = hasDelivery
        ? [
            {
              _id: "provider-delivery",
              eventKey: attempt.eventKey,
              eventKind: "provider_attempt",
              latestLifecycleVersion: null,
            },
          ]
        : [];
      const { ctx, tables } = createProviderAttemptLedgerHarness({
        aiCostLedgerEvents: [
          {
            _id: "provider-event",
            eventKey: attempt.eventKey,
            eventDay: 1_797_408_000_000,
            observationEndsAt: null,
            event: { kind: "provider_attempt" },
          },
        ],
        aiCostLedgerDeliveries: deliveries,
      });

      await expect(
        recordProviderAttemptForCtx(ctx as never, attempt),
      ).resolves.toEqual({ recorded: false, disposition: "stale" });
      expect(tables.aiCostLedgerEvents).toHaveLength(1);
      expect(tables.aiCostLedgerDeliveries).toHaveLength(1);
      expect(tables.aiCostDailyRollups).toHaveLength(0);
    },
  );

  it("allows only a null-to-count research enrichment after success", () => {
    const succeeded = providerAttempt({
      lifecycleVersion: 1,
      operation: "trending_brief_research",
      source: "trending_brief",
      state: "succeeded",
      failureCategory: null,
      completedAt: 1_800_000_000_100,
      inputTokens: 200,
      cachedInputTokens: 20,
      cacheWriteInputTokens: 4,
      outputTokens: 10,
      webSearchCalls: null,
    });
    const enriched = {
      ...succeeded,
      lifecycleVersion: 2,
      webSearchCalls: 2,
    };

    expect(resolveProviderAttemptWrite(succeeded, enriched)).toBe("updated");
    expect(
      resolveProviderAttemptWrite(succeeded, {
        ...enriched,
        model: "gpt-5.6-luna-lookalike",
      }),
    ).toBe("stale");

    const before = getProviderAttemptRollupContribution(
      succeeded,
      estimateDirectAiCost(succeeded),
    );
    const after = getProviderAttemptRollupContribution(
      enriched,
      estimateDirectAiCost(enriched),
    );
    expect({
      providerAttempts:
        (after.providerAttempts ?? 0) - (before.providerAttempts ?? 0),
      webSearchCalls:
        (after.webSearchCalls ?? 0) - (before.webSearchCalls ?? 0),
      estimatedDirectAiCostMicros:
        (after.estimatedDirectAiCostMicros ?? 0) -
        (before.estimatedDirectAiCostMicros ?? 0),
      known:
        (after.estimatedCostKnownAttempts ?? 0) -
        (before.estimatedCostKnownAttempts ?? 0),
      unknown:
        (after.estimatedCostUnknownAttempts ?? 0) -
        (before.estimatedCostUnknownAttempts ?? 0),
    }).toEqual({
      providerAttempts: 0,
      webSearchCalls: 2,
      estimatedDirectAiCostMicros: 20_243,
      known: 1,
      unknown: -1,
    });
  });

  it("permits monotonic ambiguous finalization without moving identity", () => {
    const initial = providerAttempt();
    const observedNetworkFailure = providerAttempt({
      lifecycleVersion: 1,
      state: "unknown_after_dispatch",
      failureCategory: "network",
      completedAt: 1_800_000_000_100,
    });
    expect(resolveProviderAttemptWrite(initial, observedNetworkFailure)).toBe(
      "updated",
    );
    expect(
      resolveProviderAttemptWrite(initial, {
        ...observedNetworkFailure,
        correlationId: "different.correlation-0001",
      }),
    ).toBe("stale");
    expect(
      resolveProviderAttemptWrite(initial, {
        ...observedNetworkFailure,
        inputCharacters: 801,
      }),
    ).toBe("stale");
    expect(
      resolveProviderAttemptWrite(initial, {
        ...observedNetworkFailure,
        operation: "trending_brief_writing",
      }),
    ).toBe("stale");
  });

  it("keeps potentially billable and measurement-quality counts honest", () => {
    const beforeDispatch = providerAttempt({
      lifecycleVersion: 1,
      state: "failed_before_dispatch",
      failureCategory: "validation",
      dispatchedAt: null,
      completedAt: 1_800_000_000_000,
    });
    expect(
      getProviderAttemptRollupContribution(
        beforeDispatch,
        estimateDirectAiCost(beforeDispatch),
      ),
    ).toMatchObject({
      providerAttempts: 1,
      failedBeforeDispatchAttempts: 1,
      potentiallyBillableAttempts: 0,
      estimatedDirectAiCostMicros: 0,
      estimatedCostKnownAttempts: 1,
    });

    const ambiguous = providerAttempt({
      inputCharacters: 321,
      responseAudioBytes: 654,
    });
    expect(
      getProviderAttemptRollupContribution(
        ambiguous,
        estimateDirectAiCost(ambiguous),
      ),
    ).toMatchObject({
      ambiguousAfterDispatchAttempts: 1,
      potentiallyBillableAttempts: 1,
      inputCharacters: 321,
      providerResponseAudioBytes: 654,
      estimatedCostUnknownAttempts: 1,
    });
  });

  it("round-trips strict provider event storage without a nested event key", () => {
    const terminal = providerAttempt({
      lifecycleVersion: 1,
      state: "succeeded",
      failureCategory: null,
      completedAt: 1_800_000_000_100,
      inputTokens: 200,
      cachedInputTokens: 20,
      cacheWriteInputTokens: 4,
      outputTokens: 10,
      webSearchCalls: 0,
    });
    const estimate = estimateDirectAiCost(terminal);
    const stored = toProviderAttemptEvent(terminal, estimate);

    expect(stored).not.toHaveProperty("eventKey");
    expect(stored).toMatchObject({
      estimatedCostCurrency: "USD",
      estimatedCostEffectiveFrom: "2026-07-28",
      estimatedCostPricingVersion: "openai-2026-07-28-v1",
    });
    expect(
      getProviderAttemptFromEvent(
        stored as { kind: string } & Record<string, unknown>,
        terminal.eventKey,
      ),
    ).toEqual(terminal);
  });

  it("matures only overdue awaiting cohorts into no observed use", () => {
    const deadline = 1_800_000_000_000;
    expect(
      getGenerationMaturation(
        {
          kind: "generation_asset",
          generationUseState: "awaiting_observation",
          observationEndsAt: deadline,
        },
        deadline,
      ),
    ).toEqual({
      generationUseState: "no_observed_meaningful_use",
      rollupDelta: {
        generationAwaitingObservation: -1,
        generationNoObservedMeaningfulUse: 1,
      },
    });
    for (const generationUseState of [
      "observed_meaningful_use",
      "external_consumption_unknown",
      "no_observed_meaningful_use",
    ]) {
      expect(
        getGenerationMaturation(
          {
            kind: "generation_asset",
            generationUseState,
            observationEndsAt: deadline,
          },
          deadline,
        ),
      ).toBeNull();
    }
    expect(
      getGenerationMaturation(
        {
          kind: "generation_asset",
          generationUseState: "awaiting_observation",
          observationEndsAt: deadline,
        },
        deadline - 1,
      ),
    ).toBeNull();
  });

  it("removes article linkage when an observable generation cohort matures", async () => {
    const deadline = 1_800_000_000_000;
    const generation = {
      _id: "generation",
      eventKey: "asset.variant-current",
      eventDay: 1_797_408_000_000,
      event: {
        kind: "generation_asset",
        articleId: "article-1",
        sectionKey: "section-1",
        source: "interactive_article",
        provider: "openai",
        generatedAt: deadline - 30 * 24 * 60 * 60 * 1_000,
        observationEndsAt: deadline,
        generationUseState: "awaiting_observation",
      },
    };
    const sectionAudio = {
      _id: "section-audio",
      ledgerAssetKey: generation.eventKey,
    };
    const patches: Array<{
      id: unknown;
      value: Record<string, unknown>;
    }> = [];
    const inserts: Array<{
      table: string;
      value: Record<string, unknown>;
    }> = [];
    const range = {
      eq: () => range,
      gt: () => range,
      lte: () => range,
    };
    const ctx = {
      db: {
        query: (table: string) => ({
          withIndex: (
            _index: string,
            callback: (value: typeof range) => typeof range,
          ) => {
            callback(range);
            return {
              take: async () =>
                table === "aiCostLedgerEvents" ? [generation] : [],
              collect: async () =>
                table === "sectionAudio" ? [sectionAudio] : [],
              unique: async () => null,
            };
          },
        }),
        insert: async (table: string, value: Record<string, unknown>) => {
          inserts.push({ table, value });
          return `${table}-id`;
        },
        patch: async (id: unknown, value: Record<string, unknown>) => {
          patches.push({ id, value });
        },
      },
    };

    await expect(
      finalizeGenerationUseCohortsForCtx(ctx as never, { now: deadline }),
    ).resolves.toEqual({ processed: 1, finalized: 1, hasMore: false });
    expect(patches).toContainEqual({
      id: "section-audio",
      value: { ledgerAssetKey: undefined },
    });
    const generationPatch = patches.find(({ id }) => id === "generation");
    expect(generationPatch?.value).toMatchObject({ observationEndsAt: null });
    expect(generationPatch?.value.event).toMatchObject({
      generationUseState: "no_observed_meaningful_use",
    });
    expect(generationPatch?.value.event).not.toHaveProperty("articleId");
    expect(generationPatch?.value.event).not.toHaveProperty("sectionKey");
    expect(inserts).toContainEqual(
      expect.objectContaining({
        table: "aiCostDailyRollups",
        value: expect.objectContaining({
          generationAwaitingObservation: -1,
          generationNoObservedMeaningfulUse: 1,
        }),
      }),
    );
  });

  it("finalizes an overdue cohort before deleting its expired raw row", async () => {
    const now = 1_900_000_000_000;
    const generation = {
      _id: "expired-generation",
      eventKey: "asset.expired-current",
      eventDay: 1_797_408_000_000,
      event: {
        kind: "generation_asset",
        articleId: "article-1",
        sectionKey: "section-1",
        source: "interactive_article",
        provider: "openai",
        generatedAt: 1_797_408_000_000,
        observationEndsAt: 1_800_000_000_000,
        generationUseState: "awaiting_observation",
      },
    };
    const deleted: unknown[] = [];
    const inserts: Array<{
      table: string;
      value: Record<string, unknown>;
    }> = [];
    const range = {
      eq: () => range,
      gt: () => range,
      lte: () => range,
    };
    const ctx = {
      db: {
        query: (table: string) => ({
          withIndex: (
            _index: string,
            callback: (value: typeof range) => typeof range,
          ) => {
            callback(range);
            return {
              take: async () =>
                table === "aiCostLedgerEvents" ? [generation] : [],
              collect: async () => [],
              unique: async () => null,
            };
          },
        }),
        insert: async (table: string, value: Record<string, unknown>) => {
          inserts.push({ table, value });
          return `${table}-id`;
        },
        patch: async () => {},
        delete: async (id: unknown) => {
          deleted.push(id);
        },
      },
    };

    await expect(
      cleanupExpiredAiCostLedgerEventsForCtx(ctx as never, { now }),
    ).resolves.toEqual({ deleted: 1, hasMore: false });
    expect(deleted).toEqual(["expired-generation"]);
    expect(inserts).toContainEqual(
      expect.objectContaining({
        table: "aiCostDailyRollups",
        value: expect.objectContaining({
          generationAwaitingObservation: -1,
          generationNoObservedMeaningfulUse: 1,
        }),
      }),
    );
  });

  it("deletes raw rows in bounded batches without deleting tombstones", async () => {
    const rows = Array.from({ length: 501 }, (_, index) => ({
      _id: `event-${index}`,
      eventKey: `event.key-${index}`,
      eventDay: 0,
      event: { kind: "cache_decision" },
    }));
    const queriedTables: string[] = [];
    const deleted: unknown[] = [];
    const range = {
      eq: () => range,
      gt: () => range,
      lte: () => range,
    };
    const ctx = {
      db: {
        query: (table: string) => {
          queriedTables.push(table);
          return {
            withIndex: (
              _index: string,
              callback: (value: typeof range) => typeof range,
            ) => {
              callback(range);
              return {
                take: async (limit: number) => rows.slice(0, limit),
              };
            },
          };
        },
        delete: async (id: unknown) => {
          deleted.push(id);
        },
      },
    };

    await expect(
      cleanupExpiredAiCostLedgerEventsForCtx(ctx as never, {
        now: 1_800_000_000_000,
      }),
    ).resolves.toEqual({ deleted: 500, hasMore: true });
    expect(deleted).toHaveLength(500);
    expect(queriedTables).toEqual(["aiCostLedgerEvents"]);
  });

  it("keeps durable delivery keys idempotent after raw cleanup", async () => {
    const previousMode = process.env.AI_COST_LEDGER_MODE;
    process.env.AI_COST_LEDGER_MODE = "observe";
    let inserts = 0;
    const range = {
      eq: () => range,
      gt: () => range,
      lte: () => range,
    };
    const ctx = {
      db: {
        query: (table: string) => ({
          withIndex: (
            _index: string,
            callback: (value: typeof range) => typeof range,
          ) => {
            callback(range);
            return {
              unique: async () =>
                table === "aiCostLedgerDeliveries"
                  ? { _id: "delivery", eventKey: "cache.event-0001" }
                  : null,
            };
          },
        }),
        insert: async () => {
          inserts += 1;
        },
      },
    };
    try {
      await expect(
        recordCacheDecisionForCtx(ctx as never, {
          eventKey: "cache.event-0001",
          source: "interactive_article",
          provider: "openai",
          operation: "tts",
          requests: 1,
          hits: 1,
          misses: 0,
          reusedAssetServes: 1,
          avoidedGeneration: 1,
          uniqueGeneratedAssets: 0,
          concurrentGenerationRaces: 0,
          cacheWriteFailures: 0,
          idempotentRetryWrites: 0,
          bytes: 100,
          seconds: 1,
        }),
      ).resolves.toEqual({ created: false, disposition: "duplicate" });
      expect(inserts).toBe(0);
    } finally {
      if (previousMode === undefined) delete process.env.AI_COST_LEDGER_MODE;
      else process.env.AI_COST_LEDGER_MODE = previousMode;
    }
  });
});
