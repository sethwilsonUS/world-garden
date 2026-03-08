"use client";

const SESSION_KEY = "curio-garden-trending-brief-warmup-v1";

type TrendingBriefResponse = {
  enabled?: boolean;
  brief?: {
    audioUrl: string | null;
  };
};

let warmupPromise: Promise<void> | null = null;
const warmedAudioUrls = new Set<string>();
const warmAudioElements: HTMLAudioElement[] = [];

const shouldWarmAudioBytes = (): boolean => {
  if (typeof navigator === "undefined") return false;

  const connection = (
    navigator as Navigator & {
      connection?: { saveData?: boolean; effectiveType?: string };
    }
  ).connection;

  if (connection?.saveData) return false;
  if (connection?.effectiveType?.includes("2g")) return false;

  return true;
};

const markSessionWarmed = () => {
  try {
    sessionStorage.setItem(SESSION_KEY, "1");
  } catch {
    // Ignore storage failures.
  }
};

const alreadyWarmedThisSession = (): boolean => {
  try {
    return sessionStorage.getItem(SESSION_KEY) === "1";
  } catch {
    return false;
  }
};

const prefetchTrendingBriefAudio = (audioUrl: string | null | undefined) => {
  if (!audioUrl || warmedAudioUrls.has(audioUrl) || !shouldWarmAudioBytes()) {
    return;
  }

  warmedAudioUrls.add(audioUrl);

  const audio = new Audio();
  audio.preload = "metadata";
  audio.src = audioUrl;
  warmAudioElements.push(audio);
};

export const warmTrendingBrief = (): Promise<void> => {
  if (typeof window === "undefined") return Promise.resolve();
  if (alreadyWarmedThisSession()) return Promise.resolve();
  if (warmupPromise) return warmupPromise;

  warmupPromise = (async () => {
    try {
      const response = await fetch("/api/trending/brief");
      if (!response.ok) return;

      const data = (await response.json()) as TrendingBriefResponse;
      prefetchTrendingBriefAudio(data.brief?.audioUrl);
      markSessionWarmed();
    } catch {
      // Non-critical background enhancement.
    }
  })().finally(() => {
    warmupPromise = null;
  });

  return warmupPromise;
};
