export const TTS_API_ROUTE = "/api/tts";
export const TTS_MIN_TEXT_LENGTH = 10;
export const DEFAULT_TTS_MAX_WORDS_PER_REQUEST = 800;

// This is the current backend default. Treat it as contract metadata rather
// than a frontend engine choice.
export const CURRENT_TTS_DEFAULT_VOICE = "en-US-AriaNeural";

export type TtsRequest = {
  text: string;
  voiceId?: string;
};

const parsePositiveInt = (value: string | undefined): number | null => {
  if (!value) return null;
  const parsed = Number.parseInt(value, 10);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : null;
};

export const getClientTtsMaxWordsPerRequest = (): number =>
  parsePositiveInt(process.env.NEXT_PUBLIC_TTS_MAX_WORDS_PER_REQUEST) ??
  DEFAULT_TTS_MAX_WORDS_PER_REQUEST;

export const getServerTtsMaxWordsPerRequest = (): number =>
  parsePositiveInt(
    process.env.TTS_MAX_WORDS_PER_REQUEST ??
      process.env.NEXT_PUBLIC_TTS_MAX_WORDS_PER_REQUEST,
  ) ?? DEFAULT_TTS_MAX_WORDS_PER_REQUEST;
