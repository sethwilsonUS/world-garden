// @vitest-environment jsdom

import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { useAudioElement } from "@/hooks/useAudioElement";
import { applyPlaybackRate, keepPlaybackRate } from "./media-playback-rate";

Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });

describe("applyPlaybackRate", () => {
  it("sets the default as well, so a new source loads at the chosen speed", () => {
    const audio = document.createElement("audio");
    applyPlaybackRate(audio, 1.5);
    expect(audio.playbackRate).toBe(1.5);
    expect(audio.defaultPlaybackRate).toBe(1.5);
  });

  it("ignores impossible speeds", () => {
    const audio = document.createElement("audio");
    applyPlaybackRate(audio, Number.NaN);
    applyPlaybackRate(audio, 0);
    expect(audio.playbackRate).toBe(1);
  });
});

describe("keepPlaybackRate", () => {
  it("puts the chosen speed back after the element drifts", () => {
    const audio = document.createElement("audio");
    let rate = 1.5;
    const stop = keepPlaybackRate(audio, () => rate);

    for (const type of ["loadedmetadata", "play", "seeked", "ratechange"]) {
      audio.playbackRate = 1;
      audio.dispatchEvent(new Event(type));
      expect(audio.playbackRate).toBe(1.5);
    }

    rate = 2;
    audio.dispatchEvent(new Event("playing"));
    expect(audio.playbackRate).toBe(2);

    stop();
    audio.playbackRate = 1;
    audio.dispatchEvent(new Event("play"));
    expect(audio.playbackRate).toBe(1);
  });
});

describe("useAudioElement speed", () => {
  let container: HTMLDivElement;
  let root: Root;
  let latestAudio: HTMLAudioElement | null = null;

  const Player = ({ url, rate }: { url: string; rate: number }) => {
    const { audioRef } = useAudioElement({ url, playbackRate: rate });
    return (
      <audio
        ref={(element) => {
          audioRef.current = element;
          latestAudio = element;
        }}
        src={url}
      />
    );
  };

  beforeEach(() => {
    container = document.createElement("div");
    document.body.appendChild(container);
    root = createRoot(container);
  });

  afterEach(() => {
    act(() => root.unmount());
    container.remove();
    latestAudio = null;
  });

  it("keeps a playing section at the displayed speed after a reset", () => {
    act(() => root.render(<Player url="blob:section-0" rate={1.5} />));
    const audio = latestAudio!;
    expect(audio.playbackRate).toBe(1.5);

    // A browser resetting the speed on a new source or on play, with no
    // change to the displayed speed, used to leave it at 1x.
    act(() => root.render(<Player url="blob:section-1" rate={1.5} />));
    audio.playbackRate = 1;
    act(() => audio.dispatchEvent(new Event("play")));
    expect(audio.playbackRate).toBe(1.5);
    expect(audio.defaultPlaybackRate).toBe(1.5);

    act(() => root.render(<Player url="blob:section-1" rate={2} />));
    audio.playbackRate = 1;
    act(() => audio.dispatchEvent(new Event("ratechange")));
    expect(audio.playbackRate).toBe(2);
  });
});
