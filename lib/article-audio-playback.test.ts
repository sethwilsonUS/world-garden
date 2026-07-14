import { describe, expect, it } from "vitest";
import {
  buildCachedTtsResult,
  createIdleAudioPlayback,
} from "./article-audio-playback";
import { getActiveTtsProfile, getTtsMetadata } from "./tts-profile";

describe("createIdleAudioPlayback", () => {
  it("creates a fresh idle single-section playback state", () => {
    const first = createIdleAudioPlayback();
    const second = createIdleAudioPlayback();

    expect(first).toEqual({
      status: "idle",
      sectionKey: null,
      sectionIdx: null,
      label: null,
      mode: "single",
      slowLoading: false,
    });
    expect(second).not.toBe(first);
  });
});

describe("buildCachedTtsResult", () => {
  it("returns null when the cache has no URL", () => {
    expect(buildCachedTtsResult(undefined, undefined)).toBeNull();
  });

  it("uses the active profile when cached metadata is missing", () => {
    expect(buildCachedTtsResult("https://audio.test/summary.mp3", undefined)).toEqual({
      url: "https://audio.test/summary.mp3",
      metadata: getTtsMetadata(getActiveTtsProfile()),
    });
  });

  it("falls back for blank fields and an unknown provider", () => {
    const fallback = getTtsMetadata(getActiveTtsProfile());

    expect(buildCachedTtsResult("https://audio.test/summary.mp3", {
      provider: "unknown",
      model: " ",
      voiceId: "\t",
      promptVersion: "",
      ttsNormVersion: "  ",
      ttsCacheKey: "",
    })).toEqual({
      url: "https://audio.test/summary.mp3",
      metadata: fallback,
    });
  });
});
