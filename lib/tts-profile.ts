import { TTS_NORM_VERSION } from "./tts-normalize";

export type TtsProvider = "openai" | "edge";
export type TtsFallbackReason = "openai_quota" | "openai_error";

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

declare global {
  interface Window {
    __CURIO_ACTIVE_TTS_METADATA__?: TtsMetadata;
  }
}

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

const EDGE_VOICE_RE =
  /^[a-z]{2,3}-[A-Z]{2}(?:-[A-Za-z]+)+(?:Neural|:DragonHD(?:Omni)?(?:Latest)?Neural)$/;

const firstConfiguredValue = (
  ...values: Array<string | undefined>
): string | undefined => {
  for (const candidate of values) {
    const value = candidate?.trim();
    if (value) return value;
  }
  return undefined;
};

export const isOpenAiTtsVoice = (
  voiceId: string | undefined,
): voiceId is string => Boolean(voiceId && OPENAI_TTS_VOICES.has(voiceId));

export const isEdgeTtsVoice = (
  voiceId: string | undefined,
): voiceId is string => Boolean(voiceId && EDGE_VOICE_RE.test(voiceId));

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
  const configuredVoice = firstConfiguredValue(
    process.env.OPENAI_TTS_VOICE,
    process.env.NEXT_PUBLIC_OPENAI_TTS_VOICE,
  );
  const resolvedVoice = isOpenAiTtsVoice(voiceId)
    ? voiceId
    : isOpenAiTtsVoice(configuredVoice)
      ? configuredVoice
      : DEFAULT_OPENAI_TTS_VOICE;

  return profileWithCacheKey({
    provider: "openai",
    model:
      firstConfiguredValue(
        process.env.OPENAI_TTS_MODEL,
        process.env.NEXT_PUBLIC_OPENAI_TTS_MODEL,
      ) ?? DEFAULT_OPENAI_TTS_MODEL,
    voiceId: resolvedVoice,
    promptVersion:
      firstConfiguredValue(
        process.env.OPENAI_TTS_PROMPT_VERSION,
        process.env.NEXT_PUBLIC_OPENAI_TTS_PROMPT_VERSION,
      ) ?? DEFAULT_OPENAI_TTS_PROMPT_VERSION,
    instructions:
      firstConfiguredValue(
        process.env.OPENAI_TTS_INSTRUCTIONS,
        process.env.NEXT_PUBLIC_OPENAI_TTS_INSTRUCTIONS,
      ) ?? DEFAULT_OPENAI_TTS_INSTRUCTIONS,
    ttsNormVersion: TTS_NORM_VERSION,
  });
};

export const getEdgeTtsProfile = (voiceId?: string): TtsProfile => {
  const configuredVoice = firstConfiguredValue(
    process.env.EDGE_TTS_VOICE_ID,
    process.env.NEXT_PUBLIC_EDGE_TTS_VOICE_ID,
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
    firstConfiguredValue(
      process.env.TTS_PRIMARY_PROVIDER,
      process.env.NEXT_PUBLIC_TTS_PRIMARY_PROVIDER,
    ),
  ) ?? "openai";

const getInjectedActiveTtsMetadata = (): TtsMetadata | null => {
  if (typeof window === "undefined") return null;
  const metadata = window.__CURIO_ACTIVE_TTS_METADATA__;
  if (
    !metadata ||
    normalizeTtsProvider(metadata.provider) == null ||
    !metadata.model?.trim() ||
    !metadata.voiceId?.trim() ||
    !metadata.promptVersion?.trim() ||
    !metadata.ttsNormVersion?.trim() ||
    metadata.ttsCacheKey !== buildTtsCacheKey(metadata)
  ) {
    return null;
  }
  return metadata;
};

export const getTtsProfile = (
  provider?: TtsProvider,
  voiceId?: string,
): TtsProfile => {
  if (provider == null && voiceId == null) {
    const injected = getInjectedActiveTtsMetadata();
    if (injected) return { ...injected };
  }
  const resolvedProvider = provider ?? getConfiguredPrimaryTtsProvider();
  return resolvedProvider === "edge"
    ? getEdgeTtsProfile(voiceId)
    : getOpenAiTtsProfile(voiceId);
};

export const getActiveTtsProfile = (): TtsProfile => getTtsProfile();

export const getActiveTtsNormVersion = (): string =>
  getActiveTtsProfile().ttsNormVersion;

export const getActiveTtsCacheKey = (): string =>
  getActiveTtsProfile().ttsCacheKey;

export const getTtsMetadata = (profile: TtsProfile): TtsMetadata => ({
  provider: profile.provider,
  model: profile.model,
  voiceId: profile.voiceId,
  promptVersion: profile.promptVersion,
  ttsNormVersion: profile.ttsNormVersion,
  ttsCacheKey: profile.ttsCacheKey,
});

export const doesTtsMetadataMatch = (
  actual: Partial<TtsMetadata> | null | undefined,
  expected: TtsMetadata,
): boolean =>
  actual?.provider === expected.provider &&
  actual.model === expected.model &&
  actual.voiceId === expected.voiceId &&
  actual.promptVersion === expected.promptVersion &&
  actual.ttsNormVersion === expected.ttsNormVersion &&
  actual.ttsCacheKey === expected.ttsCacheKey;

export const isTtsMetadataValid = (metadata: TtsMetadata): boolean => {
  const model = metadata.model.trim();
  const promptVersion = metadata.promptVersion.trim();
  const voiceIsValid =
    metadata.provider === "openai"
      ? isOpenAiTtsVoice(metadata.voiceId)
      : isEdgeTtsVoice(metadata.voiceId);

  return (
    metadata.ttsNormVersion === TTS_NORM_VERSION &&
    model.length > 0 &&
    model.length <= 200 &&
    promptVersion.length > 0 &&
    promptVersion.length <= 200 &&
    metadata.voiceId.length <= 200 &&
    voiceIsValid &&
    metadata.ttsCacheKey === buildTtsCacheKey(metadata)
  );
};

export const serializeTtsMetadataForInlineScript = (
  metadata: TtsMetadata,
): string =>
  JSON.stringify(metadata).replace(
    /[<>&\u2028\u2029]/g,
    (character) =>
      `\\u${character.charCodeAt(0).toString(16).padStart(4, "0")}`,
  );

export const parseTtsMetadataFromHeaders = (
  headers: Pick<Headers, "get">,
): TtsMetadata | null => {
  const provider = normalizeTtsProvider(
    headers.get("X-Curio-TTS-Provider") ?? undefined,
  );
  const model = headers.get("X-Curio-TTS-Model")?.trim();
  const voiceId = headers.get("X-Curio-TTS-Voice")?.trim();
  const promptVersion = headers.get("X-Curio-TTS-Prompt-Version")?.trim();
  const ttsNormVersion = headers.get("X-Curio-TTS-Norm-Version")?.trim();
  const ttsCacheKey = headers.get("X-Curio-TTS-Cache-Key")?.trim();

  if (
    !provider ||
    !model ||
    !voiceId ||
    !promptVersion ||
    !ttsNormVersion ||
    !ttsCacheKey
  ) {
    return null;
  }

  return {
    provider,
    model,
    voiceId,
    promptVersion,
    ttsNormVersion,
    ttsCacheKey,
  };
};

export const buildTtsMetadataHeaders = (
  metadata: TtsMetadata,
  options?: { fallback?: boolean; fallbackReason?: TtsFallbackReason },
): Record<string, string> => ({
  "X-Curio-TTS-Provider": metadata.provider,
  "X-Curio-TTS-Model": metadata.model,
  "X-Curio-TTS-Voice": metadata.voiceId,
  "X-Curio-TTS-Prompt-Version": metadata.promptVersion,
  "X-Curio-TTS-Norm-Version": metadata.ttsNormVersion,
  "X-Curio-TTS-Cache-Key": metadata.ttsCacheKey,
  "X-Curio-TTS-Fallback": options?.fallback ? "true" : "false",
  ...(options?.fallbackReason
    ? { "X-Curio-TTS-Fallback-Reason": options.fallbackReason }
    : {}),
});

export const isTtsFallbackEnabled = (): boolean =>
  (firstConfiguredValue(
    process.env.TTS_EDGE_FALLBACK,
    process.env.NEXT_PUBLIC_TTS_EDGE_FALLBACK,
  ) ?? "true") !== "false";
