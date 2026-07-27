// @vitest-environment jsdom

import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { renderToStaticMarkup } from "react-dom/server";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
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

describe("HomeListeningSample", () => {
  let container: HTMLDivElement;
  let root: Root;

  beforeEach(() => {
    analyticsMocks.listeningSampleCompleted.mockReset();
    analyticsMocks.listeningSampleStarted.mockReset();
    container = document.createElement("div");
    document.body.appendChild(container);
    root = createRoot(container);
  });

  afterEach(() => {
    act(() => root.unmount());
    container.remove();
  });

  it("offers an opt-in native audio sample with a transcript", () => {
    const markup = renderToStaticMarkup(<HomeListeningSample />);

    expect(markup).toContain("Listening sample");
    expect(markup).toContain("Start with a short listen");
    expect(markup).toContain("No account or search needed");
    expect(markup).toContain('controls=""');
    expect(markup).toContain('preload="metadata"');
    expect(markup).toContain(`src="${HOME_LISTENING_SAMPLE_URL}"`);
    expect(markup).toContain('type="audio/mpeg"');
    expect(markup).toContain("Synthetic voice · 18 seconds");
    expect(markup).toContain("Transcript");
    expect(markup).toContain(HOME_LISTENING_SAMPLE_TRANSCRIPT);
    expect(markup).not.toContain("autoplay");
  });

  it("records the first start and completion without duplicate events", async () => {
    await act(async () => {
      root.render(<HomeListeningSample />);
      await Promise.resolve();
    });

    const audio = container.querySelector("audio");
    expect(audio).toBeInstanceOf(HTMLAudioElement);

    act(() => {
      audio?.dispatchEvent(new Event("play", { bubbles: true }));
      audio?.dispatchEvent(new Event("play", { bubbles: true }));
      audio?.dispatchEvent(new Event("ended", { bubbles: true }));
      audio?.dispatchEvent(new Event("ended", { bubbles: true }));
    });

    expect(analyticsMocks.listeningSampleStarted).toHaveBeenCalledTimes(1);
    expect(analyticsMocks.listeningSampleCompleted).toHaveBeenCalledTimes(1);
  });
});
