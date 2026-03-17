import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { BadgeProgressToastProvider } from "./BadgeProgressToastProvider";

describe("BadgeProgressToastProvider", () => {
  it("renders its children without crashing in static markup", () => {
    const markup = renderToStaticMarkup(
      createElement(BadgeProgressToastProvider, null, createElement("div", null, "hello")),
    );

    expect(markup).toContain("hello");
  });
});
