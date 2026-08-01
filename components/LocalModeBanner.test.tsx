// @vitest-environment jsdom

import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { LocalModeBanner } from "./LocalModeBanner";

Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });

describe("LocalModeBanner", () => {
  let container: HTMLDivElement;
  let root: Root;
  let searchInput: HTMLInputElement;

  beforeEach(() => {
    container = document.createElement("div");
    searchInput = document.createElement("input");
    searchInput.id = "search-input";
    document.body.append(container, searchInput);
    root = createRoot(container);
  });

  afterEach(() => {
    act(() => root.unmount());
    container.remove();
    searchInput.remove();
  });

  it("moves focus to the search field before the notice unmounts", () => {
    act(() => root.render(<LocalModeBanner />));
    const dismiss = container.querySelector<HTMLButtonElement>(
      '[aria-label="Dismiss local mode notice"]',
    );
    expect(dismiss).not.toBeNull();

    dismiss?.focus();
    expect(document.activeElement).toBe(dismiss);
    act(() => dismiss?.click());

    expect(document.activeElement).toBe(searchInput);
    expect(container.querySelector('[role="status"]')).toBeNull();
  });
});
