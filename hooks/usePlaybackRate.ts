"use client";

import { useSyncExternalStore } from "react";

const STORAGE_KEY = "curio-garden-playback-rate";
const LEGACY_KEY = "world-garden-playback-rate";
const DEFAULT_RATE = 1;

/**
 * Browsers mute media audio below 0.5x and above 4x, so speed stays inside
 * that window. Saved speeds can be any multiple of 0.05x, which keeps the
 * older 1.25x and 1.75x presets valid; Slower and Faster move by 0.1x.
 */
export const MIN_PLAYBACK_RATE = 0.5;
export const MAX_PLAYBACK_RATE = 4;
export const PLAYBACK_RATE_STEP = 0.1;
export type PlaybackRate = number;

const EPSILON = 1e-6;

/** "1x", "1.3x", "1.25x" — trims floating-point noise and trailing zeros. */
export const formatRate = (rate: number): string => {
  return `${Number(rate.toFixed(2))}x`;
};

/** A supported speed, or null for anything off the 0.05x grid or out of range. */
export const normalizePlaybackRate = (value: number): PlaybackRate | null => {
  if (!Number.isFinite(value)) return null;
  const snapped = Math.round(value * 20) / 20;
  if (Math.abs(snapped - value) > EPSILON) return null;
  if (snapped < MIN_PLAYBACK_RATE || snapped > MAX_PLAYBACK_RATE) return null;
  return snapped;
};

/**
 * One 0.1x step slower or faster, landing on the 0.1x grid: 1.25x goes to
 * 1.3x or 1.2x. The result is clamped to the supported range.
 */
export const stepPlaybackRate = (
  rate: PlaybackRate,
  direction: 1 | -1,
): PlaybackRate => {
  const tenths = rate / PLAYBACK_RATE_STEP;
  const next =
    direction > 0
      ? Math.floor(tenths + EPSILON) + 1
      : Math.ceil(tenths - EPSILON) - 1;
  const stepped = Math.round(next) / 10;
  return Math.min(MAX_PLAYBACK_RATE, Math.max(MIN_PLAYBACK_RATE, stepped));
};

/** Status text after a speed change, including when a limit stops it. */
export const describePlaybackRateChange = (
  previous: PlaybackRate,
  next: PlaybackRate,
  direction?: 1 | -1,
): string => {
  if (direction && next === previous) {
    return direction > 0
      ? `Already at the fastest speed, ${formatRate(next)}`
      : `Already at the slowest speed, ${formatRate(next)}`;
  }
  return `Playback speed ${formatRate(next)}`;
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
  return normalizePlaybackRate(Number.parseFloat(raw ?? "")) ?? DEFAULT_RATE;
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

function setRate(requested: PlaybackRate) {
  const rate = normalizePlaybackRate(requested) ?? currentRate;
  try {
    localStorage.setItem(STORAGE_KEY, String(rate));
    hasUnsavedRate = false;
  } catch (error) {
    console.debug("Could not save the playback speed.", error);
    hasUnsavedRate = true;
  }
  publish(rate);
}

const getSnapshot = () => currentRate;
const getServerSnapshot = (): PlaybackRate => DEFAULT_RATE;

export const usePlaybackRate = () => {
  const rate = useSyncExternalStore(subscribe, getSnapshot, getServerSnapshot);
  return { rate, setRate } as const;
};

