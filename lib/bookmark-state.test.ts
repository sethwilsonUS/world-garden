import { afterEach, describe, expect, it, vi } from "vitest";
import {
  buildBookmarkImportSignature,
  hybridBookmarkReducer,
  initialHybridBookmarkState,
  removeGuestBookmarkEntry,
  toggleGuestBookmarkEntries,
} from "./bookmark-state";

const bookmark = (slug: string, savedAt: number) => ({
  slug,
  title: slug.replaceAll("_", " "),
  savedAt,
});

describe("bookmark state transitions", () => {
  afterEach(() => vi.useRealTimers());

  it("toggles and removes guest entries without disturbing their ordering", () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-07-14T12:00:00Z"));
    const existing = bookmark("Old_article", 1);

    const added = toggleGuestBookmarkEntries(
      [existing],
      "New_article",
      "New article",
    );

    expect(added.map((entry) => entry.slug)).toEqual([
      "New_article",
      "Old_article",
    ]);
    expect(toggleGuestBookmarkEntries(added, "New_article", "Ignored")).toEqual([
      existing,
    ]);
    expect(removeGuestBookmarkEntry(added, "Old_article")).toEqual([added[0]]);
  });

  it("keeps imported entries optimistic until the remote query catches up", () => {
    const imported = bookmark("Guest_article", 2);
    const remote = bookmark("Remote_article", 1);
    let state = hybridBookmarkReducer(initialHybridBookmarkState, {
      type: "accountMirror",
      entries: [],
    });

    state = hybridBookmarkReducer(state, { type: "startImport" });
    expect(state.isLoaded).toBe(false);

    state = hybridBookmarkReducer(state, {
      type: "importSuccess",
      importedEntries: [imported],
      remoteEntries: [remote],
    });
    expect(state.entries).toEqual([imported, remote]);
    expect(state.pendingImportedEntries).toEqual([imported]);

    state = hybridBookmarkReducer(state, {
      type: "syncRemote",
      remoteEntries: [remote],
    });
    expect(state.entries).toEqual([imported, remote]);

    state = hybridBookmarkReducer(state, {
      type: "syncRemote",
      remoteEntries: [imported, remote],
    });
    expect(state.pendingImportedEntries).toEqual([]);
    expect(state.entries).toEqual([imported, remote]);
  });

  it("returns to the remote source of truth after an import failure", () => {
    const remote = bookmark("Remote_article", 1);
    const state = hybridBookmarkReducer(
      {
        entries: [bookmark("Guest_article", 2)],
        isLoaded: false,
        pendingImportedEntries: [bookmark("Guest_article", 2)],
      },
      { type: "importFailure", remoteEntries: [remote] },
    );

    expect(state).toEqual({
      entries: [remote],
      isLoaded: true,
      pendingImportedEntries: [],
    });
  });

  it("removes account entries from both visible and pending import state", () => {
    const removed = bookmark("Removed", 2);
    const kept = bookmark("Kept", 1);
    const state = hybridBookmarkReducer(
      {
        entries: [removed, kept],
        isLoaded: true,
        pendingImportedEntries: [removed],
      },
      { type: "removeAccount", slug: removed.slug },
    );

    expect(state.entries).toEqual([kept]);
    expect(state.pendingImportedEntries).toEqual([]);
  });

  it("builds stable, account-scoped import signatures", () => {
    expect(
      buildBookmarkImportSignature("user-1", [
        bookmark("Zulu", 2),
        bookmark("Alpha", 1),
      ]),
    ).toBe("user-1:Alpha|Zulu");
    expect(buildBookmarkImportSignature("user-1", [])).toBeNull();
  });
});
