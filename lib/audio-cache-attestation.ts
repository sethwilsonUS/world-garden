import type { ServerAttestationPayloadValue } from "./server-attestation";

export const AUDIO_CACHE_READ_ATTESTATION_SCOPE = "audio-cache:read";
export const AUDIO_CACHE_UPLOAD_ATTESTATION_SCOPE = "audio-cache:upload";
export const AUDIO_CACHE_SAVE_ATTESTATION_SCOPE = "audio-cache:save";

export type AudioCacheReadAttestationPayload = {
  articleId: string;
  ttsNormVersion: string;
  ttsCacheKey: string;
  sourceHashes: Array<{ sectionKey: string; sourceHash: string }>;
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
};

export const buildAudioCacheUploadAttestationPayload =
  (): readonly ServerAttestationPayloadValue[] => ["sectionAudio"];

export const buildAudioCacheReadAttestationPayload = (
  args: AudioCacheReadAttestationPayload,
): readonly ServerAttestationPayloadValue[] => [
  args.articleId,
  args.ttsNormVersion,
  args.ttsCacheKey,
  args.sourceHashes.length,
  ...args.sourceHashes.flatMap(({ sectionKey, sourceHash }) => [
    sectionKey,
    sourceHash,
  ]),
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
];
