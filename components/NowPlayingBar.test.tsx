// @vitest-environment jsdom

import { act, type ComponentProps } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { AudioPlaybackState } from "@/lib/article-audio-playback";
import {
  NOW_PLAYING_HEIGHT_VARIABLE,
  NowPlayingBar,
  isNowPlayingVisible,
} from "./NowPlayingBar";

Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });

const playback = (
  overrides: Partial<AudioPlaybackState> = {},
): AudioPlaybackState => ({
  status: "playing",
  sectionKey: "section-0",
  sectionIdx: 0,
  label: "History — Example article",
  mode: "single",
  slowLoading: false,
  ...overrides,
});

const idle: AudioPlaybackState = {
  status: "idle",
  sectionKey: null,
  sectionIdx: null,
  label: null,
  mode: "single",
  slowLoading: false,
};

type BarProps = ComponentProps<typeof NowPlayingBar>;

const makeProps = (overrides: Partial<BarProps> = {}): BarProps => ({
  articleTitle: "Example article",
  sectionTitle: "History",
  playback: playback(),
  audioProgress: { currentTime: 30, duration: 120 },
  playbackRate: 1,
  onTogglePlayback: vi.fn(),
  onSkipBy: vi.fn(),
  onSkipSection: vi.fn(),
  onStop: vi.fn(),
  onSeek: vi.fn(),
  onPlaybackRateChange: vi.fn(),
  onJumpToSection: vi.fn(),
  ...overrides,
});

const button = (container: HTMLElement, name: string) => {
  const match = Array.from(container.querySelectorAll("button")).find(
    (candidate) =>
      (candidate.getAttribute("aria-label") ?? candidate.textContent) === name,
  );
  if (!match) throw new Error(`No button named ${name}`);
  return match;
};

describe("NowPlayingBar", () => {
  let container: HTMLDivElement;
  let root: Root;
  let resizeCallbacks: ResizeObserverCallback[];

  beforeEach(() => {
    window.localStorage.clear();
    resizeCallbacks = [];
    vi.stubGlobal(
      "ResizeObserver",
      class {
        constructor(callback: ResizeObserverCallback) {
          resizeCallbacks.push(callback);
        }
        observe() {}
        disconnect() {}
        unobserve() {}
      },
    );
    vi.spyOn(HTMLElement.prototype, "getBoundingClientRect").mockReturnValue({
      height: 96.4,
    } as DOMRect);
    container = document.createElement("div");
    document.body.appendChild(container);
    root = createRoot(container);
  });

  afterEach(() => {
    act(() => root.unmount());
    container.remove();
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  it("is visible only while a section is loading, playing, or paused", () => {
    expect(isNowPlayingVisible(idle)).toBe(false);
    expect(isNowPlayingVisible(playback({ status: "error" }))).toBe(false);
    expect(isNowPlayingVisible(playback({ status: "loading" }))).toBe(true);
    expect(isNowPlayingVisible(playback({ status: "playing" }))).toBe(true);
    expect(isNowPlayingVisible(playback({ status: "paused" }))).toBe(true);
  });

  it("renders nothing visible and no height variable when nothing is loaded", () => {
    act(() =>
      root.render(<NowPlayingBar {...makeProps({ playback: idle })} />),
    );

    expect(container.querySelector("[data-now-playing-bar]")).toBeNull();
    expect(
      document.documentElement.style.getPropertyValue(
        NOW_PLAYING_HEIGHT_VARIABLE,
      ),
    ).toBe("");
  });

  it("is a labelled region, not a dialog, with the section and article titles", () => {
    act(() => root.render(<NowPlayingBar {...makeProps()} />));

    const region = container.querySelector("section[aria-label='Now playing']");
    expect(region).not.toBeNull();
    expect(region?.getAttribute("role")).toBeNull();
    expect(container.querySelector("[role='dialog']")).toBeNull();
    expect(region?.textContent).toContain("History");
    expect(region?.textContent).toContain("Example article");
    expect(region?.className).toContain("env(safe-area-inset-bottom)");
    const slider = region?.querySelector("input[type='range']");
    expect(slider?.getAttribute("aria-label")).toBe("Position in History");
    expect(slider?.getAttribute("aria-valuetext")).toBe("0:30 of 2:00");
  });

  it("publishes and removes its height variable and body padding", () => {
    act(() => root.render(<NowPlayingBar {...makeProps()} />));

    const root_ = document.documentElement;
    expect(root_.style.getPropertyValue(NOW_PLAYING_HEIGHT_VARIABLE)).toBe(
      "97px",
    );
    expect(document.body.style.paddingBottom).toBe(
      `var(${NOW_PLAYING_HEIGHT_VARIABLE}, 0px)`,
    );
    expect(resizeCallbacks).toHaveLength(1);

    act(() =>
      root.render(<NowPlayingBar {...makeProps({ playback: idle })} />),
    );
    expect(root_.style.getPropertyValue(NOW_PLAYING_HEIGHT_VARIABLE)).toBe("");
    expect(document.body.style.paddingBottom).toBe("");
  });

  it("keeps focus and playback when minimized, and remembers both choices across articles", () => {
    const props = makeProps({ playback: playback({ mode: "play_all" }) });
    act(() => root.render(<NowPlayingBar key="first" {...props} />));

    const toggle = button(container, "Minimize player");
    const panel = document.getElementById(
      toggle.getAttribute("aria-controls")!,
    );
    expect(panel?.hidden).toBe(false);
    toggle.focus();
    act(() => toggle.click());
    expect(document.activeElement).toBe(toggle);
    expect(toggle.getAttribute("aria-expanded")).toBe("false");
    expect(panel?.hidden).toBe(true);
    expect(panel?.contains(button(container, "Stop audio"))).toBe(true);
    expect(
      panel?.contains(container.querySelector("input[type='range']")),
    ).toBe(true);
    const pause = button(container, "Pause History");
    expect(pause.closest("[hidden]")).toBeNull();
    expect(props.onStop).not.toHaveBeenCalled();
    expect(props.onTogglePlayback).not.toHaveBeenCalled();
    act(() => pause.click());
    expect(props.onTogglePlayback).toHaveBeenCalledOnce();

    act(() => root.render(<NowPlayingBar key="second" {...props} />));
    const expand = button(container, "Expand player");
    expect(expand.getAttribute("aria-expanded")).toBe("false");
    expand.focus();
    act(() => expand.click());
    expect(document.activeElement).toBe(expand);
    expect(button(container, "Stop audio").closest("[hidden]")).toBeNull();

    act(() => root.render(<NowPlayingBar key="third" {...props} />));
    expect(
      button(container, "Minimize player").getAttribute("aria-expanded"),
    ).toBe("true");
  });

  it("can still minimize when the browser blocks preference storage", () => {
    vi.spyOn(window, "localStorage", "get").mockImplementation(() => {
      throw new DOMException("Storage is blocked", "SecurityError");
    });
    vi.spyOn(console, "debug").mockImplementation(() => {});
    act(() => root.render(<NowPlayingBar {...makeProps()} />));
    act(() => button(container, "Minimize player").click());
    expect(
      button(container, "Expand player").getAttribute("aria-expanded"),
    ).toBe("false");
    expect(
      container.querySelector("input[type='range']")?.closest("[hidden]"),
    ).not.toBeNull();
  });

  it("drives the existing controller actions", () => {
    const props = makeProps({ playback: playback({ mode: "play_all" }) });
    act(() => root.render(<NowPlayingBar {...props} />));

    act(() => button(container, "Pause History").click());
    expect(props.onTogglePlayback).toHaveBeenCalledTimes(1);
    act(() => button(container, "Back 10 seconds").click());
    expect(props.onSkipBy).toHaveBeenCalledWith(-10);
    act(() => button(container, "Forward 10 seconds").click());
    expect(props.onSkipBy).toHaveBeenCalledWith(10);
    act(() => button(container, "Next section").click());
    expect(props.onSkipSection).toHaveBeenCalledTimes(1);
    act(() => button(container, "Jump to section").click());
    expect(props.onJumpToSection).toHaveBeenCalledTimes(1);
    act(() => button(container, "Stop audio").click());
    expect(props.onStop).toHaveBeenCalledTimes(1);
    act(() =>
      button(container, "Playback speed 1x. Activate to change.").click(),
    );
    expect(props.onPlaybackRateChange).toHaveBeenCalledWith(1.25);
  });

  it("offers Play while paused and hides Next section outside Play all", () => {
    const props = makeProps({ playback: playback({ status: "paused" }) });
    act(() => root.render(<NowPlayingBar {...props} />));

    act(() => button(container, "Play History").click());
    expect(props.onTogglePlayback).toHaveBeenCalledTimes(1);
    expect(() => button(container, "Next section")).toThrow();
  });

  it("does not toggle playback while the section is still loading", () => {
    const props = makeProps({ playback: playback({ status: "loading" }) });
    act(() => root.render(<NowPlayingBar {...props} />));

    const loading = button(container, "Loading History");
    expect(loading.getAttribute("aria-disabled")).toBe("true");
    act(() => loading.click());
    expect(props.onTogglePlayback).not.toHaveBeenCalled();
  });

  it("announces Play all section changes once through a polite region", () => {
    act(() =>
      root.render(
        <NowPlayingBar
          {...makeProps({ playback: playback({ mode: "play_all" }) })}
        />,
      ),
    );
    const status = container.querySelector("[role='status']");
    expect(status?.getAttribute("aria-live")).toBe("polite");
    expect(status?.textContent).toBe("Now playing: History");

    act(() =>
      root.render(
        <NowPlayingBar
          {...makeProps({
            playback: playback({ mode: "play_all", status: "paused" }),
          })}
        />,
      ),
    );
    expect(status?.textContent).toBe("Now playing: History");

    act(() =>
      root.render(
        <NowPlayingBar
          {...makeProps({ playback: playback({ mode: "single" }) })}
        />,
      ),
    );
    expect(status?.textContent).toBe("");
  });
});
