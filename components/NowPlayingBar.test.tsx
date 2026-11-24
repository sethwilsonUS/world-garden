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
  returnFocusRef: { current: null },
  articleTitle: "Example article",
  isPlayingArticlePage: true,
  sectionTitle: "History",
  playback: playback(),
  audioProgress: { currentTime: 30, duration: 120 },
  playbackRate: 1,
  onTogglePlayback: vi.fn(),
  onSkipBy: vi.fn(),
  navigation: {
    position: { current: 2, total: 4 },
    previous: { sectionKey: "summary", title: "Summary" },
    next: { sectionKey: "section-1", title: "Legacy" },
    canGoToPrevious: true,
    canGoToNext: true,
    playAllSecondsRemaining: null,
  },
  onPreviousSection: vi.fn(),
  onNextSection: vi.fn(),
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
    vi.useRealTimers();
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

  it("keeps the article title first and the section available when collapsed", () => {
    act(() => root.render(<NowPlayingBar {...makeProps()} />));
    act(() => button(container, "Player controls").click());
    const region = container.querySelector("[data-now-playing-bar]")!;
    const [article, section] = region.querySelectorAll("p");
    expect(article.textContent).toBe("Example article");
    expect(section.textContent).toBe("History");
    expect(section.classList.contains("@max-[32em]:sr-only")).toBe(true);

    act(() =>
      root.render(
        <NowPlayingBar {...makeProps({ sectionTitle: "Example article" })} />,
      ),
    );
    expect(article.parentElement?.querySelectorAll("p")).toHaveLength(1);
  });

  it("keeps an off-page failure reachable for retry or dismissal", () => {
    const props = makeProps({
      playback: playback({ status: "error" }),
      error: "Could not load this section.",
      onRetry: vi.fn(),
    });
    act(() => root.render(<NowPlayingBar {...props} />));
    expect(container.querySelector("[role='alert']")?.textContent).toBe(
      props.error,
    );
    act(() => button(container, "Retry History").click());
    expect(props.onRetry).toHaveBeenCalledOnce();
    act(() => button(container, "Stop audio").click());
    expect(props.onStop).toHaveBeenCalledOnce();
  });

  it("focuses the current page's main content after Stop away from the article", () => {
    const render = (state: AudioPlaybackState) =>
      root.render(
        <>
          <main id="main-content" tabIndex={-1} />
          <NowPlayingBar {...makeProps({ playback: state })} />
        </>,
      );
    act(() => render(playback()));
    button(container, "Stop audio").focus();
    act(() => render(idle));
    expect(document.activeElement).toBe(container.querySelector("main"));
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

  it("returns focus to the article control only when playback removes a focused player", () => {
    const returnFocusRef: BarProps["returnFocusRef"] = { current: null };
    const renderPlayback = (state: AudioPlaybackState) =>
      root.render(
        <>
          <button ref={returnFocusRef}>Play all</button>
          <button>Elsewhere</button>
          <NowPlayingBar {...makeProps({ returnFocusRef, playback: state })} />
        </>,
      );
    act(() => renderPlayback(playback()));
    button(container, "Stop audio").focus();
    act(() => renderPlayback(idle));
    expect(document.activeElement).toBe(returnFocusRef.current);

    act(() => renderPlayback(playback()));
    button(container, "Pause History").focus();
    const outside = button(container, "Elsewhere");
    outside.focus();
    act(() => renderPlayback(idle));
    expect(document.activeElement).toBe(outside);
  });

  it("leaves navigation in charge of focus when the entire player unmounts", () => {
    const restore = document.createElement("button");
    const focus = vi.spyOn(restore, "focus");
    act(() =>
      root.render(
        <NowPlayingBar
          {...makeProps({ returnFocusRef: { current: restore } })}
        />,
      ),
    );
    button(container, "Stop audio").focus();
    act(() => root.render(null));
    expect(focus).not.toHaveBeenCalled();
  });

  it("keeps focus and playback when minimized, and remembers both choices across articles", () => {
    const props = makeProps({ playback: playback({ mode: "play_all" }) });
    act(() => root.render(<NowPlayingBar key="first" {...props} />));

    const toggle = button(container, "Player controls");
    expect(toggle.textContent).toBe("Player controls");
    expect(toggle.hasAttribute("title")).toBe(false);
    const panel = document.getElementById(
      toggle.getAttribute("aria-controls")!,
    );
    expect(panel?.hidden).toBe(false);
    toggle.focus();
    act(() => toggle.click());
    expect(document.activeElement).toBe(toggle);
    expect(toggle.getAttribute("aria-expanded")).toBe("false");
    expect(panel?.hidden).toBe(true);
    const help = container.querySelector("details")!;
    expect(help.closest("[hidden]")).toBeNull();
    expect(help.querySelector("summary")?.textContent).toBe("Keyboard shortcuts");
    expect(help.querySelector("input[type=checkbox]")).toBeTruthy();
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
    const expand = button(container, "Player controls");
    expect(expand.getAttribute("aria-expanded")).toBe("false");
    expand.focus();
    act(() => expand.click());
    expect(document.activeElement).toBe(expand);
    expect(button(container, "Stop audio").closest("[hidden]")).toBeNull();

    act(() => root.render(<NowPlayingBar key="third" {...props} />));
    expect(
      button(container, "Player controls").getAttribute("aria-expanded"),
    ).toBe("true");
  });

  it("can still minimize when the browser blocks preference storage", () => {
    vi.spyOn(window, "localStorage", "get").mockImplementation(() => {
      throw new DOMException("Storage is blocked", "SecurityError");
    });
    vi.spyOn(console, "debug").mockImplementation(() => {});
    act(() => root.render(<NowPlayingBar {...makeProps()} />));
    act(() => button(container, "Player controls").click());
    expect(
      button(container, "Player controls").getAttribute("aria-expanded"),
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
    act(() => button(container, "Previous section: Summary").click());
    expect(props.onPreviousSection).toHaveBeenCalledTimes(1);
    act(() => button(container, "Next section: Legacy").click());
    expect(props.onNextSection).toHaveBeenCalledTimes(1);
    act(() => button(container, "Jump to section").click());
    expect(props.onJumpToSection).toHaveBeenCalledTimes(1);
    act(() => button(container, "Stop audio").click());
    expect(props.onStop).toHaveBeenCalledTimes(1);
    act(() => button(container, "Faster").click());
    expect(props.onPlaybackRateChange).toHaveBeenCalledWith(1.1);
    act(() => button(container, "Slower").click());
    expect(props.onPlaybackRateChange).toHaveBeenLastCalledWith(0.9);
  });

  it("offers Play while paused and section steps outside Play all", () => {
    const props = makeProps({ playback: playback({ status: "paused" }) });
    act(() => root.render(<NowPlayingBar {...props} />));

    act(() => button(container, "Play History").click());
    expect(props.onTogglePlayback).toHaveBeenCalledTimes(1);
    const group = container.querySelector("[aria-label='Playback controls']")!;
    const names = Array.from(group.querySelectorAll("button")).map(
      (control) => control.getAttribute("aria-label") ?? control.textContent,
    );
    expect(names.slice(0, 4)).toEqual([
      "Previous section: Summary",
      "Back 10 seconds",
      "Forward 10 seconds",
      "Next section: Legacy",
    ]);
  });

  it("keeps focus on a section step that reaches the first or last section", () => {
    const props = makeProps({
      navigation: {
        position: { current: 1, total: 1 },
        previous: null,
        next: null,
        canGoToPrevious: false,
        canGoToNext: false,
        playAllSecondsRemaining: null,
      },
    });
    act(() => root.render(<NowPlayingBar {...props} />));

    for (const name of ["Previous section", "Next section"]) {
      const step = button(container, name);
      expect(step.hasAttribute("disabled")).toBe(false);
      expect(step.getAttribute("aria-disabled")).toBe("true");
      step.focus();
      act(() => step.click());
      expect(document.activeElement).toBe(step);
    }
    expect(props.onPreviousSection).not.toHaveBeenCalled();
    expect(props.onNextSection).not.toHaveBeenCalled();
  });

  it("shows where the listener is in the article and the Play all time left", () => {
    act(() => root.render(<NowPlayingBar {...makeProps()} />));
    const progress = () =>
      container.querySelector("[data-now-playing-progress]");
    expect(progress()?.textContent).toBe("Section 2 of 4");

    const props = makeProps({ playback: playback({ mode: "play_all" }) });
    act(() =>
      root.render(
        <NowPlayingBar
          {...props}
          navigation={{
            ...props.navigation!,
            playAllSecondsRemaining: 31 * 60,
          }}
        />,
      ),
    );
    expect(progress()?.textContent).toBe(
      "Section 2 of 4 · , about 31 minutes left",
    );
    expect(progress()?.querySelector("[aria-hidden='true']")?.textContent).toBe(
      " · ",
    );
    expect(progress()?.closest("[hidden]")).toBeNull();
    expect(progress()?.closest("[aria-live]")).toBeNull();
  });

  it("announces a section chosen with Previous or Next once it starts", () => {
    const props = makeProps();
    act(() => root.render(<NowPlayingBar {...props} />));
    const status = container.querySelector("[role='status']")!;
    expect(status.textContent).toBe("");

    act(() => button(container, "Next section: Legacy").click());
    expect(props.onNextSection).toHaveBeenCalledOnce();
    act(() =>
      root.render(
        <NowPlayingBar
          {...props}
          sectionTitle="Legacy"
          playback={playback({
            status: "loading",
            sectionKey: "section-1",
            sectionIdx: 1,
          })}
        />,
      ),
    );
    expect(status.textContent).toBe("");

    act(() =>
      root.render(
        <NowPlayingBar
          {...props}
          sectionTitle="Legacy"
          navigation={{
            ...props.navigation!,
            position: { current: 3, total: 4 },
          }}
          playback={playback({ sectionKey: "section-1", sectionIdx: 1 })}
        />,
      ),
    );
    expect(status.textContent).toBe("Now playing: Legacy, section 3 of 4");

    // A section started from the article's own Listen button stays quiet.
    act(() =>
      root.render(
        <NowPlayingBar
          {...props}
          sectionTitle="Early life"
          playback={playback({ sectionKey: "section-2", sectionIdx: 2 })}
        />,
      ),
    );
    expect(status.textContent).toBe("");
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
    expect(status?.textContent).toBe("Now playing: History, section 2 of 4");

    act(() =>
      root.render(
        <NowPlayingBar
          {...makeProps({
            playback: playback({ mode: "play_all", status: "paused" }),
          })}
        />,
      ),
    );
    expect(status?.textContent).toBe("Now playing: History, section 2 of 4");

    act(() =>
      root.render(
        <NowPlayingBar
          {...makeProps({ playback: playback({ mode: "single" }) })}
        />,
      ),
    );
    expect(status?.textContent).toBe("");
  });

  it("changes speed from the keyboard and re-announces repeated limit presses", () => {
    vi.useFakeTimers();
    const props = makeProps({ playbackRate: 3.9 });
    act(() => root.render(<NowPlayingBar {...props} />));
    const press = (key: string) =>
      document.body.dispatchEvent(
        new KeyboardEvent("keydown", {
          key,
          shiftKey: true,
          bubbles: true,
          cancelable: true,
        }),
      );
    const rateStatus = () =>
      Array.from(container.querySelectorAll("p[aria-live='polite']")).find(
        (region) => !region.hasAttribute("role"),
      )!;
    const liveRegion = rateStatus();

    act(() => press(">"));
    expect(props.onPlaybackRateChange).toHaveBeenCalledWith(4);
    expect(liveRegion.textContent).toBe("Playback speed 4x");

    act(() => root.render(<NowPlayingBar {...props} playbackRate={4} />));
    act(() => press(">"));
    expect(props.onPlaybackRateChange).toHaveBeenCalledTimes(1);
    expect(liveRegion.textContent).toBe("Already at the fastest speed, 4x");

    // A second Shift+> at 4x clears then restores the same live region.
    act(() => press(">"));
    expect(props.onPlaybackRateChange).toHaveBeenCalledTimes(1);
    expect(rateStatus()).toBe(liveRegion);
    expect(liveRegion.textContent).toBe("");
    act(() => {
      vi.runOnlyPendingTimers();
    });
    expect(liveRegion.textContent).toBe("Already at the fastest speed, 4x");

    // Stepping back before a pending restore cancels the stale limit text.
    act(() => press(">"));
    expect(liveRegion.textContent).toBe("");
    act(() => press("<"));
    expect(props.onPlaybackRateChange).toHaveBeenLastCalledWith(3.9);
    expect(liveRegion.textContent).toBe("Playback speed 3.9x");
    act(() => {
      vi.runAllTimers();
    });
    expect(liveRegion.textContent).toBe("Playback speed 3.9x");
  });

  it("keeps the speed buttons beside the speed in the playback controls", () => {
    act(() => root.render(<NowPlayingBar {...makeProps({ playbackRate: 1.5 })} />));
    const group = container.querySelector("[aria-label='Playback controls']")!;
    const speed = group.querySelector("[role='group'][aria-label='Playback speed']");
    expect(speed?.textContent).toContain("1.5x");
    expect(
      Array.from(speed!.querySelectorAll("button")).map((control) =>
        control.getAttribute("aria-label"),
      ),
    ).toEqual(["Slower", "Faster"]);
  });
});
