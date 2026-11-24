// @vitest-environment jsdom

import { act, useState } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { PlaybackSpeedControl } from "./PlaybackSpeedControl";

Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });

const Harness = ({
  initialRate,
  onRateChange,
}: {
  initialRate: number;
  onRateChange?: (rate: number) => void;
}) => {
  const [rate, setRate] = useState(initialRate);
  return (
    <PlaybackSpeedControl
      rate={rate}
      onRateChange={(next) => {
        onRateChange?.(next);
        setRate(next);
      }}
    />
  );
};

describe("PlaybackSpeedControl", () => {
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

  const button = (name: string) =>
    container.querySelector<HTMLButtonElement>(`button[aria-label="${name}"]`)!;
  const readout = () =>
    container.querySelector("[role='group'] > span:not([role])")!;
  const status = () => container.querySelector("[role='status']")!;

  it("is a labelled group of Slower and Faster around the current speed", () => {
    act(() => root.render(<Harness initialRate={1.5} />));
    const group = container.querySelector("[role='group']")!;
    expect(group.getAttribute("aria-label")).toBe("Playback speed");
    const controls = Array.from(group.querySelectorAll("button"));
    expect(controls.map((control) => control.getAttribute("aria-label"))).toEqual([
      "Slower",
      "Faster",
    ]);
    for (const control of controls) {
      expect(control.type).toBe("button");
      expect(control.querySelector("svg")?.getAttribute("aria-hidden")).toBe(
        "true",
      );
      // The current speed is read as each button's description.
      expect(
        document.getElementById(control.getAttribute("aria-describedby")!)
          ?.textContent,
      ).toBe("1.5x");
    }
    expect(readout().textContent).toBe("1.5x");
    expect(status().getAttribute("aria-live")).toBe("polite");
    expect(status().textContent).toBe("");
  });

  it("moves 0.1x per press and announces the new speed", () => {
    const onRateChange = vi.fn();
    act(() =>
      root.render(<Harness initialRate={1.25} onRateChange={onRateChange} />),
    );

    act(() => button("Faster").click());
    expect(onRateChange).toHaveBeenLastCalledWith(1.3);
    expect(readout().textContent).toBe("1.3x");
    expect(status().textContent).toBe("Playback speed 1.3x");

    act(() => button("Slower").click());
    act(() => button("Slower").click());
    expect(onRateChange).toHaveBeenLastCalledWith(1.1);
    expect(status().textContent).toBe("Playback speed 1.1x");
  });

  it("steps from the newest speed when pressed twice in one turn", () => {
    const onRateChange = vi.fn();
    act(() =>
      root.render(<Harness initialRate={1} onRateChange={onRateChange} />),
    );
    act(() => {
      button("Faster").click();
      button("Faster").click();
    });
    expect(onRateChange.mock.calls).toEqual([[1.1], [1.2]]);
    expect(readout().textContent).toBe("1.2x");
  });

  it("keeps focus at the limits and says why nothing changed", () => {
    const onRateChange = vi.fn();
    act(() =>
      root.render(<Harness initialRate={3.9} onRateChange={onRateChange} />),
    );
    const faster = button("Faster");
    faster.focus();
    act(() => faster.click());
    expect(readout().textContent).toBe("4x");
    expect(faster.getAttribute("aria-disabled")).toBe("true");
    expect(faster.hasAttribute("disabled")).toBe(false);

    act(() => faster.click());
    expect(document.activeElement).toBe(faster);
    expect(onRateChange).toHaveBeenCalledTimes(1);
    expect(status().textContent).toBe("Already at the fastest speed, 4x");

    act(() => root.render(<Harness key="slow" initialRate={0.5} />));
    const slower = button("Slower");
    expect(slower.getAttribute("aria-disabled")).toBe("true");
    act(() => slower.click());
    expect(status().textContent).toBe("Already at the slowest speed, 0.5x");
  });

  it("never wraps inside itself, so the buttons stay beside the speed", () => {
    act(() => root.render(<Harness initialRate={1} />));
    const group = container.querySelector("[role='group']")!;
    expect(group.className).toContain("whitespace-nowrap");
    expect(group.className).toContain("shrink-0");
    expect(group.className).not.toContain("flex-wrap");
    for (const control of group.querySelectorAll("button")) {
      expect(control.className).toContain("min-h-11");
      expect(control.className).toContain("min-w-11");
    }
  });
});
