import type { Section } from "@/lib/data-context";
import { hasFullAudio } from "@/lib/audio-suitability";
import type { TtsAudioUrlResult } from "@/lib/tts-client";
import {
  getActiveTtsProfile,
  getTtsMetadata,
  normalizeTtsProvider,
} from "@/lib/tts-profile";

export type AudioPlaybackStatus =
  | "idle"
  | "loading"
  | "playing"
  | "paused"
  | "error";

export type AudioPlaybackMode = "single" | "play_all";

export type AudioPlaybackState = {
  status: AudioPlaybackStatus;
  sectionKey: string | null;
  sectionIdx: number | null;
  label: string | null;
  mode: AudioPlaybackMode;
  slowLoading: boolean;
};

export type QueueItem = {
  sectionKey: string;
  label: string;
  sectionIdx: number | null;
};

export type AudioRetryTarget = QueueItem & {
  ariaLabel: string;
};

export type CachedTtsMetadata = Record<string, string> | undefined;

export const createIdleAudioPlayback = (): AudioPlaybackState => ({
  status: "idle",
  sectionKey: null,
  sectionIdx: null,
  label: null,
  mode: "single",
  slowLoading: false,
});

export const buildPlayAllQueue = (
  sections: Section[],
  articleTitle: string,
): QueueItem[] => {
  const queue: QueueItem[] = [{
    sectionKey: "summary",
    label: `${articleTitle} \u2014 Summary`,
    sectionIdx: null,
  }];
  sections.forEach((section, index) => {
    if (hasFullAudio(section)) {
      queue.push({
        sectionKey: `section-${index}`,
        label: `${section.title} \u2014 ${articleTitle}`,
        sectionIdx: index,
      });
    }
  });
  return queue;
};

export const getAudioRetryTarget = (
  playback: AudioPlaybackState,
  articleTitle: string,
): AudioRetryTarget => {
  if (
    playback.status === "error" &&
    playback.sectionKey &&
    playback.sectionKey !== "summary" &&
    playback.sectionIdx !== null
  ) {
    const label = playback.label ?? `${articleTitle} \u2014 Section`;
    return {
      sectionKey: playback.sectionKey,
      sectionIdx: playback.sectionIdx,
      label,
      ariaLabel: `Try generating audio for ${label} again`,
    };
  }

  return {
    sectionKey: "summary",
    sectionIdx: null,
    label: `${articleTitle} \u2014 Summary`,
    ariaLabel: "Try generating summary audio again",
  };
};

const textOrFallback = (
  value: string | undefined,
  fallback: string,
): string => {
  const trimmed = value?.trim();
  return trimmed || fallback;
};

export const buildCachedTtsResult = (
  url: string | undefined,
  metadata: CachedTtsMetadata,
): TtsAudioUrlResult | null => {
  if (!url) return null;

  const fallback = getTtsMetadata(getActiveTtsProfile());
  return {
    url,
    metadata: {
      provider: normalizeTtsProvider(metadata?.provider) ?? fallback.provider,
      model: textOrFallback(metadata?.model, fallback.model),
      voiceId: textOrFallback(metadata?.voiceId, fallback.voiceId),
      promptVersion: textOrFallback(
        metadata?.promptVersion,
        fallback.promptVersion,
      ),
      ttsNormVersion: textOrFallback(
        metadata?.ttsNormVersion,
        fallback.ttsNormVersion,
      ),
      ttsCacheKey: textOrFallback(metadata?.ttsCacheKey, fallback.ttsCacheKey),
    },
  };
};
