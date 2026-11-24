// @vitest-environment jsdom

import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { stepPlaybackRate, usePlaybackRate } from "./usePlaybackRate";

Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });

function SpeedControl() {
  const { rate, setRate } = usePlaybackRate();
  return <button onClick={() => setRate(stepPlaybackRate(rate, 1))}>{rate}x</button>;
}

const key = "curio-garden-playback-rate";
let container: HTMLDivElement;
let root: Root;
beforeEach(() => {
  container = document.createElement("div");
  root = createRoot(container);
  localStorage.clear();
});

afterEach(() => {
  vi.restoreAllMocks();
  act(() => {
    localStorage.clear();
    window.dispatchEvent(new StorageEvent("storage", { key: null }));
    root.unmount();
  });
});

it("keeps two mounted players in sync", () => {
  localStorage.setItem("world-garden-playback-rate", "1.5");
  act(() =>
    root.render(
      <>
        <SpeedControl />
        <SpeedControl />
      </>,
    ),
  );
  const [first, second] = container.querySelectorAll("button");
  expect(first.textContent).toBe("1.5x");
  expect(localStorage.getItem("world-garden-playback-rate")).toBeNull();
  expect(localStorage.getItem(key)).toBe("1.5");
  act(() => first.click());
  act(() => second.click());
  expect(first.textContent).toBe("1.7x");
  expect(second.textContent).toBe("1.7x");
  expect(localStorage.getItem(key)).toBe("1.7");
});

it("accepts a change or reset made in another tab", () => {
  act(() => root.render(<SpeedControl />));
  act(() => {
    localStorage.setItem(key, "2.5");
    window.dispatchEvent(new StorageEvent("storage", { key }));
  });
  expect(container.textContent).toBe("2.5x");
  act(() => {
    localStorage.clear();
    window.dispatchEvent(new StorageEvent("storage", { key: null }));
  });
  expect(container.textContent).toBe("1x");
});

it("keeps the selected rate for later players when storage rejects writes", () => {
  act(() => root.render(<SpeedControl />));
  vi.spyOn(console, "debug").mockImplementation(() => {});
  vi.spyOn(Storage.prototype, "setItem").mockImplementation(() => {
    throw new DOMException("Storage full", "QuotaExceededError");
  });
  act(() => container.querySelector("button")!.click());
  expect(container.textContent).toBe("1.1x");
  act(() => root.render(null));
  act(() => root.render(<SpeedControl />));
  expect(container.textContent).toBe("1.1x");
});

it("ignores a saved speed that browsers would mute and falls back to 1x", () => {
  localStorage.setItem(key, "16");
  act(() => root.render(<SpeedControl />));
  expect(container.textContent).toBe("1x");
  act(() => {
    localStorage.setItem(key, "3.5");
    window.dispatchEvent(new StorageEvent("storage", { key }));
  });
  expect(container.textContent).toBe("3.5x");
});
