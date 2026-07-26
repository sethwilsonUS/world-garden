import {
  getTtsProviderForAudience,
  type TtsAudience,
  type TtsFallbackReason,
  type TtsProvider,
} from "./tts-profile";

export type TtsProviderAccess = {
  requestedProvider: TtsProvider;
  provider: TtsProvider;
  fallbackReason?: TtsFallbackReason;
};

/**
 * Central authorization policy for interactive speech. Explicit Edge is
 * always safe. OpenAI requires a signed-in audience or a trusted background
 * caller, and local mode always stays on Edge.
 */
export const resolveTtsProviderAccess = ({
  audience,
  requestedProvider = getTtsProviderForAudience(audience),
  localMode = false,
  trusted = false,
}: {
  audience: TtsAudience;
  requestedProvider?: TtsProvider;
  localMode?: boolean;
  trusted?: boolean;
}): TtsProviderAccess => {
  const canUseOpenAi = !localMode && (audience === "authenticated" || trusted);
  if (requestedProvider === "openai" && !canUseOpenAi) {
    return {
      requestedProvider,
      provider: "edge",
      fallbackReason: "openai_auth",
    };
  }

  return { requestedProvider, provider: requestedProvider };
};
