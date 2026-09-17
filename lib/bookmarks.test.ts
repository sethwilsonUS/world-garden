import { describe, expect, it } from "vitest";
import {
  getBookmarkListViewState,
  getUnclaimedGuestBookmarks,
  isBookmarkSaved,
  mergeBookmarkEntries,
  normalizeBookmarkEntries,
} from "./bookmarks";

describe("normalizeBookmarkEntries", () => {
  it("deduplicates by slug and keeps the most recent saved timestamp first", () => {
    expect(
      normalizeBookmarkEntries([
        { slug: "mars", title: "Mars", savedAt: 10 },
        { slug: "venus", title: "Venus", savedAt: 15 },
        { slug: "mars", title: "Mars updated", savedAt: 20 },
      ]),
    ).toEqual([
      { slug: "mars", title: "Mars updated", savedAt: 20 },
      { slug: "venus", title: "Venus", savedAt: 15 },
    ]);
  });
});

describe("mergeBookmarkEntries", () => {
  it("prefers the first list when the same slug appears in both sources", () => {
    expect(
      mergeBookmarkEntries(
        [
          { slug: "mars", title: "Mars from account", savedAt: 30 },
        ],
        [
          { slug: "mars", title: "Mars from guest", savedAt: 5 },
          { slug: "jupiter", title: "Jupiter", savedAt: 25 },
        ],
      ),
    ).toEqual([
      { slug: "mars", title: "Mars from account", savedAt: 30 },
      { slug: "jupiter", title: "Jupiter", savedAt: 25 },
    ]);
  });
});

describe("getUnclaimedGuestBookmarks", () => {
  it("returns only guest bookmarks that have not already been claimed for the account", () => {
    expect(
      getUnclaimedGuestBookmarks(
        [
          { slug: "mars", title: "Mars", savedAt: 40 },
          { slug: "venus", title: "Venus", savedAt: 30 },
        ],
        new Set(["mars"]),
      ),
    ).toEqual([{ slug: "venus", title: "Venus", savedAt: 30 }]);
  });
});

describe("getBookmarkListViewState", () => {
  it("reports loading before account bookmarks are ready", () => {
    expect(
      getBookmarkListViewState({ isLoaded: false, entriesCount: 0 }),
    ).toBe("loading");
  });

  it("reports empty only after loading finishes with no entries", () => {
    expect(
      getBookmarkListViewState({ isLoaded: true, entriesCount: 0 }),
    ).toBe("empty");
  });

  it("reports list when at least one bookmark is present", () => {
    expect(
      getBookmarkListViewState({ isLoaded: true, entriesCount: 1 }),
    ).toBe("list");
  });
});

describe("isBookmarkSaved", () => {
  it("matches the exact article slug", () => {
    const entries = [{ slug: "Mars", title: "Mars", savedAt: 20 }];

    expect(isBookmarkSaved(entries, "Mars")).toBe(true);
    expect(isBookmarkSaved(entries, "mars")).toBe(false);
  });
});

describe("mergeBookmarkEntries", () => {
  it("keeps the preferred entry when equal timestamps share a slug", () => {
    expect(
      mergeBookmarkEntries(
        [{ slug: "mars", title: "Mars from account", savedAt: 30 }],
        [
          { slug: "mars", title: "Mars from guest", savedAt: 30 },
          { slug: "jupiter", title: "Jupiter", savedAt: 25 },
        ],
      ),
    ).toEqual([
      { slug: "mars", title: "Mars from account", savedAt: 30 },
      { slug: "jupiter", title: "Jupiter", savedAt: 25 },
    ]);
  });

  it("keeps the newer entry when recency and source preference disagree", () => {
    expect(
      mergeBookmarkEntries(
        [
          { slug: "mars", title: "Mars from account", savedAt: 30 },
          { slug: "jupiter", title: "Jupiter", savedAt: 25 },
        ],
        [{ slug: "mars", title: "Mars from guest", savedAt: 45 }],
      ),
    ).toEqual([
      { slug: "mars", title: "Mars from guest", savedAt: 45 },
      { slug: "jupiter", title: "Jupiter", savedAt: 25 },
    ]);
  });
});
