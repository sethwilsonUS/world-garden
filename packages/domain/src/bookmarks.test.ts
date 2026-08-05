import { describe, expect, it } from "vitest";

import {
  getBookmarkListViewState,
  getUnclaimedGuestBookmarks,
  isBookmarkSaved,
  mergeBookmarkEntries,
  normalizeBookmarkEntries,
} from "./index";

describe("normalizeBookmarkEntries", () => {
  it("deduplicates by slug and returns the newest saved entry first", () => {
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

describe("getBookmarkListViewState", () => {
  it.each([
    [{ isLoaded: false, entriesCount: 3 }, "loading"],
    [{ isLoaded: true, entriesCount: 0 }, "empty"],
    [{ isLoaded: true, entriesCount: 1 }, "list"],
  ] as const)("maps %o to %s", (input, expected) => {
    expect(getBookmarkListViewState(input)).toBe(expected);
  });
});

describe("isBookmarkSaved", () => {
  it("matches the exact article slug", () => {
    const entries = [{ slug: "Mars", title: "Mars", savedAt: 20 }];

    expect(isBookmarkSaved(entries, "Mars")).toBe(true);
    expect(isBookmarkSaved(entries, "mars")).toBe(false);
  });
});

describe("getUnclaimedGuestBookmarks", () => {
  it("returns only normalized guest entries not already claimed by the account", () => {
    expect(
      getUnclaimedGuestBookmarks(
        [
          { slug: "mars", title: "Mars", savedAt: 40 },
          { slug: "", title: "Invalid", savedAt: 35 },
          { slug: "venus", title: "Venus", savedAt: 30 },
        ],
        new Set(["mars"]),
      ),
    ).toEqual([{ slug: "venus", title: "Venus", savedAt: 30 }]);
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
