// @vitest-environment jsdom

import { act, useEffect } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { BookmarkControllerValue } from "./bookmark-controller";
import {
  HybridBookmarkProvider,
  LocalBookmarkProvider,
  useBookmarks,
} from "./useBookmarks";
import {
  getClaimedImportStorageKey,
  GUEST_BOOKMARK_STORAGE_KEY,
} from "@/lib/bookmark-storage";
import type { BookmarkEntry } from "@/lib/bookmarks";

const mocks = vi.hoisted(() => ({
  auth: {
    isLoaded: true,
    isSignedIn: false as boolean,
    userId: null as string | null,
  },
  convexAuth: {
    isLoading: false,
    isAuthenticated: false,
  },
  remoteEntries: undefined as BookmarkEntry[] | undefined,
  save: vi.fn(),
  remove: vi.fn(),
  importGuest: vi.fn(),
}));

vi.mock("@clerk/nextjs", () => ({
  useAuth: () => mocks.auth,
}));

vi.mock("@/convex/_generated/api", () => ({
  api: {
    bookmarks: {
      listViewerBookmarks: "listViewerBookmarks",
      saveViewerBookmark: "saveViewerBookmark",
      removeViewerBookmark: "removeViewerBookmark",
      importGuestBookmarks: "importGuestBookmarks",
    },
  },
}));

vi.mock("convex/react", () => ({
  useConvexAuth: () => mocks.convexAuth,
  useQuery: () => mocks.remoteEntries,
  useMutation: (name: string) => {
    if (name === "saveViewerBookmark") return mocks.save;
    if (name === "removeViewerBookmark") return mocks.remove;
    return mocks.importGuest;
  },
}));

Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });

const bookmark = (slug: string, savedAt = 1): BookmarkEntry => ({
  slug,
  title: slug.replaceAll("_", " "),
  savedAt,
});

const deferred = <T,>() => {
  let resolve!: (value: T) => void;
  let reject!: (reason?: unknown) => void;
  const promise = new Promise<T>((resolvePromise, rejectPromise) => {
    resolve = resolvePromise;
    reject = rejectPromise;
  });
  return { promise, resolve, reject };
};

let latestController: BookmarkControllerValue;

const Consumer = () => {
  const controller = useBookmarks();

  useEffect(() => {
    latestController = controller;
  }, [controller]);

  return null;
};

describe("bookmark providers", () => {
  let container: HTMLDivElement;
  let root: Root;

  const renderHybrid = async () => {
    await act(async () => {
      root.render(
        <HybridBookmarkProvider>
          <Consumer />
        </HybridBookmarkProvider>,
      );
      await Promise.resolve();
    });
  };

  beforeEach(() => {
    container = document.createElement("div");
    document.body.appendChild(container);
    root = createRoot(container);
    localStorage.clear();
    mocks.auth.isLoaded = true;
    mocks.auth.isSignedIn = false;
    mocks.auth.userId = null;
    mocks.convexAuth.isLoading = false;
    mocks.convexAuth.isAuthenticated = false;
    mocks.remoteEntries = undefined;
    mocks.save.mockReset();
    mocks.remove.mockReset();
    mocks.importGuest.mockReset();
  });

  afterEach(() => {
    act(() => root.unmount());
    container.remove();
    localStorage.clear();
  });

  it("persists local guest toggles while preserving the public context API", async () => {
    await act(async () => {
      root.render(
        <LocalBookmarkProvider>
          <Consumer />
        </LocalBookmarkProvider>,
      );
    });

    expect(latestController.storageMode).toBe("guest");
    expect(latestController.isLoaded).toBe(true);

    act(() => latestController.toggle("The_Shire", "The Shire"));
    expect(latestController.isBookmarked("The_Shire")).toBe(true);
    expect(JSON.parse(localStorage.getItem(GUEST_BOOKMARK_STORAGE_KEY)!)).toEqual([
      expect.objectContaining({ slug: "The_Shire", title: "The Shire" }),
    ]);

    act(() => latestController.remove("The_Shire"));
    expect(latestController.entries).toEqual([]);
  });

  it("imports guest entries once and ignores a stale completion after switching users", async () => {
    const firstImport = deferred<unknown>();
    const secondImport = deferred<unknown>();
    mocks.importGuest
      .mockImplementationOnce(() => firstImport.promise)
      .mockImplementationOnce(() => secondImport.promise);
    localStorage.setItem(
      GUEST_BOOKMARK_STORAGE_KEY,
      JSON.stringify([bookmark("Guest_article")]),
    );
    mocks.auth.isSignedIn = true;
    mocks.auth.userId = "user-1";
    mocks.convexAuth.isAuthenticated = true;
    mocks.remoteEntries = [];

    await renderHybrid();
    await renderHybrid();
    expect(mocks.importGuest).toHaveBeenCalledTimes(1);
    expect(latestController.isLoaded).toBe(false);

    mocks.auth.userId = "user-2";
    await renderHybrid();
    expect(mocks.importGuest).toHaveBeenCalledTimes(2);

    await act(async () => {
      firstImport.resolve(undefined);
      await firstImport.promise;
      await Promise.resolve();
    });
    expect(localStorage.getItem(getClaimedImportStorageKey("user-1"))).toBeNull();
    expect(latestController.entries).toEqual([]);

    await act(async () => {
      secondImport.resolve(undefined);
      await secondImport.promise;
      await Promise.resolve();
    });
    expect(latestController.entries.map((entry) => entry.slug)).toEqual([
      "Guest_article",
    ]);
    expect(
      JSON.parse(localStorage.getItem(getClaimedImportStorageKey("user-2"))!),
    ).toEqual(["Guest_article"]);
  });

  it("deduplicates account mutations without blocking the next signed-in user", async () => {
    const firstSave = deferred<BookmarkEntry>();
    const secondSave = deferred<BookmarkEntry>();
    mocks.save
      .mockImplementationOnce(() => firstSave.promise)
      .mockImplementationOnce(() => secondSave.promise);
    mocks.auth.isSignedIn = true;
    mocks.auth.userId = "user-1";
    mocks.convexAuth.isAuthenticated = true;
    mocks.remoteEntries = [];
    mocks.importGuest.mockResolvedValue(undefined);
    await renderHybrid();

    act(() => {
      latestController.toggle("Shared_slug", "First title");
      latestController.toggle("Shared_slug", "Duplicate title");
    });
    expect(mocks.save).toHaveBeenCalledTimes(1);

    mocks.auth.userId = "user-2";
    await renderHybrid();
    act(() => latestController.toggle("Shared_slug", "Second title"));
    expect(mocks.save).toHaveBeenCalledTimes(2);

    await act(async () => {
      firstSave.resolve(bookmark("Shared_slug", 1));
      await firstSave.promise;
      await Promise.resolve();
    });
    expect(latestController.entries).toEqual([]);

    await act(async () => {
      secondSave.resolve(bookmark("Shared_slug", 2));
      await secondSave.promise;
      await Promise.resolve();
    });
    expect(latestController.entries).toEqual([bookmark("Shared_slug", 2)]);
  });

  it("falls back to remote entries after an import failure without retrying the same batch", async () => {
    const remote = bookmark("Remote_article", 2);
    localStorage.setItem(
      GUEST_BOOKMARK_STORAGE_KEY,
      JSON.stringify([bookmark("Guest_article")]),
    );
    mocks.auth.isSignedIn = true;
    mocks.auth.userId = "user-1";
    mocks.convexAuth.isAuthenticated = true;
    mocks.remoteEntries = [remote];
    mocks.importGuest.mockRejectedValue(new Error("offline"));

    await renderHybrid();
    await vi.waitFor(() => expect(latestController.isLoaded).toBe(true));
    expect(latestController.entries).toEqual([remote]);

    await renderHybrid();
    expect(mocks.importGuest).toHaveBeenCalledTimes(1);
    expect(localStorage.getItem(getClaimedImportStorageKey("user-1"))).toBeNull();
  });
});
