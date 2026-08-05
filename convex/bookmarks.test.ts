import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  getAuthenticatedViewerTokenIdentifier,
  getBoundNativeViewerTokenIdentifier,
  importGuestBookmarksForCtx,
  listNativeViewerBookmarksForCtx,
  listViewerBookmarksForCtx,
  removeNativeViewerBookmarkForCtx,
  removeViewerBookmarkForCtx,
  saveNativeViewerBookmarkForCtx,
  saveViewerBookmarkForCtx,
} from "./bookmarks";
import { createAccountDeletionQueryChain } from "../test-utils/account-deletion-stubs";

type BookmarkDoc = {
  _id: string;
  viewerTokenIdentifier: string;
  slug: string;
  title: string;
  savedAt: number;
  updatedAt: number;
};

const createBookmarkTestDb = (
  seed: BookmarkDoc[] = [],
  deletingViewers: string[] = [],
) => {
  let docs = [...seed];
  let idCounter = seed.length;

  const getMatchingBookmarks = (filters: Map<string, string>) => {
    return docs.filter((doc) => {
      for (const [field, value] of filters) {
        if ((doc as Record<string, unknown>)[field] !== value) {
          return false;
        }
      }
      return true;
    });
  };

  return {
    db: {
      query: (tableName: string) => {
        if (tableName === "accountDeletionRequests") {
          return createAccountDeletionQueryChain(deletingViewers);
        }
        return {
          withIndex: (
            _indexName: string,
            apply: (builder: {
              eq: (field: string, value: string) => unknown;
            }) => unknown,
          ) => {
            const filters = new Map<string, string>();
            const builder = {
              eq: (field: string, value: string) => {
                filters.set(field, value);
                return builder;
              },
            };
            apply(builder);
            return {
              unique: async () => getMatchingBookmarks(filters)[0] ?? null,
              collect: async () => getMatchingBookmarks(filters),
            };
          },
        };
      },
      insert: async (
        _tableName: "bookmarks",
        value: Omit<BookmarkDoc, "_id">,
      ) => {
        idCounter += 1;
        const _id = `bookmark-${idCounter}`;
        docs.push({ _id, ...value });
        return _id as never;
      },
      patch: async (id: string, value: Partial<BookmarkDoc>) => {
        docs = docs.map((doc) => (doc._id === id ? { ...doc, ...value } : doc));
      },
      delete: async (id: string) => {
        docs = docs.filter((doc) => doc._id !== id);
      },
    },
    getDocs: () => [...docs],
  };
};

const createCtx = (
  docs: BookmarkDoc[] = [],
  tokenIdentifier = "user-1",
  deletingViewers: string[] = [],
) => {
  const { db, getDocs } = createBookmarkTestDb(docs, deletingViewers);

  return {
    ctx: {
      auth: {
        getUserIdentity: vi.fn().mockResolvedValue({
          subject: tokenIdentifier,
          tokenIdentifier,
        }),
      },
      db,
    },
    getDocs,
  };
};

describe("getAuthenticatedViewerTokenIdentifier", () => {
  it("throws when the viewer is not signed in", async () => {
    await expect(
      getAuthenticatedViewerTokenIdentifier({
        auth: { getUserIdentity: vi.fn().mockResolvedValue(null) },
      } as never),
    ).rejects.toThrow("Unauthorized");
  });

  it("blocks a stale signed-in identity after account deletion starts", async () => {
    const { ctx } = createCtx([], "user-1", ["user-1"]);

    await expect(
      getAuthenticatedViewerTokenIdentifier(ctx as never),
    ).rejects.toThrow("ACCOUNT_DELETION_IN_PROGRESS");
  });
});

describe("getBoundNativeViewerTokenIdentifier", () => {
  it("rejects a queued Account A operation when transport authenticates Account B", async () => {
    const { ctx, getDocs } = createCtx([], "user-b");

    await expect(
      getBoundNativeViewerTokenIdentifier(ctx as never, "user-a"),
    ).rejects.toThrow("Account changed");
    expect(getDocs()).toEqual([]);
  });
});

describe("listViewerBookmarksForCtx", () => {
  it("returns only the current viewer's bookmarks sorted newest first", async () => {
    const { ctx } = createCtx([
      {
        _id: "bookmark-1",
        viewerTokenIdentifier: "user-1",
        slug: "mars",
        title: "Mars",
        savedAt: 10,
        updatedAt: 10,
      },
      {
        _id: "bookmark-2",
        viewerTokenIdentifier: "user-2",
        slug: "earth",
        title: "Earth",
        savedAt: 50,
        updatedAt: 50,
      },
      {
        _id: "bookmark-3",
        viewerTokenIdentifier: "user-1",
        slug: "venus",
        title: "Venus",
        savedAt: 20,
        updatedAt: 20,
      },
    ]);

    await expect(listViewerBookmarksForCtx(ctx as never)).resolves.toEqual([
      { slug: "venus", title: "Venus", savedAt: 20 },
      { slug: "mars", title: "Mars", savedAt: 10 },
    ]);
  });
});

describe("listNativeViewerBookmarksForCtx", () => {
  it("echoes the opaque epoch and returns only normalized viewer bookmarks newest first", async () => {
    const { ctx } = createCtx([
      {
        _id: "bookmark-1",
        viewerTokenIdentifier: "user-1",
        slug: "mars",
        title: "Old Mars",
        savedAt: 10,
        updatedAt: 10,
      },
      {
        _id: "bookmark-2",
        viewerTokenIdentifier: "user-2",
        slug: "earth",
        title: "Earth",
        savedAt: 100,
        updatedAt: 100,
      },
      {
        _id: "bookmark-3",
        viewerTokenIdentifier: "user-1",
        slug: "venus",
        title: "Venus",
        savedAt: 20,
        updatedAt: 20,
      },
      {
        _id: "bookmark-4",
        viewerTokenIdentifier: "user-1",
        slug: "mars",
        title: "Mars",
        savedAt: 30,
        updatedAt: 30,
      },
      {
        _id: "bookmark-5",
        viewerTokenIdentifier: "user-1",
        slug: " ",
        title: "Invalid",
        savedAt: 40,
        updatedAt: 40,
      },
    ]);
    const sessionEpochKey = "epoch:account-switch/7?opaque";

    await expect(
      listNativeViewerBookmarksForCtx(ctx as never, {
        expectedAccountSubject: "user-1",
        sessionEpochKey,
      }),
    ).resolves.toEqual({
      sessionEpochKey,
      entries: [
        { slug: "mars", title: "Mars", savedAt: 30 },
        { slug: "venus", title: "Venus", savedAt: 20 },
      ],
    });
  });

  it("rejects Account A query args when transport authenticates Account B", async () => {
    const accountABookmark = {
      _id: "bookmark-a",
      viewerTokenIdentifier: "user-a",
      slug: "mars",
      title: "Mars",
      savedAt: 10,
      updatedAt: 10,
    };
    const accountBBookmark = {
      _id: "bookmark-b",
      viewerTokenIdentifier: "user-b",
      slug: "venus",
      title: "Venus",
      savedAt: 20,
      updatedAt: 20,
    };
    const { ctx } = createCtx([accountABookmark, accountBBookmark], "user-b");

    await expect(
      listNativeViewerBookmarksForCtx(ctx as never, {
        expectedAccountSubject: "user-a",
        sessionEpochKey: "epoch-a",
      }),
    ).rejects.toThrow("Account changed");
  });
});

describe("saveViewerBookmarkForCtx", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-03-16T18:00:00Z"));
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("inserts a new bookmark for the signed-in viewer", async () => {
    const { ctx, getDocs } = createCtx();

    await expect(
      saveViewerBookmarkForCtx(ctx as never, { slug: "mars", title: "Mars" }),
    ).resolves.toEqual({
      slug: "mars",
      title: "Mars",
      savedAt: Date.now(),
    });

    expect(getDocs()).toHaveLength(1);
  });

  it("updates title without changing the original saved timestamp", async () => {
    const { ctx, getDocs } = createCtx([
      {
        _id: "bookmark-1",
        viewerTokenIdentifier: "user-1",
        slug: "mars",
        title: "Old Mars",
        savedAt: 25,
        updatedAt: 25,
      },
    ]);

    await expect(
      saveViewerBookmarkForCtx(ctx as never, {
        slug: "mars",
        title: "Mars updated",
      }),
    ).resolves.toEqual({
      slug: "mars",
      title: "Mars updated",
      savedAt: 25,
    });

    expect(getDocs()[0]).toMatchObject({
      slug: "mars",
      title: "Mars updated",
      savedAt: 25,
      updatedAt: Date.now(),
    });
  });
});

describe("removeViewerBookmarkForCtx", () => {
  it("removes the viewer's bookmark by slug", async () => {
    const { ctx, getDocs } = createCtx([
      {
        _id: "bookmark-1",
        viewerTokenIdentifier: "user-1",
        slug: "mars",
        title: "Mars",
        savedAt: 10,
        updatedAt: 10,
      },
    ]);

    await expect(
      removeViewerBookmarkForCtx(ctx as never, { slug: "mars" }),
    ).resolves.toEqual({ removed: true });
    expect(getDocs()).toEqual([]);
  });

  it("does not let Account B remove Account A's bookmark", async () => {
    const accountABookmark = {
      _id: "bookmark-1",
      viewerTokenIdentifier: "user-a",
      slug: "mars",
      title: "Mars",
      savedAt: 10,
      updatedAt: 10,
    };
    const { ctx, getDocs } = createCtx([accountABookmark], "user-b");

    await expect(
      removeViewerBookmarkForCtx(ctx as never, { slug: "mars" }),
    ).resolves.toEqual({ removed: false });
    expect(getDocs()).toEqual([accountABookmark]);
  });
});

describe("native viewer bookmark mutations", () => {
  afterEach(() => {
    vi.useRealTimers();
  });

  it("echoes the epoch and commits only when the validated subject still matches", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-08-05T12:00:00Z"));
    const { ctx, getDocs } = createCtx([], "user-a");

    await expect(
      saveNativeViewerBookmarkForCtx(ctx as never, {
        expectedAccountSubject: "user-a",
        sessionEpochKey: "epoch-a",
        slug: "mars",
        title: "Mars",
      }),
    ).resolves.toEqual({
      entry: {
        savedAt: Date.now(),
        slug: "mars",
        title: "Mars",
      },
      sessionEpochKey: "epoch-a",
    });
    expect(getDocs()).toHaveLength(1);

    await expect(
      removeNativeViewerBookmarkForCtx(ctx as never, {
        expectedAccountSubject: "user-a",
        sessionEpochKey: "epoch-a",
        slug: "mars",
      }),
    ).resolves.toEqual({ removed: true, sessionEpochKey: "epoch-a" });
    expect(getDocs()).toEqual([]);
  });

  it("cannot execute a queued Account A write after Account B authenticates", async () => {
    const accountBBookmark = {
      _id: "bookmark-b",
      viewerTokenIdentifier: "user-b",
      slug: "mars",
      title: "Account B Mars",
      savedAt: 20,
      updatedAt: 20,
    };
    const { ctx, getDocs } = createCtx([accountBBookmark], "user-b");

    await expect(
      saveNativeViewerBookmarkForCtx(ctx as never, {
        expectedAccountSubject: "user-a",
        sessionEpochKey: "epoch-a",
        slug: "mars",
        title: "Account A Mars",
      }),
    ).rejects.toThrow("Account changed");
    await expect(
      removeNativeViewerBookmarkForCtx(ctx as never, {
        expectedAccountSubject: "user-a",
        sessionEpochKey: "epoch-a",
        slug: "mars",
      }),
    ).rejects.toThrow("Account changed");
    expect(getDocs()).toEqual([accountBBookmark]);
  });
});

describe("importGuestBookmarksForCtx", () => {
  it("imports missing guest bookmarks without overwriting existing account bookmarks", async () => {
    const { ctx, getDocs } = createCtx([
      {
        _id: "bookmark-1",
        viewerTokenIdentifier: "user-1",
        slug: "mars",
        title: "Mars from account",
        savedAt: 100,
        updatedAt: 100,
      },
    ]);

    await expect(
      importGuestBookmarksForCtx(ctx as never, {
        entries: [
          { slug: "mars", title: "Mars from guest", savedAt: 50 },
          { slug: "venus", title: "Venus", savedAt: 75 },
          { slug: "venus", title: "Venus duplicate", savedAt: 60 },
        ],
      }),
    ).resolves.toEqual({ importedCount: 1 });

    expect(getDocs()).toEqual([
      {
        _id: "bookmark-1",
        viewerTokenIdentifier: "user-1",
        slug: "mars",
        title: "Mars from account",
        savedAt: 100,
        updatedAt: 100,
      },
      expect.objectContaining({
        viewerTokenIdentifier: "user-1",
        slug: "venus",
        title: "Venus",
        savedAt: 75,
      }),
    ]);
  });

  it("is idempotent when the same guest bookmarks are imported twice", async () => {
    const { ctx, getDocs } = createCtx();
    const entries = [{ slug: "mars", title: "Mars", savedAt: 42 }];

    await importGuestBookmarksForCtx(ctx as never, { entries });
    await importGuestBookmarksForCtx(ctx as never, { entries });

    expect(getDocs()).toHaveLength(1);
  });
});
