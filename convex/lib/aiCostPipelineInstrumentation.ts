import type { ActionCtx, MutationCtx } from "../_generated/server";
import { anyApi } from "convex/server";
import { getAiCostLedgerMode } from "../../lib/ai-cost-ledger-contract";
import { deriveOpaqueAiCostEventKey } from "../../lib/ai-cost-event-key";
import type {
  AiCostCacheDecisionInput,
  AiCostGenerationAssetInput,
  AiCostListeningContributionInput,
  AiCostPipelineOutcomeInput,
} from "./aiCostLedger";
import type { FunctionReferenceFromExport } from "./functionReferenceFromExport";

const recordPipelineOutcomeInternal: FunctionReferenceFromExport<
  typeof import("../aiCostLedger").recordPipelineOutcomeInternal
> = anyApi.aiCostLedger.recordPipelineOutcomeInternal;
const recordCacheDecisionInternal: FunctionReferenceFromExport<
  typeof import("../aiCostLedger").recordCacheDecisionInternal
> = anyApi.aiCostLedger.recordCacheDecisionInternal;
const recordGenerationAssetInternal: FunctionReferenceFromExport<
  typeof import("../aiCostLedger").recordGenerationAssetInternal
> = anyApi.aiCostLedger.recordGenerationAssetInternal;
const recordListeningContributionInternal: FunctionReferenceFromExport<
  typeof import("../aiCostLedger").recordListeningContributionInternal
> = anyApi.aiCostLedger.recordListeningContributionInternal;

type LedgerSchedulerCtx = Pick<MutationCtx, "scheduler">;

const scheduleLedgerMutationBestEffort = async (
  schedule: () => Promise<unknown>,
  warning: string,
): Promise<boolean> => {
  if (getAiCostLedgerMode() !== "observe") return false;
  try {
    await schedule();
    return true;
  } catch {
    console.warn(warning);
    return false;
  }
};

export const scheduleCacheDecisionBestEffort = async (
  ctx: LedgerSchedulerCtx,
  input: AiCostCacheDecisionInput,
): Promise<boolean> =>
  await scheduleLedgerMutationBestEffort(
    async () => await ctx.scheduler.runAfter(0, recordCacheDecisionInternal, input),
    "[ai-cost-ledger] Audio cache event was not scheduled.",
  );

export const scheduleGenerationAssetBestEffort = async (
  ctx: LedgerSchedulerCtx,
  input: AiCostGenerationAssetInput,
): Promise<boolean> =>
  await scheduleLedgerMutationBestEffort(
    async () =>
      await ctx.scheduler.runAfter(0, recordGenerationAssetInternal, input),
    "[ai-cost-ledger] Audio generation event was not scheduled.",
  );

export const scheduleListeningContributionBestEffort = async (
  ctx: LedgerSchedulerCtx,
  input: AiCostListeningContributionInput,
): Promise<boolean> =>
  await scheduleLedgerMutationBestEffort(
    async () =>
      await ctx.scheduler.runAfter(0, recordListeningContributionInternal, input),
    "[ai-cost-ledger] Listening contribution was not scheduled.",
  );

export const recordPipelineOutcomeBestEffort = async (
  ctx: Pick<ActionCtx, "runMutation">,
  input: AiCostPipelineOutcomeInput,
): Promise<void> => {
  if (getAiCostLedgerMode() !== "observe") return;
  try {
    await ctx.runMutation(recordPipelineOutcomeInternal, input);
  } catch {
    console.warn("[ai-cost-ledger] Audio pipeline outcome was not recorded.");
  }
};

export const recordOpaquePipelineOutcomeBestEffort = async (
  ctx: Pick<ActionCtx, "runMutation">,
  identity: { namespace: string; identityParts: readonly string[] },
  input: Omit<AiCostPipelineOutcomeInput, "eventKey">,
): Promise<void> => {
  if (getAiCostLedgerMode() !== "observe") return;
  try {
    const eventKey = await deriveOpaqueAiCostEventKey(identity);
    await recordPipelineOutcomeBestEffort(ctx, { ...input, eventKey });
  } catch {
    console.warn("[ai-cost-ledger] Audio pipeline outcome was not recorded.");
  }
};

export const recordCacheWriteFailureBestEffort = async (
  ctx: Pick<ActionCtx, "runMutation">,
  input: Pick<AiCostCacheDecisionInput, "eventKey" | "source" | "provider">,
): Promise<void> => {
  if (getAiCostLedgerMode() !== "observe") return;
  try {
    await ctx.runMutation(recordCacheDecisionInternal, {
      ...input,
      operation: "tts",
      requests: 0,
      hits: 0,
      misses: 0,
      reusedAssetServes: 0,
      avoidedGeneration: 0,
      uniqueGeneratedAssets: 0,
      concurrentGenerationRaces: 0,
      cacheWriteFailures: 1,
      idempotentRetryWrites: 0,
      bytes: 0,
      seconds: 0,
      recordedAt: Date.now(),
    });
  } catch {
    console.warn("[ai-cost-ledger] Audio cache failure was not recorded.");
  }
};
