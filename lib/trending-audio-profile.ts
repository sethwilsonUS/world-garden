import { TTS_NORM_VERSION } from "./tts-normalize";
import {
  buildTtsCacheKey,
  DEFAULT_OPENAI_TTS_INSTRUCTIONS,
  DEFAULT_OPENAI_TTS_PROMPT_VERSION,
  getTtsMetadata,
  type TtsMetadata,
  type TtsProfile,
} from "./tts-profile";

export const TRENDING_AUDIO_SCRIPT_VERSION = "ai-disclosure-v1";
export const TRENDING_TTS_MODEL = "gpt-4o-mini-tts";
export const TRENDING_TTS_VOICE = "marin";

export type TrendingAudioMetadata = {
  provider?: string;
  model?: string;
  voiceId?: string;
  promptVersion?: string;
  ttsNormVersion?: string;
  ttsCacheKey?: string;
};

/**
 * Trending narration is a deliberately pinned public-podcast exception to the
 * audience-level TTS defaults. Environment overrides for interactive speech
 * must not silently change its publication identity.
 */
export const getTrendingTtsProfile = (): TtsProfile => {
  const profile = {
    provider: "openai" as const,
    model: TRENDING_TTS_MODEL,
    voiceId: TRENDING_TTS_VOICE,
    promptVersion: DEFAULT_OPENAI_TTS_PROMPT_VERSION,
    instructions: DEFAULT_OPENAI_TTS_INSTRUCTIONS,
    ttsNormVersion: TTS_NORM_VERSION,
  };

  return {
    ...profile,
    ttsCacheKey: buildTtsCacheKey(profile),
  };
};

export const getTrendingAudioCacheKey = (): string =>
  `${getTrendingTtsProfile().ttsCacheKey}:trending-script:${TRENDING_AUDIO_SCRIPT_VERSION}`;

/** Metadata returned by the generic TTS route before episode qualification. */
export const getTrendingTtsMetadata = (): TtsMetadata =>
  getTtsMetadata(getTrendingTtsProfile());

export const isExactCurrentTrendingAudioMetadata = (
  metadata: TrendingAudioMetadata | null | undefined,
  expectedCacheKey = getTrendingTtsProfile().ttsCacheKey,
): metadata is TtsMetadata => {
  const expected = {
    ...getTrendingTtsMetadata(),
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

export const assertExactCurrentTrendingAudioMetadata: (
  metadata: TrendingAudioMetadata,
  expectedCacheKey?: string,
) => asserts metadata is TtsMetadata = (metadata, expectedCacheKey) => {
  if (isExactCurrentTrendingAudioMetadata(metadata, expectedCacheKey)) return;
  throw new Error(
    "Trending audio must use the current Trending OpenAI TTS profile.",
  );
};
