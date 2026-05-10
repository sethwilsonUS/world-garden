import type { TtsAudioUrlResult } from "./tts-client";

export type AudioStartupPath = "memory" | "convex" | "prefetch" | "generated";
export type AudioStartupScope = "summary" | "section";
export type AudioStartupSource =
  | "play_all"
  | "summary"
  | "section"
  | "resume"
  | "start_over"
  | "auto_next"
  | "retry";

export type AudioStartupResolution = {
  path: AudioStartupPath;
  result: TtsAudioUrlResult;
};

export type AudioRequestCacheEntry = {
  promise: Promise<TtsAudioUrlResult>;
  result: TtsAudioUrlResult | null;
};

export type AudioRequestCache = Map<string, AudioRequestCacheEntry>;

export type WarmQueueItem = {
  sectionKey: string;
  sectionIdx: number | null;
  canWarm?: boolean;
};

export const createAudioRequestCache = (): AudioRequestCache => new Map();

export const primeAudioRequest = (
  cache: AudioRequestCache,
  sectionKey: string,
  result: TtsAudioUrlResult,
): void => {
  cache.set(sectionKey, {
    promise: Promise.resolve(result),
    result,
  });
};

export const getAudioRequestResult = (
  cache: AudioRequestCache,
  sectionKey: string,
): TtsAudioUrlResult | null => cache.get(sectionKey)?.result ?? null;

export const awaitAudioRequest = (
  cache: AudioRequestCache,
  sectionKey: string,
): Promise<TtsAudioUrlResult | null> | null => {
  const entry = cache.get(sectionKey);
  return entry?.promise.catch(() => null) ?? null;
};

export const startAudioRequest = (
  cache: AudioRequestCache,
  sectionKey: string,
  generate: () => Promise<TtsAudioUrlResult>,
): Promise<TtsAudioUrlResult> => {
  const existing = cache.get(sectionKey);
  if (existing) return existing.promise;

  const entry: AudioRequestCacheEntry = {
    promise: Promise.resolve().then(generate),
    result: null,
  };

  entry.promise = entry.promise
    .then((result) => {
      if (cache.get(sectionKey) === entry) {
        entry.result = result;
      }
      return result;
    })
    .catch((error) => {
      if (cache.get(sectionKey) === entry) {
        cache.delete(sectionKey);
      }
      throw error;
    });

  cache.set(sectionKey, entry);
  return entry.promise;
};

export const warmAudioRequest = (
  cache: AudioRequestCache,
  sectionKey: string,
  generate: () => Promise<TtsAudioUrlResult>,
): Promise<TtsAudioUrlResult | null> =>
  startAudioRequest(cache, sectionKey, generate).catch(() => null);

export const selectNextWarmQueueItems = <TItem extends WarmQueueItem>(
  queue: TItem[],
  limit = 2,
): TItem[] =>
  queue
    .filter((item) => item.sectionIdx !== null && item.canWarm !== false)
    .slice(0, limit);

export const bucketAudioStartupMs = (durationMs: number): string => {
  if (durationMs < 250) return "<250ms";
  if (durationMs < 1000) return "250-999ms";
  if (durationMs < 3000) return "1-2.9s";
  if (durationMs < 6000) return "3-5.9s";
  return "6s+";
};

export const resolveAudioStartup = async ({
  memory,
  convex,
  prefetched,
  inflight,
  generate,
}: {
  memory: TtsAudioUrlResult | null;
  convex: TtsAudioUrlResult | null;
  prefetched: TtsAudioUrlResult | null;
  inflight: Promise<TtsAudioUrlResult | null> | null;
  generate: () => Promise<TtsAudioUrlResult>;
}): Promise<AudioStartupResolution> => {
  if (memory) return { path: "memory", result: memory };
  if (convex) return { path: "convex", result: convex };
  if (prefetched) return { path: "prefetch", result: prefetched };

  const inflightResult = await inflight;
  if (inflightResult) return { path: "prefetch", result: inflightResult };

  return {
    path: "generated",
    result: await generate(),
  };
};

export const resolveSummaryAudioStartup = resolveAudioStartup;
