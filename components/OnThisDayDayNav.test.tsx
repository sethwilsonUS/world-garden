// @vitest-environment jsdom

import { act, createRef } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { OnThisDayDayNav } from "./OnThisDayDayNav";

Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });

describe("OnThisDayDayNav", () => {
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

  it("omits default query params and wraps across the 366-day ring", () => {
    const onOpenPicker = vi.fn();
    const onNavigateDay = vi.fn();

    act(() =>
      root.render(
        <OnThisDayDayNav
          day={{ month: 12, day: 31 }}
          category="selected"
          order="newest"
          pickerOpen={false}
          onOpenPicker={onOpenPicker}
          onNavigateDay={onNavigateDay}
          previousLinkRef={createRef<HTMLAnchorElement>()}
          nextLinkRef={createRef<HTMLAnchorElement>()}
          pickerTriggerRef={createRef<HTMLButtonElement>()}
        />,
      ),
    );

    const links = Array.from(container.querySelectorAll("a"));
    expect(links).toHaveLength(2);
    expect(links[0]?.getAttribute("href")).toBe("/on-this-day/december-30");
    expect(links[0]?.textContent).toContain("Previous: December 30");
    expect(links[1]?.getAttribute("href")).toBe("/on-this-day/january-1");
    expect(links[1]?.textContent).toContain("Next: January 1");

    const trigger = container.querySelector<HTMLButtonElement>(
      ".on-this-day-nav-picker",
    )!;
    expect(trigger.getAttribute("aria-label")).toBe(
      "Choose a day, currently December 31",
    );
    act(() => trigger.click());
    expect(onOpenPicker).toHaveBeenCalledTimes(1);
  });

  it("propagates non-default category and sort params and includes February 29", () => {
    const onNavigateDay = vi.fn();

    act(() =>
      root.render(
        <OnThisDayDayNav
          day={{ month: 3, day: 1 }}
          category="births"
          order="oldest"
          pickerOpen={false}
          onOpenPicker={vi.fn()}
          onNavigateDay={onNavigateDay}
          previousLinkRef={createRef<HTMLAnchorElement>()}
          nextLinkRef={createRef<HTMLAnchorElement>()}
          pickerTriggerRef={createRef<HTMLButtonElement>()}
        />,
      ),
    );

    const links = Array.from(container.querySelectorAll("a"));
    expect(links[0]?.getAttribute("href")).toBe(
      "/on-this-day/february-29?category=births&order=oldest",
    );
    expect(links[0]?.textContent).toContain("Previous: February 29");
    expect(links[1]?.getAttribute("href")).toBe(
      "/on-this-day/march-2?category=births&order=oldest",
    );
  });
});
