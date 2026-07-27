import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import TermsPage from "./page";

describe("TermsPage", () => {
  it("links questions to the public feedback route", () => {
    const markup = renderToStaticMarkup(createElement(TermsPage));

    expect(markup).toContain('href="/feedback"');
    expect(markup).toContain("Questions about Curio Garden or these terms");
    expect(markup).not.toContain("contact or support method published");
  });
});
