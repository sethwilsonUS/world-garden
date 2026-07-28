import type { ServerAttestationPayloadValue } from "./server-attestation";
import type { AiCostProvider, AiCostSource } from "./ai-cost-ledger-contract";

export const AUDIO_CACHE_READ_ATTESTATION_SCOPE = "audio-cache:read";
export const AUDIO_CACHE_READ_RESULT_ATTESTATION_SCOPE =
  "audio-cache:read-result";
export const AUDIO_CACHE_UPLOAD_ATTESTATION_SCOPE = "audio-cache:upload";
export const AUDIO_CACHE_WRITE_FAILURE_ATTESTATION_SCOPE =
  "audio-cache:write-failure";
export const AUDIO_CACHE_SAVE_ATTESTATION_SCOPE = "audio-cache:save";

export type AudioCacheReadAttestationPayload = {
  articleId: string;
  ttsNormVersion: string;
  ttsCacheKey: string;
  sourceHashes: Array<{ sectionKey: string; sourceHash: string }>;
  ledgerSource?: AiCostSource;
};

export type AudioCacheReadResultAttestationPayload = {
  source: AiCostSource;
  provider: AiCostProvider;
  hit: boolean;
  byteLength: number;
  durationSeconds: number;
};

export type AudioCacheSaveAttestationPayload = {
  articleId: string;
  sectionKey: string;
  sourceHash: string;
  storageId: string;
  ttsNormVersion: string;
  ttsCacheKey: string;
  provider?: string;
  model?: string;
  voiceId?: string;
  promptVersion?: string;
  durationSeconds?: number;
  byteLength?: number;
  ledgerAssetKey?: string;
  expectedExistingLedgerAssetKey?: string;
  ledgerSource?: AiCostSource;
};

export type AudioCacheWriteFailureAttestationPayload = {
  ledgerAssetKey: string;
  source: AiCostSource;
  provider: AiCostProvider;
};

export const buildAudioCacheUploadAttestationPayload =
  (): readonly ServerAttestationPayloadValue[] => ["sectionAudio"];

export const buildAudioCacheWriteFailureAttestationPayload = (
  args: AudioCacheWriteFailureAttestationPayload,
): readonly ServerAttestationPayloadValue[] => [
  args.ledgerAssetKey,
  args.source,
  args.provider,
];

export const buildAudioCacheReadAttestationPayload = (
  args: AudioCacheReadAttestationPayload,
): readonly ServerAttestationPayloadValue[] => [
  args.articleId,
  args.ttsNormVersion,
  args.ttsCacheKey,
  args.ledgerSource ?? null,
  args.sourceHashes.length,
  ...args.sourceHashes.flatMap(({ sectionKey, sourceHash }) => [
    sectionKey,
    sourceHash,
  ]),
];

export const buildAudioCacheReadResultAttestationPayload = (
  args: AudioCacheReadResultAttestationPayload,
): readonly ServerAttestationPayloadValue[] => [
  args.source,
  args.provider,
  args.hit,
  args.byteLength,
  args.durationSeconds,
];

export const buildAudioCacheSaveAttestationPayload = (
  args: AudioCacheSaveAttestationPayload,
): readonly ServerAttestationPayloadValue[] => [
  args.articleId,
  args.sectionKey,
  args.sourceHash,
  args.storageId,
  args.ttsNormVersion,
  args.ttsCacheKey,
  args.provider ?? null,
  args.model ?? null,
  args.voiceId ?? null,
  args.promptVersion ?? null,
  args.durationSeconds ?? null,
  args.byteLength ?? null,
  args.ledgerAssetKey ?? null,
  args.expectedExistingLedgerAssetKey ?? null,
  args.ledgerSource ?? null,
];
