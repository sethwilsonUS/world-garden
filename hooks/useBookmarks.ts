"use client";

import { useState, useCallback } from "react";

const STORAGE_KEY = "curio-garden-bookmarks";
const LEGACY_KEY = "world-garden-bookmarks";

export type BookmarkEntry = {
  slug: string;
  title: string;
  savedAt: number;
};

const migrateLegacyKey = () => {
  if (typeof window === "undefined") return;
  try {
    if (!localStorage.getItem(STORAGE_KEY) && localStorage.getItem(LEGACY_KEY)) {
      localStorage.setItem(STORAGE_KEY, localStorage.getItem(LEGACY_KEY)!);
      localStorage.removeItem(LEGACY_KEY);
    }
  } catch {
    // localStorage unavailable
  }
};

const readBookmarks = (): BookmarkEntry[] => {
  if (typeof window === "undefined") return [];
  migrateLegacyKey();
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    return parsed;
  } catch {
    return [];
  }
};

const writeBookmarks = (entries: BookmarkEntry[]) => {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(entries));
  } catch {
    // localStorage unavailable
  }
};

export const useBookmarks = () => {
  const [entries, setEntries] = useState<BookmarkEntry[]>(readBookmarks);

  const isBookmarked = useCallback(
    (slug: string) => entries.some((e) => e.slug === slug),
    [entries],
  );

  const toggle = useCallback((slug: string, title: string) => {
    setEntries((prev) => {
      const exists = prev.some((e) => e.slug === slug);
      const next = exists
        ? prev.filter((e) => e.slug !== slug)
        : [{ slug, title, savedAt: Date.now() }, ...prev];
      writeBookmarks(next);
      return next;
    });
  }, []);

  const remove = useCallback((slug: string) => {
    setEntries((prev) => {
      const next = prev.filter((e) => e.slug !== slug);
      writeBookmarks(next);
      return next;
    });
  }, []);

  return { entries, isBookmarked, toggle, remove } as const;
};
