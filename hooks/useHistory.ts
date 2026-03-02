"use client";

import { useSyncExternalStore, useCallback } from "react";

const STORAGE_KEY = "curio-garden-history";
const LEGACY_KEY = "world-garden-history";
const MAX_ENTRIES = 20;

export type HistoryEntry = {
  slug: string;
  title: string;
  lastVisitedAt: number;
  lastSectionKey?: string;
  lastSectionIndex?: number | null;
};

const migrateLegacyKey = () => {
  try {
    if (!localStorage.getItem(STORAGE_KEY) && localStorage.getItem(LEGACY_KEY)) {
      localStorage.setItem(STORAGE_KEY, localStorage.getItem(LEGACY_KEY)!);
      localStorage.removeItem(LEGACY_KEY);
    }
  } catch {
    // localStorage unavailable
  }
};

// Cached snapshot so useSyncExternalStore gets a stable reference
const EMPTY: HistoryEntry[] = [];
let cachedRaw: string | null | undefined;
let cachedEntries: HistoryEntry[] = EMPTY;

function getSnapshot(): HistoryEntry[] {
  migrateLegacyKey();
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (raw !== cachedRaw) {
      cachedRaw = raw;
      if (!raw) {
        cachedEntries = EMPTY;
      } else {
        const parsed = JSON.parse(raw);
        cachedEntries = Array.isArray(parsed) ? parsed : EMPTY;
      }
    }
    return cachedEntries;
  } catch {
    return EMPTY;
  }
}

function getServerSnapshot(): HistoryEntry[] {
  return EMPTY;
}

let listeners: Array<() => void> = [];

function subscribe(listener: () => void) {
  listeners = [...listeners, listener];
  return () => {
    listeners = listeners.filter((l) => l !== listener);
  };
}

function emitChange() {
  for (const listener of listeners) {
    listener();
  }
}

function writeHistory(entries: HistoryEntry[]) {
  try {
    const sliced = entries.slice(0, MAX_ENTRIES);
    const raw = JSON.stringify(sliced);
    localStorage.setItem(STORAGE_KEY, raw);
    cachedRaw = raw;
    cachedEntries = sliced;
    emitChange();
  } catch {
    // localStorage unavailable
  }
}

export const useHistory = () => {
  const entries = useSyncExternalStore(subscribe, getSnapshot, getServerSnapshot);

  const recordVisit = useCallback((slug: string, title: string) => {
    const prev = getSnapshot();
    const filtered = prev.filter((e) => e.slug !== slug);
    const next: HistoryEntry[] = [
      { slug, title, lastVisitedAt: Date.now() },
      ...filtered,
    ].slice(0, MAX_ENTRIES);
    writeHistory(next);
  }, []);

  const updateProgress = useCallback(
    (slug: string, sectionKey: string, sectionIndex: number | null) => {
      const prev = getSnapshot();
      const next = prev.map((e) =>
        e.slug === slug
          ? { ...e, lastSectionKey: sectionKey, lastSectionIndex: sectionIndex }
          : e,
      );
      writeHistory(next);
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
    try {
      localStorage.removeItem(STORAGE_KEY);
      cachedRaw = null;
      cachedEntries = EMPTY;
      emitChange();
    } catch {
      // localStorage unavailable
    }
  }, []);

  return { entries, recordVisit, updateProgress, getProgress, clearHistory } as const;
};
