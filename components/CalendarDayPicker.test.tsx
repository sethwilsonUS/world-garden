// @vitest-environment jsdom

import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { CalendarDayPicker } from "./CalendarDayPicker";

Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });

describe("CalendarDayPicker", () => {
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
    vi.restoreAllMocks();
  });

  it("renders a year-less grid with no weekday headers and always includes February 29", () => {
    const onSelectDay = vi.fn();
    const onClose = vi.fn();

    act(() =>
      root.render(
        <CalendarDayPicker
          open
          selectedDay={{ month: 2, day: 28 }}
          readersToday={{ month: 2, day: 14 }}
          onSelectDay={onSelectDay}
          onClose={onClose}
        />,
      ),
    );

    const dialog = container.querySelector("dialog");
    expect(dialog).not.toBeNull();
    expect(container.querySelector('[role="columnheader"]')).toBeNull();

    const grid = container.querySelector('[role="grid"]');
    expect(grid).not.toBeNull();

    const dayButtons = Array.from(
      container.querySelectorAll<HTMLButtonElement>(".calendar-day-picker-day"),
    );
    expect(dayButtons).toHaveLength(29);
    expect(dayButtons[28]?.getAttribute("aria-label")).toBe("February 29");

    const selectedCell = container.querySelector(
      '[role="gridcell"][aria-selected="true"]',
    );
    expect(selectedCell?.querySelector("button")?.getAttribute("aria-label")).toBe(
      "February 28",
    );

    const todayButton = container.querySelector('button[aria-current="date"]');
    expect(todayButton?.getAttribute("aria-label")).toBe("February 14");

    // Focused initially on the selected day.
    expect(document.activeElement?.getAttribute("aria-label")).toBe(
      "February 28",
    );
  });

  it("supports full keyboard navigation across months, leap day, year boundary, Home/End, PageUp/PageDown, and Escape", () => {
    const onSelectDay = vi.fn();
    const onClose = vi.fn();

    act(() =>
      root.render(
        <CalendarDayPicker
          open
          selectedDay={{ month: 2, day: 28 }}
          readersToday={{ month: 11, day: 23 }}
          onSelectDay={onSelectDay}
          onClose={onClose}
        />,
      ),
    );

    const press = (key: string) => {
      const target = document.activeElement as HTMLElement;
      act(() => {
        target.dispatchEvent(
          new KeyboardEvent("keydown", { key, bubbles: true, cancelable: true }),
        );
      });
    };

    // Feb 28 -> ArrowRight -> Feb 29 -> ArrowRight -> Mar 1
    press("ArrowRight");
    expect(document.activeElement?.getAttribute("aria-label")).toBe(
      "February 29",
    );
    press("ArrowRight");
    expect(document.activeElement?.getAttribute("aria-label")).toBe("March 1");

    // Mar 1 -> ArrowDown (+7) -> Mar 8 -> ArrowUp (-7) -> Mar 1
    press("ArrowDown");
    expect(document.activeElement?.getAttribute("aria-label")).toBe("March 8");
    press("ArrowUp");
    expect(document.activeElement?.getAttribute("aria-label")).toBe("March 1");

    // End -> Mar 31; Home -> Mar 1
    press("End");
    expect(document.activeElement?.getAttribute("aria-label")).toBe("March 31");
    press("Home");
    expect(document.activeElement?.getAttribute("aria-label")).toBe("March 1");

    // PageUp -> Feb 1 -> PageUp -> Jan 1 -> ArrowLeft -> Dec 31 (wrap across year)
    press("PageUp");
    expect(document.activeElement?.getAttribute("aria-label")).toBe(
      "February 1",
    );
    press("PageUp");
    expect(document.activeElement?.getAttribute("aria-label")).toBe(
      "January 1",
    );
    press("ArrowLeft");
    expect(document.activeElement?.getAttribute("aria-label")).toBe(
      "December 31",
    );

    // PageDown from Dec 31 wraps to Jan 31, then PageDown clamps to Feb 29
    press("PageDown");
    expect(document.activeElement?.getAttribute("aria-label")).toBe(
      "January 31",
    );
    press("PageDown");
    expect(document.activeElement?.getAttribute("aria-label")).toBe(
      "February 29",
    );

    // Escape closes dialog
    press("Escape");
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it("wraps months via Previous/Next month buttons and jumps to Today", () => {
    const onSelectDay = vi.fn();
    const onClose = vi.fn();

    act(() =>
      root.render(
        <CalendarDayPicker
          open
          selectedDay={{ month: 1, day: 15 }}
          readersToday={{ month: 11, day: 23 }}
          onSelectDay={onSelectDay}
          onClose={onClose}
        />,
      ),
    );

    const prevMonthBtn = container.querySelector<HTMLButtonElement>(
      'button[aria-label="Previous month, December"]',
    )!;
    expect(prevMonthBtn).not.toBeNull();
    act(() => prevMonthBtn.click());

    expect(
      container.querySelector(".calendar-day-picker-month-label")?.textContent,
    ).toBe("December");
    const nextMonthBtn = container.querySelector<HTMLButtonElement>(
      'button[aria-label="Next month, January"]',
    )!;
    expect(nextMonthBtn).not.toBeNull();

    const todayBtn = container.querySelector<HTMLButtonElement>(
      ".calendar-day-picker-today",
    )!;
    expect(todayBtn.textContent).toContain("November 23");
    act(() => todayBtn.click());
    expect(onSelectDay).toHaveBeenCalledWith({ month: 11, day: 23 });
  });
});
