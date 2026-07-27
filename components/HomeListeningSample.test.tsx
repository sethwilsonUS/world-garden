// @vitest-environment jsdom

import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { renderToStaticMarkup } from "react-dom/server";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  HOME_LISTENING_SAMPLE_DURATION_SECONDS,
  HOME_LISTENING_SAMPLE_TRANSCRIPT,
  HOME_LISTENING_SAMPLE_URL,
  HomeListeningSample,
} from "./HomeListeningSample";

const analyticsMocks = vi.hoisted(() => ({
  listeningSampleCompleted: vi.fn(),
  listeningSampleStarted: vi.fn(),
}));

vi.mock("@/lib/analytics", () => ({
  analytics: analyticsMocks,
}));

Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });

const flushEffects = async () => {
  await act(async () => {
    await Promise.resolve();
  });
};

describe("HomeListeningSample", () => {
  let container: HTMLDivElement;
  let root: Root;

  const renderSample = async () => {
    await act(async () => {
      root.render(<HomeListeningSample />);
      await Promise.resolve();
    });

    const audio = container.querySelector("audio");
    expect(audio).toBeInstanceOf(HTMLAudioElement);
    return audio as HTMLAudioElement;
  };

  const buttonNamed = (name: string) => {
    const button = container.querySelector(`button[aria-label="${name}"]`);
    expect(button).toBeInstanceOf(HTMLButtonElement);
    return button as HTMLButtonElement;
  };

  const playbackError = () =>
    Array.from(container.querySelectorAll('[role="status"]')).find((status) =>
      status.textContent?.includes("The listening sample could not start."),
    );

  beforeEach(() => {
    analyticsMocks.listeningSampleCompleted.mockReset();
    analyticsMocks.listeningSampleStarted.mockReset();
    localStorage.clear();
    container = document.createElement("div");
    document.body.appendChild(container);
    root = createRoot(container);
  });

  afterEach(() => {
    act(() => root.unmount());
    container.remove();
    vi.restoreAllMocks();
  });

  it("offers an opt-in custom player with the shared progress treatment and transcript", () => {
    const markup = renderToStaticMarkup(<HomeListeningSample />);

    expect(markup).toContain("Listening sample");
    expect(markup).toContain("Start with a short listen");
    expect(markup).toContain(
      "Hear how a Wikipedia page becomes a clear listening path.",
    );
    expect(markup).not.toContain("No account or search needed");
    expect(markup).toContain(
      'aria-label="Curio Garden listening sample player"',
    );
    expect(markup).toContain('aria-label="Play listening sample"');
    expect(markup).toContain("border-border bg-surface-2");
    expect(markup).toContain("min-h-11");
    expect(markup).toContain('class="audio-progress-range block w-full"');
    expect(markup).toContain(`max="${HOME_LISTENING_SAMPLE_DURATION_SECONDS}"`);
    expect(markup).toContain("0:00");
    expect(markup).toContain("0:18");
    expect(markup).toContain(`src="${HOME_LISTENING_SAMPLE_URL}"`);
    expect(markup).toContain('preload="metadata"');
    expect(markup).toContain('aria-hidden="true"');
    expect(markup).toContain(' hidden=""');
    expect(markup).not.toContain(' controls=""');
    expect(markup).not.toContain("autoplay");
    expect(markup).not.toContain("autofocus");
    expect(markup).toContain("Synthetic voice · 18 seconds");
    expect(markup).toContain("Transcript");
    expect(markup).toContain(HOME_LISTENING_SAMPLE_TRANSCRIPT);
  });

  it("keeps the player idle and analytics quiet when play rejects or emits no media event", async () => {
    const play = vi
      .spyOn(HTMLMediaElement.prototype, "play")
      .mockImplementationOnce(() => {
        throw new DOMException("Playback blocked", "NotAllowedError");
      })
      .mockRejectedValueOnce(
        new DOMException("Playback blocked", "NotAllowedError"),
      )
      .mockResolvedValueOnce(undefined);
    await renderSample();

    act(() => buttonNamed("Play listening sample").click());
    expect(playbackError()?.textContent).toContain(
      "Try again, or download sample audio",
    );
    expect(
      playbackError()?.querySelector(
        `a[href="${HOME_LISTENING_SAMPLE_URL}"][download]`,
      ),
    ).not.toBeNull();

    await act(async () => {
      buttonNamed("Play listening sample").click();
      await Promise.resolve();
    });
    expect(playbackError()).not.toBeUndefined();
    expect(buttonNamed("Play listening sample")).not.toBeNull();
    expect(analyticsMocks.listeningSampleStarted).not.toHaveBeenCalled();

    await act(async () => {
      buttonNamed("Play listening sample").click();
      await Promise.resolve();
    });
    expect(play).toHaveBeenCalledTimes(3);
    expect(playbackError()).toBeUndefined();
    expect(buttonNamed("Play listening sample")).not.toBeNull();
    expect(analyticsMocks.listeningSampleStarted).not.toHaveBeenCalled();
    expect(analyticsMocks.listeningSampleCompleted).not.toHaveBeenCalled();
  });

  it("announces an audio resource failure and offers the download fallback", async () => {
    const audio = await renderSample();

    act(() => audio.dispatchEvent(new Event("error")));

    expect(playbackError()?.textContent).toContain(
      "The listening sample could not start.",
    );
    expect(
      playbackError()?.querySelector(
        `a[href="${HOME_LISTENING_SAMPLE_URL}"][download]`,
      ),
    ).not.toBeNull();
  });

  it("records a start only after the media element reports actual playback", async () => {
    vi.spyOn(HTMLMediaElement.prototype, "play").mockImplementation(function (
      this: HTMLMediaElement,
    ) {
      this.dispatchEvent(new Event("play"));
      return Promise.resolve();
    });
    const audio = await renderSample();

    act(() => buttonNamed("Play listening sample").click());
    expect(buttonNamed("Pause listening sample")).not.toBeNull();
    expect(analyticsMocks.listeningSampleStarted).not.toHaveBeenCalled();

    act(() => audio.dispatchEvent(new Event("playing", { bubbles: true })));
    expect(analyticsMocks.listeningSampleStarted).toHaveBeenCalledTimes(1);
  });

  it("plays, pauses, and resumes without counting a resume as another start", async () => {
    const play = vi
      .spyOn(HTMLMediaElement.prototype, "play")
      .mockImplementation(function (this: HTMLMediaElement) {
        this.dispatchEvent(new Event("play"));
        this.dispatchEvent(new Event("playing", { bubbles: true }));
        return Promise.resolve();
      });
    const pause = vi
      .spyOn(HTMLMediaElement.prototype, "pause")
      .mockImplementation(function (this: HTMLMediaElement) {
        this.dispatchEvent(new Event("pause"));
      });
    await renderSample();

    act(() => buttonNamed("Play listening sample").click());
    expect(buttonNamed("Pause listening sample")).not.toBeNull();
    expect(analyticsMocks.listeningSampleStarted).toHaveBeenCalledTimes(1);

    act(() => buttonNamed("Pause listening sample").click());
    expect(buttonNamed("Resume listening sample")).not.toBeNull();

    act(() => buttonNamed("Resume listening sample").click());
    expect(buttonNamed("Pause listening sample")).not.toBeNull();
    expect(play).toHaveBeenCalledTimes(2);
    expect(pause).toHaveBeenCalledTimes(1);
    expect(analyticsMocks.listeningSampleStarted).toHaveBeenCalledTimes(1);
    expect(analyticsMocks.listeningSampleCompleted).not.toHaveBeenCalled();
  });

  it("uses media metadata when available and seeks through the shared range", async () => {
    const audio = await renderSample();
    Object.defineProperty(audio, "duration", {
      configurable: true,
      value: 23.75,
    });

    act(() => audio.dispatchEvent(new Event("loadedmetadata")));
    const range = container.querySelector(
      'input[aria-label="Playback position"]',
    );
    expect(range).toBeInstanceOf(HTMLInputElement);
    const progress = range as HTMLInputElement;
    expect(progress.max).toBe("23.75");

    act(() => {
      const valueSetter = Object.getOwnPropertyDescriptor(
        HTMLInputElement.prototype,
        "value",
      )?.set;
      valueSetter?.call(progress, "7.5");
      progress.dispatchEvent(new Event("input", { bubbles: true }));
    });

    expect(audio.currentTime).toBe(7.5);
    expect(progress.value).toBe("7.5");
    expect(container.textContent).toContain("0:07");
    expect(container.textContent).toContain("0:23");
  });

  it("announces speed changes politely and applies them to the media element", async () => {
    const audio = await renderSample();
    const speed = buttonNamed("Playback speed 1x. Activate to change.");

    act(() => speed.click());
    await flushEffects();

    expect(
      buttonNamed("Playback speed 1.25x. Activate to change."),
    ).not.toBeNull();
    const announcement = container.querySelector('[role="status"]');
    expect(announcement?.getAttribute("aria-live")).toBe("polite");
    expect(announcement?.getAttribute("aria-atomic")).toBe("true");
    expect(announcement?.textContent).toBe("Playback speed 1.25x");
    expect(audio.playbackRate).toBe(1.25);
  });

  it("keeps server markup stable before restoring a saved playback speed", async () => {
    localStorage.setItem("curio-garden-playback-rate", "1.5");

    const markup = renderToStaticMarkup(<HomeListeningSample />);
    expect(markup).toContain("Playback speed 1x. Activate to change.");
    expect(markup).not.toContain("Playback speed 1.5x. Activate to change.");

    const audio = await renderSample();
    await flushEffects();
    expect(
      buttonNamed("Playback speed 1.5x. Activate to change."),
    ).not.toBeNull();
    expect(audio.playbackRate).toBe(1.5);
  });

  it("offers replay after ending and de-duplicates start and completion analytics", async () => {
    const playTimes: number[] = [];
    vi.spyOn(HTMLMediaElement.prototype, "play").mockImplementation(function (
      this: HTMLMediaElement,
    ) {
      playTimes.push(this.currentTime);
      this.dispatchEvent(new Event("play"));
      this.dispatchEvent(new Event("playing", { bubbles: true }));
      return Promise.resolve();
    });
    const audio = await renderSample();

    act(() => buttonNamed("Play listening sample").click());
    act(() => {
      audio.currentTime = HOME_LISTENING_SAMPLE_DURATION_SECONDS;
      audio.dispatchEvent(new Event("timeupdate"));
      audio.dispatchEvent(new Event("ended"));
      audio.dispatchEvent(new Event("ended"));
    });

    expect(buttonNamed("Play sample again")).not.toBeNull();
    expect(analyticsMocks.listeningSampleStarted).toHaveBeenCalledTimes(1);
    expect(analyticsMocks.listeningSampleCompleted).toHaveBeenCalledTimes(1);

    const progress = container.querySelector(
      'input[aria-label="Playback position"]',
    ) as HTMLInputElement;
    act(() => {
      const valueSetter = Object.getOwnPropertyDescriptor(
        HTMLInputElement.prototype,
        "value",
      )?.set;
      valueSetter?.call(progress, "5");
      progress.dispatchEvent(new Event("input", { bubbles: true }));
    });
    expect(buttonNamed("Resume listening sample")).not.toBeNull();

    act(() => buttonNamed("Resume listening sample").click());
    expect(buttonNamed("Pause listening sample")).not.toBeNull();
    expect(playTimes).toEqual([0, 5]);

    act(() => audio.dispatchEvent(new Event("ended")));
    expect(buttonNamed("Play sample again")).not.toBeNull();

    act(() => buttonNamed("Play sample again").click());
    expect(playTimes).toEqual([0, 5, 0]);

    act(() => audio.dispatchEvent(new Event("ended")));
    expect(analyticsMocks.listeningSampleStarted).toHaveBeenCalledTimes(1);
    expect(analyticsMocks.listeningSampleCompleted).toHaveBeenCalledTimes(1);
  });
});
