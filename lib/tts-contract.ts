export const TTS_API_ROUTE = "/api/tts";
export const TTS_MIN_TEXT_LENGTH = 10;
export const TTS_MAX_WORDS_PER_REQUEST = 1200;

// This is the current backend default. Treat it as contract metadata rather
// than a frontend engine choice.
export const CURRENT_TTS_DEFAULT_VOICE = "en-US-AriaNeural";

export type TtsRequest = {
  text: string;
  voiceId?: string;
};
