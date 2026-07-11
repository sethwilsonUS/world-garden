import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { ArticleHeader, ArticleSourceLine } from "./ArticleHeader";

describe("article provenance", () => {
  it("links the compact source line to the article revision and license", () => {
    const markup = renderToStaticMarkup(
      createElement(ArticleSourceLine, {
        language: "en",
        revisionId: "123456",
        wikiPageId: "42",
      }),
    );

    expect(markup).toContain("From");
    expect(markup).toContain("oldid=123456");
    expect(markup).toContain("CC BY-SA 4.0");
  });

  it("explains the listening adaptation beside contributor history", () => {
    const markup = renderToStaticMarkup(
      createElement(ArticleHeader, {
        title: "Example",
        language: "en",
        revisionId: "123456",
        wikiPageId: "42",
      }),
    );

    expect(markup).toContain("Edit history");
    expect(markup).toContain("adapts article structure for listening");
    expect(markup).toContain("citation markers may be omitted");
  });
});
