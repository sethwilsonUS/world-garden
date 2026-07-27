// @vitest-environment jsdom

import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  InlineProgressBar,
  PauseIcon,
  PlayIcon,
  SoundIcon,
  SpeedButton,
  SpinnerIcon,
} from "./AudioPlaybackPresentation";

Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });

describe("AudioPlaybackPresentation", () => {
  let container: HTMLDivElement;
  let root: Root;

  beforeEach(() => {
    container = document.createElement("div");
    document.body.appendChild(container);
    root = createRoot(container);
  });

  afterEach(() => {
    act(() => root.unmount());
    container.remove();
  });

  it("exposes accessible playback controls through the shared presentation", async () => {
    const onSpeedChange = vi.fn();
    const onSeek = vi.fn();

    await act(async () => {
      root.render(
        <>
          <PlayIcon />
          <PauseIcon />
          <SoundIcon />
          <SpinnerIcon />
          <SpeedButton rate={1.25} onClick={onSpeedChange} />
          <InlineProgressBar currentTime={3} duration={12} onSeek={onSeek} />
        </>,
      );
    });

    const icons = Array.from(container.querySelectorAll("svg"));
    expect(icons).toHaveLength(4);
    for (const icon of icons) {
      expect(icon.getAttribute("aria-hidden")).toBe("true");
      expect(icon.getAttribute("focusable")).toBe("false");
    }

    const speedButton = container.querySelector(
      'button[aria-label="Playback speed 1.25x. Activate to change."]',
    ) as HTMLButtonElement;
    expect(speedButton.type).toBe("button");
    expect(speedButton.textContent).toBe("1.25x");

    act(() => speedButton.click());
    expect(onSpeedChange).toHaveBeenCalledTimes(1);

    const slider = container.querySelector(
      'input[type="range"]',
    ) as HTMLInputElement;
    expect(slider.className).toContain("audio-progress-range");
    expect(slider.min).toBe("0");
    expect(slider.max).toBe("12");
    expect(slider.step).toBe("0.1");
    expect(slider.value).toBe("3");
    expect(slider.getAttribute("aria-label")).toBe("Playback position");
    expect(slider.getAttribute("aria-valuetext")).toBe("0:03 of 0:12");
    expect(slider.style.getPropertyValue("--progress")).toBe("25%");
    expect(slider.closest(".audio-scrubber")).not.toBeNull();

    act(() => {
      const valueSetter = Object.getOwnPropertyDescriptor(
        HTMLInputElement.prototype,
        "value",
      )?.set;
      valueSetter?.call(slider, "7.5");
      slider.dispatchEvent(new Event("input", { bubbles: true }));
    });
    expect(onSeek).toHaveBeenCalledWith(7.5);

    onSeek.mockClear();
    act(() => {
      const valueSetter = Object.getOwnPropertyDescriptor(
        HTMLInputElement.prototype,
        "value",
      )?.set;
      valueSetter?.call(slider, "99");
      slider.dispatchEvent(new Event("input", { bubbles: true }));
    });
    expect(onSeek).toHaveBeenCalledWith(12);
  });

  it("clamps invalid timeline values before exposing them to the range", async () => {
    const renderProgress = async (currentTime: number, duration: number) => {
      await act(async () => {
        root.render(
          <InlineProgressBar
            currentTime={currentTime}
            duration={duration}
            onSeek={() => {}}
          />,
        );
      });
      return container.querySelector('input[type="range"]') as HTMLInputElement;
    };

    let slider = await renderProgress(99, 12);
    expect(slider.value).toBe("12");
    expect(slider.getAttribute("aria-valuenow")).toBe("12");
    expect(slider.getAttribute("aria-valuetext")).toBe("0:12 of 0:12");
    expect(slider.style.getPropertyValue("--progress")).toBe("100%");

    slider = await renderProgress(-4, 12);
    expect(slider.value).toBe("0");
    expect(slider.getAttribute("aria-valuenow")).toBe("0");
    expect(slider.style.getPropertyValue("--progress")).toBe("0%");

    slider = await renderProgress(Number.NaN, Number.POSITIVE_INFINITY);
    expect(slider.max).toBe("0");
    expect(slider.value).toBe("0");
    expect(slider.getAttribute("aria-valuemax")).toBe("0");
    expect(slider.getAttribute("aria-valuenow")).toBe("0");
    expect(slider.getAttribute("aria-valuetext")).toBe("0:00 of 0:00");
    expect(slider.style.getPropertyValue("--progress")).toBe("0%");
  });
});
