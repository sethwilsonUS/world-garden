// @vitest-environment jsdom

import { act, useEffect } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { useLiveAnnouncement } from "./useLiveAnnouncement";

Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });

describe("useLiveAnnouncement", () => {
  let container: HTMLDivElement;
  let root: Root;
  let announceFn: ((message: string) => void) | null = null;

  const Harness = () => {
    const { announcement, announce } = useLiveAnnouncement();
    useEffect(() => {
      announceFn = announce;
    }, [announce]);
    return (
      <p role="status" aria-live="polite">
        {announcement}
      </p>
    );
  };

  beforeEach(() => {
    vi.useFakeTimers();
    container = document.createElement("div");
    document.body.appendChild(container);
    root = createRoot(container);
    act(() => root.render(<Harness />));
  });

  afterEach(() => {
    act(() => root.unmount());
    container.remove();
    announceFn = null;
    vi.useRealTimers();
  });

  const region = () => container.querySelector("p[role='status']")!;

  it("clears and restores the same mounted live region when a message repeats", () => {
    const liveNode = region();

    act(() => announceFn!("Already at the fastest speed, 4x"));
    expect(region()).toBe(liveNode);
    expect(liveNode.textContent).toBe("Already at the fastest speed, 4x");

    act(() => announceFn!("Already at the fastest speed, 4x"));
    expect(region()).toBe(liveNode);
    expect(liveNode.textContent).toBe("");

    act(() => {
      vi.runOnlyPendingTimers();
    });
    expect(region()).toBe(liveNode);
    expect(liveNode.textContent).toBe("Already at the fastest speed, 4x");
  });

  it("cancels a pending restore when newer feedback arrives", () => {
    const liveNode = region();

    act(() => announceFn!("Already at the fastest speed, 4x"));
    act(() => announceFn!("Already at the fastest speed, 4x"));
    expect(liveNode.textContent).toBe("");

    act(() => announceFn!("Playback speed 3.9x"));
    expect(liveNode.textContent).toBe("Playback speed 3.9x");

    act(() => {
      vi.runAllTimers();
    });
    expect(liveNode.textContent).toBe("Playback speed 3.9x");
  });

  it("cancels a pending restore on unmount", () => {
    const errorSpy = vi.spyOn(console, "error").mockImplementation(() => {});

    act(() => announceFn!("Already at the slowest speed, 0.5x"));
    act(() => announceFn!("Already at the slowest speed, 0.5x"));
    expect(vi.getTimerCount()).toBe(1);

    act(() => root.unmount());
    expect(vi.getTimerCount()).toBe(0);

    act(() => {
      vi.runAllTimers();
    });
    expect(errorSpy).not.toHaveBeenCalled();
    errorSpy.mockRestore();
  });
});
