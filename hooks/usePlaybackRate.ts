"use client";

import { useCallback, useEffect, useRef, useState } from "react";

const STORAGE_KEY = "curio-garden-playback-rate";
const LEGACY_KEY = "world-garden-playback-rate";
const DEFAULT_RATE = 1;

export const PLAYBACK_RATES = [
  0.5, 0.75, 1, 1.25, 1.5, 1.75, 2, 2.5, 3,
] as const;
export type PlaybackRate = (typeof PLAYBACK_RATES)[number];

export const getNextPlaybackRate = (rate: PlaybackRate): PlaybackRate => {
  const currentIndex = PLAYBACK_RATES.indexOf(rate);
  return PLAYBACK_RATES[(currentIndex + 1) % PLAYBACK_RATES.length];
};

const migrateLegacyKey = () => {
  if (typeof window === "undefined") return;
  try {
    if (
      !localStorage.getItem(STORAGE_KEY) &&
      localStorage.getItem(LEGACY_KEY)
    ) {
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
  const [rate, setRateState] = useState<PlaybackRate>(DEFAULT_RATE);
  const rateRef = useRef<PlaybackRate>(DEFAULT_RATE);

  useEffect(() => {
    let active = true;
    // Defer the storage-driven update to satisfy react-hooks/set-state-in-effect
    // while keeping the first client render hydration-safe.
    queueMicrotask(() => {
      if (!active) return;
      const storedRate = readStoredRate();
      rateRef.current = storedRate;
      setRateState(storedRate);
    });
    return () => {
      active = false;
    };
  }, []);

  const setRate = useCallback((newRate: PlaybackRate) => {
    rateRef.current = newRate;
    setRateState(newRate);
    try {
      localStorage.setItem(STORAGE_KEY, String(newRate));
    } catch {
      // localStorage unavailable
    }
  }, []);

  const cycleRate = useCallback(() => {
    const next = getNextPlaybackRate(rateRef.current);
    setRate(next);
    return next;
  }, [setRate]);

  return { rate, setRate, cycleRate } as const;
};

export const formatRate = (rate: number): string => {
  return `${rate}x`;
};
