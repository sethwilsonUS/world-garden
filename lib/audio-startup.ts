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

export const bucketAudioStartupMs = (durationMs: number): string => {
  if (durationMs < 250) return "<250ms";
  if (durationMs < 1000) return "250-999ms";
  if (durationMs < 3000) return "1-2.9s";
  if (durationMs < 6000) return "3-5.9s";
  return "6s+";
};

export const resolveSummaryAudioStartup = async ({
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
