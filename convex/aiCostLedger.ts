import { v } from "convex/values";
import type { FunctionReference } from "convex/server";
import { action, internalMutation, internalQuery } from "./_generated/server";
import { internal } from "./_generated/api";
import {
  aiCostDurationMeasurementValidator,
  aiCostOperationValidator,
  aiCostProviderValidator,
  aiCostSourceValidator,
  aiCostProviderAttemptValidator,
  aiCostServerAttestationValidator,
  getAiCostLedgerMode,
  parseAiCostDay,
  parseAiCostStatementInput,
  verifyAiCostProviderAttemptAttestation,
  type AiCostProviderAttempt,
  type AiCostStatementInput,
} from "../lib/ai-cost-ledger-contract";
import {
  aiCostCoverageEpochResetValidator,
  aiCostOwnerAttestationValidator,
  aiCostStatementInputValidator,
  assertValidAiCostReportRange,
  getAiCostStatementAttestationPayload,
  verifyAiCostReportAttestation,
  verifyAiCostCoverageResetAttestation,
  verifyAiCostStatementAttestation,
  type AiCostCoverageEpochReset,
} from "../lib/ai-cost-owner-attestation";
import {
  buildAiCostReport,
  type AiCostDailyRollupInput,
  type AiCostStatementRecord,
} from "../lib/ai-cost-report";
import {
  recordCacheDecisionForCtx,
  recordGenerationAssetForCtx,
  recordListeningContributionForCtx,
  recordPipelineOutcomeForCtx,
  recordProviderAttemptForCtx,
  readAiCostLedgerCoverageStartedAtForCtx,
  resetAiCostLedgerCoverageForCtx,
  cleanupExpiredAiCostLedgerEventsForCtx,
  finalizeGenerationUseCohortsForCtx,
  type ProviderAttemptWriteDisposition,
} from "./lib/aiCostLedger";

type ProviderAttemptMutationResult = {
  recorded: boolean;
  disposition: ProviderAttemptWriteDisposition;
};

type CostStatementMutationResult = {
  recorded: boolean;
  disposition: "inserted" | "updated" | "duplicate" | "disabled";
};

type CostReportData = {
  rollups: AiCostDailyRollupInput[];
  statements: AiCostStatementRecord[];
  coverageStartedAt: number | null;
};

type CoverageResetMutationResult = {
  reset: boolean;
  disposition: "inserted" | "updated" | "duplicate";
  epochVersion: number;
};

const aiCostLedgerInternal = internal as unknown as {
  aiCostLedger: {
    recordProviderAttemptInternal: FunctionReference<
      "mutation",
      "internal",
      { attempt: AiCostProviderAttempt },
      ProviderAttemptMutationResult
    >;
    readCostReportDataInternal: FunctionReference<
      "query",
      "internal",
      { from: number; to: number },
      CostReportData
    >;
    upsertCostStatementInternal: FunctionReference<
      "mutation",
      "internal",
      { statement: AiCostStatementInput },
      CostStatementMutationResult
    >;
    maintainAiCostLedgerInternal: FunctionReference<
      "mutation",
      "internal",
      Record<string, never>,
      {
        finalized: number;
        deleted: number;
        continuationScheduled: boolean;
      }
    >;
    resetCoverageEpochInternal: FunctionReference<
      "mutation",
      "internal",
      { reset: AiCostCoverageEpochReset },
      CoverageResetMutationResult
    >;
  };
};

type CostIndexRange = {
  eq(field: string, value: unknown): CostIndexRange;
  gte(field: string, value: unknown): CostIndexRange;
  lt(field: string, value: unknown): CostIndexRange;
};

type CostDbRow = Record<string, unknown> & { _id: unknown };

type CostDb = {
  query(table: string): {
    withIndex(
      index: string,
      callback: (range: CostIndexRange) => CostIndexRange,
    ): {
      unique(): Promise<CostDbRow | null>;
      collect(): Promise<CostDbRow[]>;
    };
  };
  insert(table: string, value: Record<string, unknown>): Promise<unknown>;
  patch(id: unknown, value: Record<string, unknown>): Promise<void>;
};

const getCostDb = (ctx: { db: unknown }): CostDb => ctx.db as CostDb;

const getStatementFields = (
  value: AiCostStatementInput,
): AiCostStatementInput => ({
  statementKey: value.statementKey,
  provider: value.provider,
  serviceScope: value.serviceScope,
  periodStartDay: value.periodStartDay,
  periodEndDay: value.periodEndDay,
  amountMicros: value.amountMicros,
  currency: value.currency,
  source: value.source,
  allocationMethod: value.allocationMethod,
});

export const getCostStatementDisposition = (
  existing: AiCostStatementInput | null,
  incoming: AiCostStatementInput,
): "inserted" | "updated" | "duplicate" => {
  if (!existing) return "inserted";
  return JSON.stringify(getAiCostStatementAttestationPayload(existing)) ===
    JSON.stringify(getAiCostStatementAttestationPayload(incoming))
    ? "duplicate"
    : "updated";
};

export const recordProviderAttemptInternal = internalMutation({
  args: { attempt: aiCostProviderAttemptValidator },
  handler: async (ctx, { attempt }) =>
    await recordProviderAttemptForCtx(ctx, attempt),
});

export const recordProviderAttempt = action({
  args: {
    attempt: aiCostProviderAttemptValidator,
    attestation: aiCostServerAttestationValidator,
  },
  handler: async (ctx, { attempt, attestation }) => {
    if (
      !(await verifyAiCostProviderAttemptAttestation({
        attempt,
        attestation,
      }))
    ) {
      throw new Error(
        "A valid server attestation is required to record provider cost.",
      );
    }
    if (getAiCostLedgerMode() !== "observe") {
      return {
        recorded: false,
        disposition: "disabled" as const,
      };
    }
    return await ctx.runMutation(
      aiCostLedgerInternal.aiCostLedger.recordProviderAttemptInternal,
      { attempt },
    );
  },
});

export const readCostReportDataInternal = internalQuery({
  args: { from: v.number(), to: v.number() },
  handler: async (ctx, { from, to }): Promise<CostReportData> => {
    const db = getCostDb(ctx);
    const rollups = await db
      .query("aiCostDailyRollups")
      .withIndex("by_bucketStart", (query) =>
        query.gte("bucketStart", from).lt("bucketStart", to),
      )
      .collect();
    const possibleStatements = await db
      .query("aiCostStatements")
      .withIndex("by_periodStart", (query) => query.lt("periodStart", to))
      .collect();
    const statements = possibleStatements.filter(
      (statement) =>
        typeof statement.periodEnd === "number" && statement.periodEnd > from,
    );
    const coverageStartedAt =
      await readAiCostLedgerCoverageStartedAtForCtx(ctx);
    return {
      rollups: rollups as unknown as AiCostDailyRollupInput[],
      statements: statements as unknown as AiCostStatementRecord[],
      coverageStartedAt,
    };
  },
});

export const readCostReport = action({
  args: {
    fromDay: v.string(),
    toDay: v.string(),
    attestation: aiCostOwnerAttestationValidator,
  },
  handler: async (ctx, { fromDay, toDay, attestation }) => {
    const range = { fromDay, toDay };
    const { from, to } = assertValidAiCostReportRange(range);
    if (!(await verifyAiCostReportAttestation({ range, attestation }))) {
      throw new Error(
        "A valid owner attestation is required to read the AI cost report.",
      );
    }
    const data = await ctx.runQuery(
      aiCostLedgerInternal.aiCostLedger.readCostReportDataInternal,
      { from, to },
    );
    return buildAiCostReport({ fromDay, toDay, ...data });
  },
});

export const upsertCostStatementInternal = internalMutation({
  args: { statement: aiCostStatementInputValidator },
  handler: async (ctx, { statement }): Promise<CostStatementMutationResult> => {
    if (getAiCostLedgerMode() !== "observe") {
      return { recorded: false, disposition: "disabled" };
    }
    const parsedStatement = parseAiCostStatementInput(statement);
    const db = getCostDb(ctx);
    const existing = await db
      .query("aiCostStatements")
      .withIndex("by_statementKey", (query) =>
        query.eq("statementKey", parsedStatement.statementKey),
      )
      .unique();
    const existingInput = existing
      ? getStatementFields(existing as unknown as AiCostStatementInput)
      : null;
    const disposition = getCostStatementDisposition(
      existingInput,
      parsedStatement,
    );
    if (disposition === "duplicate") {
      return { recorded: false, disposition };
    }
    const periodStart = parseAiCostDay(
      parsedStatement.periodStartDay,
      "periodStartDay",
    );
    const periodEnd = parseAiCostDay(
      parsedStatement.periodEndDay,
      "periodEndDay",
    );
    const now = Date.now();
    if (!existing) {
      await db.insert("aiCostStatements", {
        ...parsedStatement,
        periodStart,
        periodEnd,
        createdAt: now,
        updatedAt: now,
      });
    } else {
      await db.patch(existing._id, {
        ...parsedStatement,
        periodStart,
        periodEnd,
        updatedAt: now,
      });
    }
    return { recorded: true, disposition };
  },
});

export const upsertCostStatement = action({
  args: {
    statement: aiCostStatementInputValidator,
    attestation: aiCostOwnerAttestationValidator,
  },
  handler: async (ctx, { statement, attestation }) => {
    if (!(await verifyAiCostStatementAttestation({ statement, attestation }))) {
      throw new Error(
        "A valid owner attestation is required to upsert a cost statement.",
      );
    }
    if (getAiCostLedgerMode() !== "observe") {
      return { recorded: false, disposition: "disabled" as const };
    }
    return await ctx.runMutation(
      aiCostLedgerInternal.aiCostLedger.upsertCostStatementInternal,
      { statement },
    );
  },
});

export const resetCoverageEpochInternal = internalMutation({
  args: { reset: aiCostCoverageEpochResetValidator },
  handler: async (ctx, { reset }): Promise<CoverageResetMutationResult> =>
    await resetAiCostLedgerCoverageForCtx(ctx, {
      epochKey: reset.epochKey,
    }),
});

export const resetCoverageEpoch = action({
  args: {
    reset: aiCostCoverageEpochResetValidator,
    attestation: aiCostOwnerAttestationValidator,
  },
  handler: async (ctx, { reset, attestation }) => {
    if (!(await verifyAiCostCoverageResetAttestation({ reset, attestation }))) {
      throw new Error(
        "A valid owner attestation is required to reset AI cost coverage.",
      );
    }
    return await ctx.runMutation(
      aiCostLedgerInternal.aiCostLedger.resetCoverageEpochInternal,
      { reset },
    );
  },
});

export const recordCacheDecisionInternal = internalMutation({
  args: {
    eventKey: v.string(),
    source: aiCostSourceValidator,
    provider: aiCostProviderValidator,
    operation: aiCostOperationValidator,
    requests: v.number(),
    hits: v.number(),
    misses: v.number(),
    reusedAssetServes: v.number(),
    avoidedGeneration: v.number(),
    uniqueGeneratedAssets: v.number(),
    concurrentGenerationRaces: v.number(),
    cacheWriteFailures: v.number(),
    idempotentRetryWrites: v.number(),
    bytes: v.number(),
    seconds: v.number(),
    recordedAt: v.optional(v.number()),
  },
  handler: async (ctx, args) => await recordCacheDecisionForCtx(ctx, args),
});

export const recordGenerationAssetInternal = internalMutation({
  args: {
    eventKey: v.string(),
    articleId: v.optional(v.id("articles")),
    sectionKey: v.optional(v.string()),
    source: aiCostSourceValidator,
    provider: aiCostProviderValidator,
    model: v.union(v.string(), v.null()),
    byteLength: v.number(),
    durationMs: v.number(),
    durationMeasurement: aiCostDurationMeasurementValidator,
    externalConsumptionUnknown: v.boolean(),
    generatedAt: v.number(),
  },
  handler: async (ctx, args) => await recordGenerationAssetForCtx(ctx, args),
});

export const recordListeningContributionInternal = internalMutation({
  args: {
    eventKey: v.string(),
    articleId: v.id("articles"),
    sectionKeys: v.array(v.string()),
    newUniqueSeconds: v.number(),
    meaningfulUse: v.boolean(),
    progressStartedAt: v.number(),
    observedAt: v.number(),
  },
  handler: async (ctx, args) =>
    await recordListeningContributionForCtx(ctx, args),
});

export const recordPipelineOutcomeInternal = internalMutation({
  args: {
    eventKey: v.string(),
    source: aiCostSourceValidator,
    provider: v.union(aiCostProviderValidator, v.null()),
    operation: v.union(aiCostOperationValidator, v.null()),
    generatedSections: v.number(),
    reusedSections: v.number(),
    recordedAt: v.optional(v.number()),
  },
  handler: async (ctx, args) => await recordPipelineOutcomeForCtx(ctx, args),
});

export const maintainAiCostLedgerInternal = internalMutation({
  args: {},
  handler: async (ctx) => {
    const cohorts = await finalizeGenerationUseCohortsForCtx(ctx);
    const cleanup = await cleanupExpiredAiCostLedgerEventsForCtx(ctx);
    const continuationScheduled = cohorts.hasMore || cleanup.hasMore;
    if (continuationScheduled) {
      await ctx.scheduler.runAfter(
        0,
        aiCostLedgerInternal.aiCostLedger.maintainAiCostLedgerInternal,
        {},
      );
    }
    return {
      finalized: cohorts.finalized,
      deleted: cleanup.deleted,
      continuationScheduled,
    };
  },
});
