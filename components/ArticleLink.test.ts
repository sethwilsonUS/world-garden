import { describe, expect, it } from "vitest";
import { articleTitleToArticleHref } from "./ArticleLink";

describe("articleTitleToArticleHref", () => {
  it("builds the canonical article route from a Wikipedia title", () => {
    expect(articleTitleToArticleHref("J. R. R. Tolkien")).toBe(
      "/article/J._R._R._Tolkien",
    );
    expect(articleTitleToArticleHref("Taylor Swift: The Eras Tour")).toBe(
      "/article/Taylor_Swift%3A_The_Eras_Tour",
    );
  });
});
