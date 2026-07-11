// @vitest-environment jsdom

import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { TodayOnWikipediaContent, type TodayOnWikipediaData } from "./TodayOnWikipedia";

Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });

describe("TodayOnWikipedia curated preview", () => {
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

  it("limits facts and news until their focused disclosure buttons are used", async () => {
    const data: TodayOnWikipediaData = {
      didYouKnow: Array.from({ length: 4 }, (_, index) => ({
        text: `Fact ${index + 1}`,
        links: [],
        segments: [{ type: "text" as const, text: `Fact ${index + 1}` }],
      })),
      inTheNews: Array.from({ length: 3 }, (_, index) => ({
        story: `Story ${index + 1}`,
        links: [],
      })),
    };

    await act(async () => root.render(<TodayOnWikipediaContent data={data} />));

    expect(container.textContent).not.toContain("Fact 4");
    expect(container.textContent).not.toContain("Story 3");

    const factsButton = Array.from(container.querySelectorAll("button")).find(
      (button) => button.textContent === "Show all 4 facts",
    )!;
    factsButton.focus();
    await act(async () => factsButton.click());

    expect(container.textContent).toContain("Fact 4");
    expect(document.activeElement).toBe(factsButton);
    expect(factsButton.getAttribute("aria-expanded")).toBe("true");
  });
});
