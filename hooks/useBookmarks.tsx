"use client";

import { useAuth } from "@clerk/nextjs";
import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useReducer,
  useRef,
  useState,
  type Dispatch,
  type ReactNode,
  type SetStateAction,
} from "react";
import { useConvexAuth, useMutation, useQuery } from "convex/react";
import { api } from "@/convex/_generated/api";
import {
  addClaimedImportSlugs,
  clearAccountMirrorBookmarks,
  readAccountMirrorBookmarks,
  readClaimedImportSlugs,
  readGuestBookmarks,
  writeAccountMirrorBookmarks,
  writeGuestBookmarks,
} from "@/lib/bookmark-storage";
import {
  getUnclaimedGuestBookmarks,
  isBookmarkSaved,
  mergeBookmarkEntries,
  type BookmarkEntry,
  type BookmarkStorageMode,
} from "@/lib/bookmarks";

type BookmarkContextValue = {
  entries: BookmarkEntry[];
  isLoaded: boolean;
  storageMode: BookmarkStorageMode;
  isBookmarked: (slug: string) => boolean;
  toggle: (slug: string, title: string) => void;
  remove: (slug: string) => void;
};

const BookmarkContext = createContext<BookmarkContextValue | null>(null);

const buildGuestBookmark = (slug: string, title: string): BookmarkEntry => ({
  slug,
  title,
  savedAt: Date.now(),
});

const buildImportSignature = (
  userKey: string,
  entries: BookmarkEntry[],
): string | null => {
  if (entries.length === 0) {
    return null;
  }

  return `${userKey}:${entries.map((entry) => entry.slug).sort().join("|")}`;
};

type HybridBookmarkState = {
  entries: BookmarkEntry[];
  isLoaded: boolean;
  pendingImportedEntries: BookmarkEntry[];
};

type HybridBookmarkAction =
  | { type: "reset" }
  | { type: "guest"; entries: BookmarkEntry[] }
  | { type: "accountMirror"; entries: BookmarkEntry[] }
  | { type: "convexUnavailable" }
  | { type: "syncRemote"; remoteEntries: BookmarkEntry[] }
  | { type: "startImport" }
  | {
      type: "importSuccess";
      importedEntries: BookmarkEntry[];
      remoteEntries: BookmarkEntry[];
    }
  | { type: "importFailure"; remoteEntries: BookmarkEntry[] }
  | { type: "saveAccount"; entry: BookmarkEntry }
  | { type: "removeAccount"; slug: string };

const initialHybridBookmarkState: HybridBookmarkState = {
  entries: [],
  isLoaded: false,
  pendingImportedEntries: [],
};

const hybridBookmarkReducer = (
  state: HybridBookmarkState,
  action: HybridBookmarkAction,
): HybridBookmarkState => {
  switch (action.type) {
    case "reset":
      return initialHybridBookmarkState;
    case "guest":
      return {
        entries: action.entries,
        isLoaded: true,
        pendingImportedEntries: [],
      };
    case "accountMirror":
      return {
        entries: action.entries,
        isLoaded: false,
        pendingImportedEntries: [],
      };
    case "convexUnavailable":
      return {
        ...state,
        isLoaded: true,
        pendingImportedEntries: [],
      };
    case "syncRemote": {
      const remoteHasPendingEntries =
        state.pendingImportedEntries.length > 0 &&
        state.pendingImportedEntries.every((entry) =>
          action.remoteEntries.some((remoteEntry) => remoteEntry.slug === entry.slug),
        );

      if (remoteHasPendingEntries) {
        return {
          entries: action.remoteEntries,
          isLoaded: true,
          pendingImportedEntries: [],
        };
      }

      return {
        entries:
          state.pendingImportedEntries.length > 0
            ? mergeBookmarkEntries(
                state.pendingImportedEntries,
                action.remoteEntries,
              )
            : action.remoteEntries,
        isLoaded: true,
        pendingImportedEntries: state.pendingImportedEntries,
      };
    }
    case "startImport":
      return {
        ...state,
        isLoaded: false,
      };
    case "importSuccess":
      return {
        entries: mergeBookmarkEntries(
          action.importedEntries,
          action.remoteEntries,
        ),
        isLoaded: true,
        pendingImportedEntries: action.importedEntries,
      };
    case "importFailure":
      return {
        entries: action.remoteEntries,
        isLoaded: true,
        pendingImportedEntries: [],
      };
    case "saveAccount":
      return {
        ...state,
        entries: mergeBookmarkEntries([action.entry], state.entries),
      };
    case "removeAccount":
      return {
        ...state,
        entries: state.entries.filter((entry) => entry.slug !== action.slug),
        pendingImportedEntries: state.pendingImportedEntries.filter(
          (entry) => entry.slug !== action.slug,
        ),
      };
  }
};

const createGuestBookmarkValue = (
  entries: BookmarkEntry[],
  setEntries: Dispatch<SetStateAction<BookmarkEntry[]>>,
): BookmarkContextValue => {
  const updateGuestEntries = (updater: (prev: BookmarkEntry[]) => BookmarkEntry[]) => {
    setEntries((prev) => {
      const next = updater(prev);
      writeGuestBookmarks(next);
      return next;
    });
  };

  return {
    entries,
    isLoaded: true,
    storageMode: "guest",
    isBookmarked: (slug) => isBookmarkSaved(entries, slug),
    toggle: (slug, title) => {
      updateGuestEntries((prev) => {
        return isBookmarkSaved(prev, slug)
          ? prev.filter((entry) => entry.slug !== slug)
          : mergeBookmarkEntries([buildGuestBookmark(slug, title)], prev);
      });
    },
    remove: (slug) => {
      updateGuestEntries((prev) =>
        prev.filter((entry) => entry.slug !== slug),
      );
    },
  };
};

export const LocalBookmarkProvider = ({
  children,
}: {
  children: ReactNode;
}) => {
  const [entries, setEntries] = useState<BookmarkEntry[]>(() => readGuestBookmarks());

  const value = useMemo(() => {
    return createGuestBookmarkValue(entries, setEntries);
  }, [entries]);

  return (
    <BookmarkContext.Provider value={value}>{children}</BookmarkContext.Provider>
  );
};

export const HybridBookmarkProvider = ({
  children,
}: {
  children: ReactNode;
}) => {
  const { isLoaded: isClerkLoaded, isSignedIn, userId } = useAuth();
  const {
    isLoading: isConvexAuthLoading,
    isAuthenticated,
  } = useConvexAuth();
  const storageMode: BookmarkStorageMode = isSignedIn ? "account" : "guest";
  const userKey = userId ?? null;
  const canUseAccountApi = Boolean(userKey && isSignedIn && isAuthenticated);

  const [state, dispatch] = useReducer(
    hybridBookmarkReducer,
    initialHybridBookmarkState,
  );

  const previousUserKeyRef = useRef<string | null>(null);
  const pendingMutationSlugsRef = useRef(new Set<string>());
  const attemptedImportSignatureRef = useRef<string | null>(null);
  const importInFlightSignatureRef = useRef<string | null>(null);

  const remoteEntries = useQuery(
    api.bookmarks.listViewerBookmarks,
    canUseAccountApi ? {} : "skip",
  );
  const saveViewerBookmark = useMutation(api.bookmarks.saveViewerBookmark);
  const removeViewerBookmark = useMutation(api.bookmarks.removeViewerBookmark);
  const importGuestBookmarks = useMutation(api.bookmarks.importGuestBookmarks);

  useEffect(() => {
    if (!isClerkLoaded) {
      dispatch({ type: "reset" });
      return;
    }

    if (!isSignedIn || !userKey) {
      if (previousUserKeyRef.current) {
        clearAccountMirrorBookmarks(previousUserKeyRef.current);
      }

      previousUserKeyRef.current = null;
      attemptedImportSignatureRef.current = null;
      importInFlightSignatureRef.current = null;
      dispatch({ type: "guest", entries: readGuestBookmarks() });
      return;
    }

    if (
      previousUserKeyRef.current &&
      previousUserKeyRef.current !== userKey
    ) {
      clearAccountMirrorBookmarks(previousUserKeyRef.current);
    }

    previousUserKeyRef.current = userKey;
    attemptedImportSignatureRef.current = null;
    importInFlightSignatureRef.current = null;
    dispatch({
      type: "accountMirror",
      entries: readAccountMirrorBookmarks(userKey),
    });
  }, [isClerkLoaded, isSignedIn, userKey]);

  useEffect(() => {
    if (!isClerkLoaded || !isSignedIn || !userKey) {
      return;
    }

    if (!isConvexAuthLoading && !isAuthenticated) {
      dispatch({ type: "convexUnavailable" });
    }
  }, [isAuthenticated, isClerkLoaded, isConvexAuthLoading, isSignedIn, userKey]);

  useEffect(() => {
    if (!canUseAccountApi || !userKey || remoteEntries === undefined) {
      return;
    }

    dispatch({ type: "syncRemote", remoteEntries });

    const unclaimedGuestEntries = getUnclaimedGuestBookmarks(
      readGuestBookmarks(),
      readClaimedImportSlugs(userKey),
    );
    const importSignature = buildImportSignature(userKey, unclaimedGuestEntries);

    if (
      importSignature &&
      importInFlightSignatureRef.current === importSignature
    ) {
      dispatch({ type: "startImport" });
      return;
    }

    if (
      importSignature &&
      attemptedImportSignatureRef.current !== importSignature &&
      !importInFlightSignatureRef.current
    ) {
      attemptedImportSignatureRef.current = importSignature;
      importInFlightSignatureRef.current = importSignature;
      dispatch({ type: "startImport" });

      void importGuestBookmarks({ entries: unclaimedGuestEntries })
        .then(() => {
          if (previousUserKeyRef.current !== userKey) {
            return;
          }

          addClaimedImportSlugs(
            userKey,
            unclaimedGuestEntries.map((entry) => entry.slug),
          );
          dispatch({
            type: "importSuccess",
            importedEntries: unclaimedGuestEntries,
            remoteEntries,
          });
        })
        .catch(() => {
          if (previousUserKeyRef.current !== userKey) {
            return;
          }

          dispatch({ type: "importFailure", remoteEntries });
        })
        .finally(() => {
          importInFlightSignatureRef.current = null;
        });
    }
  }, [
    canUseAccountApi,
    dispatch,
    importGuestBookmarks,
    remoteEntries,
    userKey,
  ]);

  useEffect(() => {
    if (storageMode === "account" && userKey) {
      writeAccountMirrorBookmarks(userKey, state.entries);
    }
  }, [state.entries, storageMode, userKey]);

  const isBookmarked = useCallback(
    (slug: string) => isBookmarkSaved(state.entries, slug),
    [state.entries],
  );

  const toggle = useCallback(
    (slug: string, title: string) => {
      if (storageMode === "guest") {
        dispatch({
          type: "guest",
          entries: (() => {
            const next = isBookmarkSaved(state.entries, slug)
              ? state.entries.filter((entry) => entry.slug !== slug)
              : mergeBookmarkEntries(
                  [buildGuestBookmark(slug, title)],
                  state.entries,
                );
            writeGuestBookmarks(next);
            return next;
          })(),
        });
        return;
      }

      if (!userKey || !canUseAccountApi) {
        return;
      }

      if (pendingMutationSlugsRef.current.has(slug)) {
        return;
      }
      pendingMutationSlugsRef.current.add(slug);

      if (isBookmarkSaved(state.entries, slug)) {
        void removeViewerBookmark({ slug })
          .then(() => {
            if (previousUserKeyRef.current !== userKey) {
              return;
            }

            dispatch({ type: "removeAccount", slug });
          })
          .finally(() => {
            pendingMutationSlugsRef.current.delete(slug);
          });
        return;
      }

      void saveViewerBookmark({ slug, title })
        .then((savedEntry) => {
          if (previousUserKeyRef.current !== userKey) {
            return;
          }

          if (readGuestBookmarks().some((entry) => entry.slug === slug)) {
            addClaimedImportSlugs(userKey, [slug]);
          }

          dispatch({ type: "saveAccount", entry: savedEntry });
        })
        .finally(() => {
          pendingMutationSlugsRef.current.delete(slug);
        });
    },
    [
      canUseAccountApi,
      removeViewerBookmark,
      saveViewerBookmark,
      state.entries,
      storageMode,
      userKey,
    ],
  );

  const remove = useCallback(
    (slug: string) => {
      if (storageMode === "guest") {
        const next = state.entries.filter((entry) => entry.slug !== slug);
        writeGuestBookmarks(next);
        dispatch({ type: "guest", entries: next });
        return;
      }

      if (!userKey || !canUseAccountApi) {
        return;
      }

      if (pendingMutationSlugsRef.current.has(slug)) {
        return;
      }
      pendingMutationSlugsRef.current.add(slug);

      void removeViewerBookmark({ slug })
        .then(() => {
          if (previousUserKeyRef.current !== userKey) {
            return;
          }

          dispatch({ type: "removeAccount", slug });
        })
        .finally(() => {
          pendingMutationSlugsRef.current.delete(slug);
        });
    },
    [canUseAccountApi, removeViewerBookmark, state.entries, storageMode, userKey],
  );

  const value = useMemo<BookmarkContextValue>(
    () => ({
      entries: state.entries,
      isLoaded: state.isLoaded,
      storageMode,
      isBookmarked,
      toggle,
      remove,
    }),
    [isBookmarked, remove, state.entries, state.isLoaded, storageMode, toggle],
  );

  return (
    <BookmarkContext.Provider value={value}>{children}</BookmarkContext.Provider>
  );
};

export const useBookmarks = (): BookmarkContextValue => {
  const context = useContext(BookmarkContext);

  if (!context) {
    throw new Error("useBookmarks() must be used within a BookmarkProvider");
  }

  return context;
};
