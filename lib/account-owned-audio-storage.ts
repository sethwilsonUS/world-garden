export const ACCOUNT_OWNED_AUDIO_STORAGE_CONTENT_TYPE =
  "application/vnd.curiogarden.account-audio" as const;
export const ACCOUNT_OWNED_AUDIO_SWEEP_KEY =
  "account_owned_audio_orphans" as const;
export const ACCOUNT_OWNED_AUDIO_MAX_LATE_ACTION_MS = 30 * 60 * 1_000;
export const ACCOUNT_OWNED_AUDIO_ORPHAN_GRACE_MS = 2 * 60 * 60 * 1_000;

export const isAccountOwnedAudioStorageContentType = (
  contentType: string | null | undefined,
): boolean => contentType === ACCOUNT_OWNED_AUDIO_STORAGE_CONTENT_TYPE;

export const getCombinedAudioStorageContentType = (
  sourceContentType: string,
  accountOwned: boolean,
): string =>
  accountOwned ? ACCOUNT_OWNED_AUDIO_STORAGE_CONTENT_TYPE : sourceContentType;

export const normalizeStoredAudioContentType = (
  contentType: string | null | undefined,
): string =>
  isAccountOwnedAudioStorageContentType(contentType)
    ? "audio/mpeg"
    : contentType || "audio/mpeg";
