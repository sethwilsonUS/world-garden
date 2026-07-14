"use client";

import { useAuth } from "@clerk/nextjs";
import { useCallback, useMemo } from "react";
import { useConvexAuth, useMutation, useQuery } from "convex/react";
import type { BookmarkControllerValue } from "./bookmark-controller";
import {
  getBookmarkMutationKey,
  useBookmarkSynchronization,
} from "./useBookmarkSynchronization";
import { api } from "@/convex/_generated/api";
import {
  addClaimedImportSlugs,
  readGuestBookmarks,
  writeGuestBookmarks,
} from "@/lib/bookmark-storage";
import { isBookmarkSaved, type BookmarkStorageMode } from "@/lib/bookmarks";
import {
  removeGuestBookmarkEntry,
  toggleGuestBookmarkEntries,
} from "@/lib/bookmark-state";

export const useHybridBookmarkController = (): BookmarkControllerValue => {
  const { isLoaded: isClerkLoaded, isSignedIn, userId } = useAuth();
  const { isLoading: isConvexAuthLoading, isAuthenticated } = useConvexAuth();
  const storageMode: BookmarkStorageMode = isSignedIn ? "account" : "guest";
  const userKey = userId ?? null;
  const canUseAccountApi = Boolean(userKey && isSignedIn && isAuthenticated);

  const remoteEntries = useQuery(
    api.bookmarks.listViewerBookmarks,
    canUseAccountApi ? {} : "skip",
  );
  const saveViewerBookmark = useMutation(api.bookmarks.saveViewerBookmark);
  const removeViewerBookmark = useMutation(api.bookmarks.removeViewerBookmark);
  const importGuestBookmarks = useMutation(api.bookmarks.importGuestBookmarks);

  const {
    state,
    dispatch,
    activeUserKeyRef,
    pendingMutationKeysRef,
  } = useBookmarkSynchronization({
    isClerkLoaded,
    isSignedIn: Boolean(isSignedIn),
    isConvexAuthLoading,
    isAuthenticated,
    canUseAccountApi,
    userKey,
    remoteEntries,
    importGuestBookmarks,
  });

  const isBookmarked = useCallback(
    (slug: string) => isBookmarkSaved(state.entries, slug),
    [state.entries],
  );

  const toggle = useCallback(
    (slug: string, title: string) => {
      if (storageMode === "guest") {
        const next = toggleGuestBookmarkEntries(state.entries, slug, title);
        writeGuestBookmarks(next);
        dispatch({ type: "guest", entries: next });
        return;
      }

      if (!userKey || !canUseAccountApi) {
        return;
      }

      const mutationKey = getBookmarkMutationKey(userKey, slug);
      if (pendingMutationKeysRef.current.has(mutationKey)) {
        return;
      }
      pendingMutationKeysRef.current.add(mutationKey);

      if (isBookmarkSaved(state.entries, slug)) {
        void removeViewerBookmark({ slug })
          .then(() => {
            if (activeUserKeyRef.current === userKey) {
              dispatch({ type: "removeAccount", slug });
            }
          })
          .finally(() => {
            pendingMutationKeysRef.current.delete(mutationKey);
          });
        return;
      }

      void saveViewerBookmark({ slug, title })
        .then((savedEntry) => {
          if (activeUserKeyRef.current !== userKey) {
            return;
          }

          if (readGuestBookmarks().some((entry) => entry.slug === slug)) {
            addClaimedImportSlugs(userKey, [slug]);
          }

          dispatch({ type: "saveAccount", entry: savedEntry });
        })
        .finally(() => {
          pendingMutationKeysRef.current.delete(mutationKey);
        });
    },
    [
      activeUserKeyRef,
      canUseAccountApi,
      dispatch,
      pendingMutationKeysRef,
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
        const next = removeGuestBookmarkEntry(state.entries, slug);
        writeGuestBookmarks(next);
        dispatch({ type: "guest", entries: next });
        return;
      }

      if (!userKey || !canUseAccountApi) {
        return;
      }

      const mutationKey = getBookmarkMutationKey(userKey, slug);
      if (pendingMutationKeysRef.current.has(mutationKey)) {
        return;
      }
      pendingMutationKeysRef.current.add(mutationKey);

      void removeViewerBookmark({ slug })
        .then(() => {
          if (activeUserKeyRef.current === userKey) {
            dispatch({ type: "removeAccount", slug });
          }
        })
        .finally(() => {
          pendingMutationKeysRef.current.delete(mutationKey);
        });
    },
    [
      activeUserKeyRef,
      canUseAccountApi,
      dispatch,
      pendingMutationKeysRef,
      removeViewerBookmark,
      state.entries,
      storageMode,
      userKey,
    ],
  );

  return useMemo(
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
};
