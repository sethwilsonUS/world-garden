// @vitest-environment jsdom

import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { AccessibleTimeline } from "./AccessibleTimeline";

Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });

describe("AccessibleTimeline", () => {
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

  it("filters, orders, and announces events through its controls", async () => {
    await act(async () =>
      root.render(
        <AccessibleTimeline
          defaultOrder="oldest"
          items={[
            {
              id: "first",
              start: { display: "1900", dateTime: "1900", sortKey: 1900 },
              category: "Science",
              content: <strong>First event</strong>,
            },
            {
              id: "second",
              start: { display: "2000", dateTime: "2000", sortKey: 2000 },
              category: "Arts",
              content: <strong>Second event</strong>,
            },
            {
              id: "third",
              start: { display: "2010", dateTime: "2010", sortKey: 2010 },
              category: "Science",
              content: <strong>Third event</strong>,
            },
          ]}
        />,
      ),
    );

    expect(container.querySelector('[role="status"]')?.textContent).toContain(
      "3 events, oldest first",
    );
    expect(
      Array.from(container.querySelectorAll("li strong"), (item) =>
        item.textContent,
      ),
    ).toEqual(["First event", "Second event", "Third event"]);

    const select = container.querySelector("select")!;
    await act(async () => {
      select.value = "Science";
      select.dispatchEvent(new Event("change", { bubbles: true }));
    });
    expect(container.querySelector('[role="status"]')?.textContent).toContain(
      "2 events, oldest first",
    );

    const button = container.querySelector("button")!;
    button.focus();
    await act(async () => button.click());
    expect(button.textContent).toBe("Oldest first");
    expect(document.activeElement).toBe(button);
    expect(
      Array.from(container.querySelectorAll("li strong"), (item) =>
        item.textContent,
      ),
    ).toEqual(["Third event", "First event"]);
  });
});
