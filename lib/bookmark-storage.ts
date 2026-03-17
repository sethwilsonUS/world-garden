import {
  normalizeBookmarkEntries,
  type BookmarkEntry,
} from "./bookmarks";

export const GUEST_BOOKMARK_STORAGE_KEY = "curio-garden-bookmarks";
const LEGACY_GUEST_BOOKMARK_STORAGE_KEY = "world-garden-bookmarks";
const ACCOUNT_BOOKMARK_MIRROR_PREFIX = "curio-garden-bookmarks-account:";
const CLAIMED_IMPORT_PREFIX = "curio-garden-bookmarks-claimed:";

type StorageLike = Pick<Storage, "getItem" | "setItem" | "removeItem">;

const getStorage = (storage?: StorageLike | null): StorageLike | null => {
  if (storage !== undefined) {
    return storage;
  }

  if (typeof window === "undefined") {
    return null;
  }

  try {
    return window.localStorage;
  } catch {
    return null;
  }
};

const readBookmarkEntries = (
  key: string,
  storage?: StorageLike | null,
): BookmarkEntry[] => {
  const localStorageRef = getStorage(storage);
  if (!localStorageRef) {
    return [];
  }

  try {
    const raw = localStorageRef.getItem(key);
    if (!raw) {
      return [];
    }

    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed)) {
      return [];
    }

    return normalizeBookmarkEntries(
      parsed.filter(
        (entry): entry is BookmarkEntry =>
          typeof entry?.slug === "string" &&
          typeof entry?.title === "string" &&
          typeof entry?.savedAt === "number",
      ),
    );
  } catch {
    return [];
  }
};

const writeBookmarkEntries = (
  key: string,
  entries: BookmarkEntry[],
  storage?: StorageLike | null,
) => {
  const localStorageRef = getStorage(storage);
  if (!localStorageRef) {
    return;
  }

  try {
    localStorageRef.setItem(key, JSON.stringify(normalizeBookmarkEntries(entries)));
  } catch {
    // localStorage unavailable
  }
};

const userScopedKey = (prefix: string, userKey: string) => {
  return `${prefix}${encodeURIComponent(userKey)}`;
};

export const getAccountMirrorStorageKey = (userKey: string): string => {
  return userScopedKey(ACCOUNT_BOOKMARK_MIRROR_PREFIX, userKey);
};

export const getClaimedImportStorageKey = (userKey: string): string => {
  return userScopedKey(CLAIMED_IMPORT_PREFIX, userKey);
};

export const migrateLegacyGuestBookmarks = (storage?: StorageLike | null) => {
  const localStorageRef = getStorage(storage);
  if (!localStorageRef) {
    return;
  }

  try {
    if (
      !localStorageRef.getItem(GUEST_BOOKMARK_STORAGE_KEY) &&
      localStorageRef.getItem(LEGACY_GUEST_BOOKMARK_STORAGE_KEY)
    ) {
      localStorageRef.setItem(
        GUEST_BOOKMARK_STORAGE_KEY,
        localStorageRef.getItem(LEGACY_GUEST_BOOKMARK_STORAGE_KEY)!,
      );
      localStorageRef.removeItem(LEGACY_GUEST_BOOKMARK_STORAGE_KEY);
    }
  } catch {
    // localStorage unavailable
  }
};

export const readGuestBookmarks = (
  storage?: StorageLike | null,
): BookmarkEntry[] => {
  migrateLegacyGuestBookmarks(storage);
  return readBookmarkEntries(GUEST_BOOKMARK_STORAGE_KEY, storage);
};

export const writeGuestBookmarks = (
  entries: BookmarkEntry[],
  storage?: StorageLike | null,
) => {
  writeBookmarkEntries(GUEST_BOOKMARK_STORAGE_KEY, entries, storage);
};

export const readAccountMirrorBookmarks = (
  userKey: string,
  storage?: StorageLike | null,
): BookmarkEntry[] => {
  return readBookmarkEntries(getAccountMirrorStorageKey(userKey), storage);
};

export const writeAccountMirrorBookmarks = (
  userKey: string,
  entries: BookmarkEntry[],
  storage?: StorageLike | null,
) => {
  writeBookmarkEntries(getAccountMirrorStorageKey(userKey), entries, storage);
};

export const clearAccountMirrorBookmarks = (
  userKey: string,
  storage?: StorageLike | null,
) => {
  const localStorageRef = getStorage(storage);
  if (!localStorageRef) {
    return;
  }

  try {
    localStorageRef.removeItem(getAccountMirrorStorageKey(userKey));
  } catch {
    // localStorage unavailable
  }
};

export const readClaimedImportSlugs = (
  userKey: string,
  storage?: StorageLike | null,
): Set<string> => {
  const localStorageRef = getStorage(storage);
  if (!localStorageRef) {
    return new Set();
  }

  try {
    const raw = localStorageRef.getItem(getClaimedImportStorageKey(userKey));
    if (!raw) {
      return new Set();
    }

    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed)) {
      return new Set();
    }

    return new Set(
      parsed.filter((slug): slug is string => typeof slug === "string"),
    );
  } catch {
    return new Set();
  }
};

export const writeClaimedImportSlugs = (
  userKey: string,
  claimedSlugs: Set<string>,
  storage?: StorageLike | null,
) => {
  const localStorageRef = getStorage(storage);
  if (!localStorageRef) {
    return;
  }

  try {
    localStorageRef.setItem(
      getClaimedImportStorageKey(userKey),
      JSON.stringify([...claimedSlugs].sort()),
    );
  } catch {
    // localStorage unavailable
  }
};

export const addClaimedImportSlugs = (
  userKey: string,
  slugs: string[],
  storage?: StorageLike | null,
): Set<string> => {
  const next = readClaimedImportSlugs(userKey, storage);
  for (const slug of slugs) {
    next.add(slug);
  }
  writeClaimedImportSlugs(userKey, next, storage);
  return next;
};
