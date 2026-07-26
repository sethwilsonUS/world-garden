import { getTtsProfile } from "./tts-profile";

export const TRENDING_AUDIO_SCRIPT_VERSION = "ai-disclosure-v1";

export const getTrendingAudioCacheKey = (): string =>
  `${getTtsProfile("edge").ttsCacheKey}:trending-script:${TRENDING_AUDIO_SCRIPT_VERSION}`;
