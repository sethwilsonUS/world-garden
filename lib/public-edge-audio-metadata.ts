import {
  getTtsMetadata,
  getTtsProfile,
} from "./tts-profile";

export type PublicEdgeAudioMetadata = {
  provider?: string;
  model?: string;
  voiceId?: string;
  promptVersion?: string;
  ttsNormVersion?: string;
  ttsCacheKey?: string;
};

export const hasPublicAudioMetadata = (
  metadata: PublicEdgeAudioMetadata,
): boolean =>
  metadata.provider != null ||
  metadata.model != null ||
  metadata.voiceId != null ||
  metadata.promptVersion != null ||
  metadata.ttsNormVersion != null ||
  metadata.ttsCacheKey != null;

export const isExactCurrentEdgeAudioMetadata = (
  metadata: PublicEdgeAudioMetadata | null | undefined,
  expectedCacheKey = getTtsProfile("edge").ttsCacheKey,
): boolean => {
  const expected = {
    ...getTtsMetadata(getTtsProfile("edge")),
    ttsCacheKey: expectedCacheKey,
  };
  return (
    metadata?.provider === expected.provider &&
    metadata.model === expected.model &&
    metadata.voiceId === expected.voiceId &&
    metadata.promptVersion === expected.promptVersion &&
    metadata.ttsNormVersion === expected.ttsNormVersion &&
    metadata.ttsCacheKey === expected.ttsCacheKey
  );
};

export const assertExactCurrentEdgeAudioMetadata = (
  metadata: PublicEdgeAudioMetadata,
  expectedCacheKey?: string,
): void => {
  if (isExactCurrentEdgeAudioMetadata(metadata, expectedCacheKey)) return;
  throw new Error("Public audio must use the current Edge TTS profile.");
};
