import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { ArticleTopics } from "./ArticleTopics";

describe("ArticleTopics", () => {
  it("renders badge labels in a stable order", () => {
    const markup = renderToStaticMarkup(
      createElement(ArticleTopics, {
        badgeKeys: ["technology", "history", "science"],
      }),
    );

    expect(markup).toContain("Topics");
    expect(markup.indexOf("History")).toBeLessThan(markup.indexOf("Science"));
    expect(markup.indexOf("Science")).toBeLessThan(
      markup.indexOf("Technology"),
    );
  });

  it("renders a quiet empty state when no topics match", () => {
    const markup = renderToStaticMarkup(
      createElement(ArticleTopics, {
        badgeKeys: [],
      }),
    );

    expect(markup).toContain("No broad topics detected yet.");
  });

  it("renders an unavailable state when topic data is missing", () => {
    const markup = renderToStaticMarkup(createElement(ArticleTopics));

    expect(markup).toContain("Unavailable right now.");
  });
});
