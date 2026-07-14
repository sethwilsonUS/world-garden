"use client";

import { useCallback, useMemo, useState } from "react";
import type { BookmarkControllerValue } from "./bookmark-controller";
import {
  readGuestBookmarks,
  writeGuestBookmarks,
} from "@/lib/bookmark-storage";
import {
  isBookmarkSaved,
  type BookmarkEntry,
} from "@/lib/bookmarks";
import {
  removeGuestBookmarkEntry,
  toggleGuestBookmarkEntries,
} from "@/lib/bookmark-state";

export const useGuestBookmarkController = (): BookmarkControllerValue => {
  const [entries, setEntries] = useState<BookmarkEntry[]>(() =>
    readGuestBookmarks(),
  );

  const updateEntries = useCallback(
    (updater: (current: BookmarkEntry[]) => BookmarkEntry[]) => {
      setEntries((current) => {
        const next = updater(current);
        writeGuestBookmarks(next);
        return next;
      });
    },
    [],
  );

  const isBookmarked = useCallback(
    (slug: string) => isBookmarkSaved(entries, slug),
    [entries],
  );

  const toggle = useCallback(
    (slug: string, title: string) => {
      updateEntries((current) =>
        toggleGuestBookmarkEntries(current, slug, title),
      );
    },
    [updateEntries],
  );

  const remove = useCallback(
    (slug: string) => {
      updateEntries((current) => removeGuestBookmarkEntry(current, slug));
    },
    [updateEntries],
  );

  return useMemo(
    () => ({
      entries,
      isLoaded: true,
      storageMode: "guest" as const,
      isBookmarked,
      toggle,
      remove,
    }),
    [entries, isBookmarked, remove, toggle],
  );
};
