import { describe, expect, it } from "vitest";
import {
  GUEST_BOOKMARK_STORAGE_KEY,
  addClaimedImportSlugs,
  clearAccountMirrorBookmarks,
  getAccountMirrorStorageKey,
  getClaimedImportStorageKey,
  migrateLegacyGuestBookmarks,
  readAccountMirrorBookmarks,
  readClaimedImportSlugs,
  readGuestBookmarks,
  writeAccountMirrorBookmarks,
  writeGuestBookmarks,
} from "./bookmark-storage";

const createStorage = () => {
  const storage = new Map<string, string>();

  return {
    getItem: (key: string) => storage.get(key) ?? null,
    setItem: (key: string, value: string) => {
      storage.set(key, value);
    },
    removeItem: (key: string) => {
      storage.delete(key);
    },
  };
};

describe("guest bookmark storage", () => {
  it("migrates the legacy guest key into the current guest key", () => {
    const storage = createStorage();
    storage.setItem(
      "world-garden-bookmarks",
      JSON.stringify([{ slug: "mars", title: "Mars", savedAt: 10 }]),
    );

    migrateLegacyGuestBookmarks(storage);

    expect(readGuestBookmarks(storage)).toEqual([
      { slug: "mars", title: "Mars", savedAt: 10 },
    ]);
    expect(storage.getItem("world-garden-bookmarks")).toBeNull();
  });

  it("reads back guest bookmarks exactly as written", () => {
    const storage = createStorage();

    writeGuestBookmarks(
      [
        { slug: "mars", title: "Mars", savedAt: 20 },
        { slug: "venus", title: "Venus", savedAt: 10 },
      ],
      storage,
    );

    expect(readGuestBookmarks(storage)).toEqual([
      { slug: "mars", title: "Mars", savedAt: 20 },
      { slug: "venus", title: "Venus", savedAt: 10 },
    ]);
    expect(storage.getItem(GUEST_BOOKMARK_STORAGE_KEY)).not.toBeNull();
  });
});

describe("account bookmark mirror storage", () => {
  it("clears only the signed-in account mirror and keeps guest bookmarks intact on sign-out", () => {
    const storage = createStorage();

    writeGuestBookmarks(
      [{ slug: "mars", title: "Mars", savedAt: 10 }],
      storage,
    );
    writeAccountMirrorBookmarks(
      "user_123",
      [{ slug: "venus", title: "Venus", savedAt: 20 }],
      storage,
    );

    clearAccountMirrorBookmarks("user_123", storage);

    expect(readGuestBookmarks(storage)).toEqual([
      { slug: "mars", title: "Mars", savedAt: 10 },
    ]);
    expect(readAccountMirrorBookmarks("user_123", storage)).toEqual([]);
    expect(storage.getItem(getAccountMirrorStorageKey("user_123"))).toBeNull();
  });
});

describe("claimed import storage", () => {
  it("tracks claimed guest slugs per signed-in user without duplicates", () => {
    const storage = createStorage();

    addClaimedImportSlugs("user_123", ["mars", "venus"], storage);
    addClaimedImportSlugs("user_123", ["mars"], storage);

    expect(readClaimedImportSlugs("user_123", storage)).toEqual(
      new Set(["mars", "venus"]),
    );
    expect(storage.getItem(getClaimedImportStorageKey("user_123"))).toBe(
      JSON.stringify(["mars", "venus"]),
    );
  });
});
