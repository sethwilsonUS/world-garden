import { describe, expect, it } from "vitest";
import {
  buildCachedTtsResult,
  createIdleAudioPlayback,
} from "./article-audio-playback";
import {
  getActiveTtsProfile,
  getTtsMetadata,
  getTtsProfile,
} from "./tts-profile";

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
  it("uses the caller's expected profile when legacy metadata is missing", () => {
    const expected = getTtsMetadata(getTtsProfile("openai"));

    expect(
      buildCachedTtsResult(
        "https://audio.test/summary.mp3",
        undefined,
        expected,
      ),
    ).toEqual({
      url: "https://audio.test/summary.mp3",
      metadata: expected,
    });
  });

  it("returns null when the cache has no URL", () => {
    const fallback = getTtsMetadata(getActiveTtsProfile());
    expect(buildCachedTtsResult(undefined, undefined, fallback)).toBeNull();
  });

  it("uses the expected profile when cached metadata is missing", () => {
    const fallback = getTtsMetadata(getActiveTtsProfile());
    expect(
      buildCachedTtsResult(
        "https://audio.test/summary.mp3",
        undefined,
        fallback,
      ),
    ).toEqual({
      url: "https://audio.test/summary.mp3",
      metadata: fallback,
    });
  });

  it("falls back for blank fields and an unknown provider", () => {
    const fallback = getTtsMetadata(getActiveTtsProfile());

    expect(
      buildCachedTtsResult(
        "https://audio.test/summary.mp3",
        {
          provider: "unknown",
          model: " ",
          voiceId: "\t",
          promptVersion: "",
          ttsNormVersion: "  ",
          ttsCacheKey: "",
        },
        fallback,
      ),
    ).toEqual({
      url: "https://audio.test/summary.mp3",
      metadata: fallback,
    });
  });
});
