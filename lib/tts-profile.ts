import { TTS_NORM_VERSION } from "./tts-normalize";

export type TtsProvider = "openai" | "edge";

export type TtsProfile = {
  provider: TtsProvider;
  model: string;
  voiceId: string;
  promptVersion: string;
  instructions?: string;
  ttsNormVersion: string;
  ttsCacheKey: string;
};

export type TtsMetadata = Omit<TtsProfile, "instructions">;

export const DEFAULT_OPENAI_TTS_MODEL = "gpt-4o-mini-tts";
export const DEFAULT_OPENAI_TTS_VOICE = "marin";
export const DEFAULT_OPENAI_TTS_PROMPT_VERSION = "curio-warm-narrator-v1";
export const DEFAULT_EDGE_TTS_MODEL = "edge-tts";
export const DEFAULT_EDGE_TTS_VOICE = "en-US-AriaNeural";
export const DEFAULT_EDGE_TTS_PROMPT_VERSION = "edge-default";

export const DEFAULT_OPENAI_TTS_INSTRUCTIONS =
  "Narrate clearly and calmly for an accessibility-first Wikipedia listening app. Use a warm, natural tone, steady pacing, and crisp pronunciation. Avoid theatrics, impressions, whispers, and exaggerated emotion.";

const OPENAI_TTS_VOICES = new Set([
  "alloy",
  "ash",
  "ballad",
  "cedar",
  "coral",
  "echo",
  "fable",
  "marin",
  "nova",
  "onyx",
  "sage",
  "shimmer",
  "verse",
]);

const EDGE_VOICE_RE = /^[a-z]{2,3}-[A-Z]{2}(-[A-Za-z]+)*Neural$/;

const readEnv = (...names: string[]): string | undefined => {
  for (const name of names) {
    const value = process.env[name]?.trim();
    if (value) return value;
  }
  return undefined;
};

export const isOpenAiTtsVoice = (voiceId: string | undefined): voiceId is string =>
  Boolean(voiceId && OPENAI_TTS_VOICES.has(voiceId));

export const isEdgeTtsVoice = (voiceId: string | undefined): voiceId is string =>
  Boolean(voiceId && EDGE_VOICE_RE.test(voiceId));

export const normalizeTtsProvider = (
  provider: string | undefined,
): TtsProvider | null =>
  provider === "openai" || provider === "edge" ? provider : null;

export const buildTtsCacheKey = ({
  provider,
  model,
  voiceId,
  promptVersion,
  ttsNormVersion = TTS_NORM_VERSION,
}: {
  provider: TtsProvider;
  model: string;
  voiceId: string;
  promptVersion: string;
  ttsNormVersion?: string;
}): string =>
  ["tts", provider, model, voiceId, promptVersion, ttsNormVersion].join(":");

const profileWithCacheKey = (
  profile: Omit<TtsProfile, "ttsCacheKey">,
): TtsProfile => ({
  ...profile,
  ttsCacheKey: buildTtsCacheKey(profile),
});

export const getOpenAiTtsProfile = (voiceId?: string): TtsProfile => {
  const configuredVoice = readEnv(
    "OPENAI_TTS_VOICE",
    "NEXT_PUBLIC_OPENAI_TTS_VOICE",
  );
  const resolvedVoice = isOpenAiTtsVoice(voiceId)
    ? voiceId
    : isOpenAiTtsVoice(configuredVoice)
      ? configuredVoice
      : DEFAULT_OPENAI_TTS_VOICE;

  return profileWithCacheKey({
    provider: "openai",
    model:
      readEnv("OPENAI_TTS_MODEL", "NEXT_PUBLIC_OPENAI_TTS_MODEL") ??
      DEFAULT_OPENAI_TTS_MODEL,
    voiceId: resolvedVoice,
    promptVersion:
      readEnv(
        "OPENAI_TTS_PROMPT_VERSION",
        "NEXT_PUBLIC_OPENAI_TTS_PROMPT_VERSION",
      ) ?? DEFAULT_OPENAI_TTS_PROMPT_VERSION,
    instructions:
      readEnv(
        "OPENAI_TTS_INSTRUCTIONS",
        "NEXT_PUBLIC_OPENAI_TTS_INSTRUCTIONS",
      ) ?? DEFAULT_OPENAI_TTS_INSTRUCTIONS,
    ttsNormVersion: TTS_NORM_VERSION,
  });
};

export const getEdgeTtsProfile = (voiceId?: string): TtsProfile => {
  const configuredVoice = readEnv(
    "EDGE_TTS_VOICE_ID",
    "NEXT_PUBLIC_EDGE_TTS_VOICE_ID",
  );
  const resolvedVoice = isEdgeTtsVoice(voiceId)
    ? voiceId
    : isEdgeTtsVoice(configuredVoice)
      ? configuredVoice
      : DEFAULT_EDGE_TTS_VOICE;

  return profileWithCacheKey({
    provider: "edge",
    model: DEFAULT_EDGE_TTS_MODEL,
    voiceId: resolvedVoice,
    promptVersion: DEFAULT_EDGE_TTS_PROMPT_VERSION,
    ttsNormVersion: TTS_NORM_VERSION,
  });
};

export const getConfiguredPrimaryTtsProvider = (): TtsProvider =>
  normalizeTtsProvider(
    readEnv("TTS_PRIMARY_PROVIDER", "NEXT_PUBLIC_TTS_PRIMARY_PROVIDER"),
  ) ?? "openai";

export const getTtsProfile = (
  provider: TtsProvider = getConfiguredPrimaryTtsProvider(),
  voiceId?: string,
): TtsProfile =>
  provider === "edge" ? getEdgeTtsProfile(voiceId) : getOpenAiTtsProfile(voiceId);

export const getActiveTtsProfile = (): TtsProfile =>
  getTtsProfile(getConfiguredPrimaryTtsProvider());

export const getActiveTtsCacheKey = (): string => getActiveTtsProfile().ttsCacheKey;

export const getTtsMetadata = (profile: TtsProfile): TtsMetadata => ({
  provider: profile.provider,
  model: profile.model,
  voiceId: profile.voiceId,
  promptVersion: profile.promptVersion,
  ttsNormVersion: profile.ttsNormVersion,
  ttsCacheKey: profile.ttsCacheKey,
});

export const parseTtsMetadataFromHeaders = (
  headers: Pick<Headers, "get">,
): TtsMetadata | null => {
  const provider = normalizeTtsProvider(headers.get("X-Curio-TTS-Provider") ?? undefined);
  const model = headers.get("X-Curio-TTS-Model")?.trim();
  const voiceId = headers.get("X-Curio-TTS-Voice")?.trim();
  const promptVersion = headers.get("X-Curio-TTS-Prompt-Version")?.trim();
  const ttsNormVersion = headers.get("X-Curio-TTS-Norm-Version")?.trim();
  const ttsCacheKey = headers.get("X-Curio-TTS-Cache-Key")?.trim();

  if (!provider || !model || !voiceId || !promptVersion || !ttsNormVersion || !ttsCacheKey) {
    return null;
  }

  return { provider, model, voiceId, promptVersion, ttsNormVersion, ttsCacheKey };
};

export const buildTtsMetadataHeaders = (
  metadata: TtsMetadata,
  options?: { fallback?: boolean },
): Record<string, string> => ({
  "X-Curio-TTS-Provider": metadata.provider,
  "X-Curio-TTS-Model": metadata.model,
  "X-Curio-TTS-Voice": metadata.voiceId,
  "X-Curio-TTS-Prompt-Version": metadata.promptVersion,
  "X-Curio-TTS-Norm-Version": metadata.ttsNormVersion,
  "X-Curio-TTS-Cache-Key": metadata.ttsCacheKey,
  "X-Curio-TTS-Fallback": options?.fallback ? "true" : "false",
});

export const isTtsFallbackEnabled = (): boolean =>
  (readEnv("TTS_EDGE_FALLBACK", "NEXT_PUBLIC_TTS_EDGE_FALLBACK") ?? "true") !==
  "false";
