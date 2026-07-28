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

export type AudioCacheReadResultInput = {
  source: AiCostSource;
  provider: AiCostProvider;
  hit: boolean;
  byteLength: number;
  durationSeconds: number;
};

export const recordAudioCacheReadResultBestEffort = async (
  input: AudioCacheReadResultInput,
): Promise<void> => {
  if (getAiCostLedgerMode() !== "observe") return;
  try {
    const attestation = await createAudioCacheReadResultAttestation(input);
    await fetchMutation(anyApi.audio.recordSectionAudioCacheReadResult, {
      ...input,
      attestation,
    });
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
): Promise<void> => {
  if (getAiCostLedgerMode() !== "observe") return;
  try {
    const attestation = await createAudioCacheWriteFailureAttestation(input);
    await fetchMutation(anyApi.audio.recordSectionAudioCacheWriteFailure, {
      ...input,
      attestation,
    });
  } catch {
    console.warn("[ai-cost-ledger] Audio cache failure was not recorded.");
  }
};
