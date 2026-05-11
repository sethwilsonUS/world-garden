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

export type AudioRequestOwner = "warm" | "playback";

export type AudioRequestCacheEntry = {
  promise: Promise<TtsAudioUrlResult>;
  result: TtsAudioUrlResult | null;
  startedAt: number;
  owner: AudioRequestOwner;
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
    startedAt: Date.now(),
    owner: "playback",
  });
};

export const getAudioRequestResult = (
  cache: AudioRequestCache,
  sectionKey: string,
): TtsAudioUrlResult | null => cache.get(sectionKey)?.result ?? null;

export const clearAudioRequest = (
  cache: AudioRequestCache,
  sectionKey: string,
): void => {
  cache.delete(sectionKey);
};

export const awaitAudioRequest = (
  cache: AudioRequestCache,
  sectionKey: string,
  options: {
    timeoutMs?: number;
    staleAfterMs?: number;
    clearOnTimeout?: boolean;
  } = {},
): Promise<TtsAudioUrlResult | null> | null => {
  const entry = cache.get(sectionKey);
  if (!entry) return null;

  const request = entry.promise.catch(() => null);
  const staleAfterMs =
    typeof options.staleAfterMs === "number" && options.staleAfterMs > 0
      ? options.staleAfterMs
      : null;
  const timeoutMs =
    staleAfterMs !== null
      ? Math.max(0, staleAfterMs - Math.max(0, Date.now() - entry.startedAt))
      : typeof options.timeoutMs === "number" && options.timeoutMs > 0
        ? options.timeoutMs
        : null;

  if (timeoutMs === null) return request;

  if (timeoutMs === 0) {
    if (options.clearOnTimeout && cache.get(sectionKey) === entry) {
      cache.delete(sectionKey);
    }
    return Promise.resolve(null);
  }

  let timeoutId: ReturnType<typeof setTimeout> | null = null;
  const timeout = new Promise<null>((resolve) => {
    timeoutId = setTimeout(() => {
      if (options.clearOnTimeout && cache.get(sectionKey) === entry) {
        cache.delete(sectionKey);
      }
      resolve(null);
    }, timeoutMs);
  });

  return Promise.race([request, timeout]).finally(() => {
    if (timeoutId) clearTimeout(timeoutId);
  });
};

export const startAudioRequest = (
  cache: AudioRequestCache,
  sectionKey: string,
  generate: () => Promise<TtsAudioUrlResult>,
  options: { force?: boolean; owner?: AudioRequestOwner } = {},
): Promise<TtsAudioUrlResult> => {
  const existing = cache.get(sectionKey);
  if (existing && !options.force) return existing.promise;

  const entry: AudioRequestCacheEntry = {
    promise: Promise.resolve().then(generate),
    result: null,
    startedAt: Date.now(),
    owner: options.owner ?? "playback",
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
  startAudioRequest(cache, sectionKey, generate, { owner: "warm" }).catch(() => null);

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
