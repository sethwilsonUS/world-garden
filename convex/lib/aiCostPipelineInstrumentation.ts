import { internal } from "../_generated/api";
import type { ActionCtx, MutationCtx } from "../_generated/server";
import type { FunctionReference } from "convex/server";
import { getAiCostLedgerMode } from "../../lib/ai-cost-ledger-contract";
import { deriveOpaqueAiCostEventKey } from "../../lib/ai-cost-event-key";
import type {
  AiCostCacheDecisionInput,
  AiCostGenerationAssetInput,
  AiCostListeningContributionInput,
  AiCostPipelineOutcomeInput,
} from "./aiCostLedger";

const recordPipelineOutcomeInternal = (
  internal as unknown as {
    aiCostLedger: {
      recordPipelineOutcomeInternal: FunctionReference<"mutation">;
      recordCacheDecisionInternal: FunctionReference<"mutation">;
    };
  }
).aiCostLedger.recordPipelineOutcomeInternal;
const recordCacheDecisionInternal = (
  internal as unknown as {
    aiCostLedger: {
      recordCacheDecisionInternal: FunctionReference<"mutation">;
    };
  }
).aiCostLedger.recordCacheDecisionInternal;
const recordGenerationAssetInternal = (
  internal as unknown as {
    aiCostLedger: {
      recordGenerationAssetInternal: FunctionReference<"mutation">;
    };
  }
).aiCostLedger.recordGenerationAssetInternal;
const recordListeningContributionInternal = (
  internal as unknown as {
    aiCostLedger: {
      recordListeningContributionInternal: FunctionReference<"mutation">;
    };
  }
).aiCostLedger.recordListeningContributionInternal;

type LedgerSchedulerCtx = Pick<MutationCtx, "scheduler">;

const scheduleLedgerMutationBestEffort = async (
  ctx: LedgerSchedulerCtx,
  mutation: FunctionReference<"mutation">,
  input: Record<string, unknown>,
  warning: string,
): Promise<boolean> => {
  if (getAiCostLedgerMode() !== "observe") return false;
  try {
    await ctx.scheduler.runAfter(0, mutation, input);
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
    ctx,
    recordCacheDecisionInternal,
    input,
    "[ai-cost-ledger] Audio cache event was not scheduled.",
  );

export const scheduleGenerationAssetBestEffort = async (
  ctx: LedgerSchedulerCtx,
  input: AiCostGenerationAssetInput,
): Promise<boolean> =>
  await scheduleLedgerMutationBestEffort(
    ctx,
    recordGenerationAssetInternal,
    input,
    "[ai-cost-ledger] Audio generation event was not scheduled.",
  );

export const scheduleListeningContributionBestEffort = async (
  ctx: LedgerSchedulerCtx,
  input: AiCostListeningContributionInput,
): Promise<boolean> =>
  await scheduleLedgerMutationBestEffort(
    ctx,
    recordListeningContributionInternal,
    input,
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
