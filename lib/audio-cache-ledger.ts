import { anyApi } from "convex/server";
import { fetchMutation } from "convex/nextjs";
import {
  getAiCostLedgerMode,
  type AiCostProvider,
  type AiCostSource,
} from "./ai-cost-ledger-contract";
export { createAudioCacheLedgerAssetKey } from "./audio-cache-ledger-key";
import { createAudioCacheWriteFailureAttestation } from "./tts-quota-bypass";
import { createAudioCacheReadResultAttestation } from "./tts-quota-bypass";
import { fetchConvexMutationWithTimeout } from "./convex-request-timeout";

export type AudioCacheReadResultInput = {
  source: AiCostSource;
  provider: AiCostProvider;
  hit: boolean;
  byteLength: number;
  durationSeconds: number;
};

export const recordAudioCacheReadResultBestEffort = async (
  input: AudioCacheReadResultInput,
  signal?: AbortSignal,
): Promise<void> => {
  if (getAiCostLedgerMode() !== "observe") return;
  try {
    const attestation = await createAudioCacheReadResultAttestation(input);
    const args = {
      ...input,
      attestation,
    };
    if (signal) {
      await fetchConvexMutationWithTimeout(
        anyApi.audio.recordSectionAudioCacheReadResult,
        args,
        {
          signal,
          timeoutMs: 0,
          message: "Audio cache read recording timed out",
        },
      );
    } else {
      await fetchMutation(anyApi.audio.recordSectionAudioCacheReadResult, args);
    }
  } catch {
    console.warn("[ai-cost-ledger] Audio cache read result was not recorded.");
  }
};

export type AudioCacheWriteFailureInput = {
  ledgerAssetKey: string;
  source: AiCostSource;
  provider: AiCostProvider;
};

export const recordAudioCacheWriteFailureBestEffort = async (
  input: AudioCacheWriteFailureInput,
  signal?: AbortSignal,
): Promise<void> => {
  if (getAiCostLedgerMode() !== "observe") return;
  try {
    const attestation = await createAudioCacheWriteFailureAttestation(input);
    const args = {
      ...input,
      attestation,
    };
    if (signal) {
      await fetchConvexMutationWithTimeout(
        anyApi.audio.recordSectionAudioCacheWriteFailure,
        args,
        {
          signal,
          timeoutMs: 0,
          message: "Audio cache failure recording timed out",
        },
      );
    } else {
      await fetchMutation(
        anyApi.audio.recordSectionAudioCacheWriteFailure,
        args,
      );
    }
  } catch {
    console.warn("[ai-cost-ledger] Audio cache failure was not recorded.");
  }
};
