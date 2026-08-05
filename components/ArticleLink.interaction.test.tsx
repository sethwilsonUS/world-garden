// @vitest-environment jsdom

import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { ArticleLink } from "./ArticleLink";

Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });

const prefetch = vi.hoisted(() => vi.fn());

vi.mock("@/hooks/usePrefetch", () => ({
  usePrefetch: () => prefetch,
}));

describe("ArticleLink interactions", () => {
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
    vi.clearAllMocks();
  });

  it("prefetches the same canonical slug used by its fallback route", async () => {
    await act(async () => {
      root.render(
        <ArticleLink articleTitle={"  Lothlo\u0301rien  "}>
          Enter Lothlórien
        </ArticleLink>,
      );
    });

    const link = container.querySelector("a");
    expect(link?.getAttribute("href")).toBe("/article/Lothl%C3%B3rien");

    await act(async () => link?.focus());

    expect(prefetch).toHaveBeenCalledWith("Lothlórien");
  });
});
