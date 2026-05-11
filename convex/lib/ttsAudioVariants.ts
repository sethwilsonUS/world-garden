import type { Id } from "../_generated/dataModel";

export type TtsAudioVariant = {
  storageId: Id<"_storage">;
  durationSeconds?: number;
  byteLength?: number;
  ttsCacheKey: string;
  provider: string;
  model: string;
  voiceId: string;
  promptVersion: string;
  ttsNormVersion: string;
  createdAt: number;
};

export type TtsAudioVariantInput = {
  storageId?: Id<"_storage">;
  durationSeconds?: number;
  byteLength?: number;
  ttsCacheKey?: string;
  provider?: string;
  model?: string;
  voiceId?: string;
  promptVersion?: string;
  ttsNormVersion?: string;
};

export const upsertTtsAudioVariant = (
  existingVariants: TtsAudioVariant[] | undefined,
  input: TtsAudioVariantInput,
  createdAt: number,
): TtsAudioVariant[] | undefined => {
  if (
    !input.storageId ||
    !input.ttsCacheKey ||
    !input.provider ||
    !input.model ||
    !input.voiceId ||
    !input.promptVersion ||
    !input.ttsNormVersion
  ) {
    return existingVariants;
  }

  const variant: TtsAudioVariant = {
    storageId: input.storageId,
    durationSeconds: input.durationSeconds,
    byteLength: input.byteLength,
    ttsCacheKey: input.ttsCacheKey,
    provider: input.provider,
    model: input.model,
    voiceId: input.voiceId,
    promptVersion: input.promptVersion,
    ttsNormVersion: input.ttsNormVersion,
    createdAt,
  };

  return [
    ...(existingVariants ?? []).filter(
      (existing) => existing.ttsCacheKey !== variant.ttsCacheKey,
    ),
    variant,
  ];
};
