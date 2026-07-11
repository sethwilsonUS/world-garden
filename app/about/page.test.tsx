import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import AboutPage from "./page";

describe("AboutPage", () => {
  it("explains the engineering story and independent status", () => {
    const markup = renderToStaticMarkup(createElement(AboutPage));

    expect(markup).toContain("Free knowledge, made listenable");
    expect(markup).toContain("Seth Wilson");
    expect(markup).toContain("github.com/sethwilsonUS/world-garden");
    expect(markup).toContain("not endorsed by or affiliated with");
  });
});
