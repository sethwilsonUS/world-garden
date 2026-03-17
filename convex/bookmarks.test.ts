import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  getAuthenticatedViewerTokenIdentifier,
  importGuestBookmarksForCtx,
  listViewerBookmarksForCtx,
  removeViewerBookmarkForCtx,
  saveViewerBookmarkForCtx,
} from "./bookmarks";

type BookmarkDoc = {
  _id: string;
  viewerTokenIdentifier: string;
  slug: string;
  title: string;
  savedAt: number;
  updatedAt: number;
};

const createBookmarkTestDb = (seed: BookmarkDoc[] = []) => {
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
      query: () => ({
        withIndex: (
          _indexName: string,
          apply: (builder: { eq: (field: string, value: string) => unknown }) => unknown,
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
      }),
      insert: async (_tableName: "bookmarks", value: Omit<BookmarkDoc, "_id">) => {
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
) => {
  const { db, getDocs } = createBookmarkTestDb(docs);

  return {
    ctx: {
      auth: {
        getUserIdentity: vi.fn().mockResolvedValue({ tokenIdentifier }),
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
