"use client";

import { useSyncExternalStore } from "react";

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

const listeners = new Set<() => void>();
let currentRate: PlaybackRate = DEFAULT_RATE;
// A browser can allow reads while rejecting writes (for example, at quota).
let hasUnsavedRate = false;

function readStoredRate(): PlaybackRate {
  let raw: string | null = null;
  try {
    raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) {
      raw = localStorage.getItem(LEGACY_KEY);
      if (raw) {
        localStorage.setItem(STORAGE_KEY, raw);
        localStorage.removeItem(LEGACY_KEY);
      }
    }
  } catch (error) {
    console.debug("Could not read or migrate the playback speed.", error);
    if (raw === null) return currentRate;
  }
  const parsed = Number.parseFloat(raw ?? "");
  return PLAYBACK_RATES.includes(parsed as PlaybackRate)
    ? (parsed as PlaybackRate)
    : DEFAULT_RATE;
}

function publish(rate: PlaybackRate) {
  currentRate = rate;
  for (const notify of listeners) notify();
}

function handleStorage(event: StorageEvent) {
  if (
    event.key === STORAGE_KEY ||
    event.key === LEGACY_KEY ||
    event.key === null
  ) {
    hasUnsavedRate = false;
    publish(readStoredRate());
  }
}

function subscribe(notify: () => void) {
  if (!listeners.size) {
    if (!hasUnsavedRate) currentRate = readStoredRate();
    window.addEventListener("storage", handleStorage);
  }
  listeners.add(notify);
  return () => {
    listeners.delete(notify);
    if (!listeners.size) window.removeEventListener("storage", handleStorage);
  };
}

function setRate(rate: PlaybackRate) {
  try {
    localStorage.setItem(STORAGE_KEY, String(rate));
    hasUnsavedRate = false;
  } catch (error) {
    console.debug("Could not save the playback speed.", error);
    hasUnsavedRate = true;
  }
  publish(rate);
}

function cycleRate() {
  const next = getNextPlaybackRate(currentRate);
  setRate(next);
  return next;
}

const getSnapshot = () => currentRate;
const getServerSnapshot = () => DEFAULT_RATE;

export const usePlaybackRate = () => {
  const rate = useSyncExternalStore(subscribe, getSnapshot, getServerSnapshot);
  return { rate, setRate, cycleRate } as const;
};

export const formatRate = (rate: number): string => {
  return `${rate}x`;
};
