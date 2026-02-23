"use client";

import { useState, useCallback } from "react";

const STORAGE_KEY = "world-garden-history";
const MAX_ENTRIES = 20;

export type HistoryEntry = {
  slug: string;
  title: string;
  lastVisitedAt: number;
  lastSectionKey?: string;
  lastSectionIndex?: number | null;
};

const readHistory = (): HistoryEntry[] => {
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

const writeHistory = (entries: HistoryEntry[]) => {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(entries.slice(0, MAX_ENTRIES)));
  } catch {
    // localStorage unavailable
  }
};

export const useHistory = () => {
  const [entries, setEntries] = useState<HistoryEntry[]>(readHistory);

  const recordVisit = useCallback((slug: string, title: string) => {
    setEntries((prev) => {
      const filtered = prev.filter((e) => e.slug !== slug);
      const next: HistoryEntry[] = [
        { slug, title, lastVisitedAt: Date.now() },
        ...filtered,
      ].slice(0, MAX_ENTRIES);
      writeHistory(next);
      return next;
    });
  }, []);

  const updateProgress = useCallback(
    (slug: string, sectionKey: string, sectionIndex: number | null) => {
      setEntries((prev) => {
        const next = prev.map((e) =>
          e.slug === slug
            ? { ...e, lastSectionKey: sectionKey, lastSectionIndex: sectionIndex }
            : e,
        );
        writeHistory(next);
        return next;
      });
    },
    [],
  );

  const getProgress = useCallback(
    (slug: string): HistoryEntry | undefined => {
      return entries.find((e) => e.slug === slug);
    },
    [entries],
  );

  const clearHistory = useCallback(() => {
    setEntries([]);
    try {
      localStorage.removeItem(STORAGE_KEY);
    } catch {
      // localStorage unavailable
    }
  }, []);

  return { entries, recordVisit, updateProgress, getProgress, clearHistory } as const;
};
