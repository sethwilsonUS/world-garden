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

export const getSupersededTtsAudioStorageIds = ({
  previousPrimaryStorageId,
  previousVariants,
  nextPrimaryStorageId,
  nextVariants,
}: {
  previousPrimaryStorageId?: Id<"_storage">;
  previousVariants?: TtsAudioVariant[];
  nextPrimaryStorageId?: Id<"_storage">;
  nextVariants?: TtsAudioVariant[];
}): Id<"_storage">[] => {
  const previousStorageIds = new Set<Id<"_storage">>();
  if (previousPrimaryStorageId) {
    previousStorageIds.add(previousPrimaryStorageId);
  }
  for (const variant of previousVariants ?? []) {
    previousStorageIds.add(variant.storageId);
  }

  const nextStorageIds = new Set<Id<"_storage">>();
  if (nextPrimaryStorageId) {
    nextStorageIds.add(nextPrimaryStorageId);
  }
  for (const variant of nextVariants ?? []) {
    nextStorageIds.add(variant.storageId);
  }

  return [...previousStorageIds].filter(
    (storageId) => !nextStorageIds.has(storageId),
  );
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
