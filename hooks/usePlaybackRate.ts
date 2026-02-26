"use client";

import { useState, useCallback } from "react";

const STORAGE_KEY = "curio-garden-playback-rate";
const LEGACY_KEY = "world-garden-playback-rate";
const DEFAULT_RATE = 1;

export const PLAYBACK_RATES = [0.5, 0.75, 1, 1.25, 1.5, 1.75, 2, 2.5, 3] as const;
export type PlaybackRate = (typeof PLAYBACK_RATES)[number];

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

const readStoredRate = (): PlaybackRate => {
  if (typeof window === "undefined") return DEFAULT_RATE;
  migrateLegacyKey();
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (raw === null) return DEFAULT_RATE;
    const parsed = parseFloat(raw);
    if (PLAYBACK_RATES.includes(parsed as PlaybackRate)) {
      return parsed as PlaybackRate;
    }
  } catch {
    // localStorage unavailable (private browsing, etc.)
  }
  return DEFAULT_RATE;
};

export const usePlaybackRate = () => {
  const [rate, setRateState] = useState<PlaybackRate>(readStoredRate);

  const setRate = useCallback((newRate: PlaybackRate) => {
    setRateState(newRate);
    try {
      localStorage.setItem(STORAGE_KEY, String(newRate));
    } catch {
      // localStorage unavailable
    }
  }, []);

  const cycleRate = useCallback(() => {
    setRateState((current) => {
      const idx = PLAYBACK_RATES.indexOf(current);
      const next = PLAYBACK_RATES[(idx + 1) % PLAYBACK_RATES.length];
      try {
        localStorage.setItem(STORAGE_KEY, String(next));
      } catch {
        // localStorage unavailable
      }
      return next;
    });
  }, []);

  return { rate, setRate, cycleRate } as const;
};

export const formatRate = (rate: number): string => {
  return `${rate}x`;
};
