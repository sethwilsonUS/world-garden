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
    expect(articleTitleToArticleHref("São Paulo")).toBe(
      "/article/S%C3%A3o_Paulo",
    );
    expect(articleTitleToArticleHref("Lothlo\u0301rien")).toBe(
      "/article/Lothl%C3%B3rien",
    );
    expect(articleTitleToArticleHref("AC/DC")).toBe("/article/AC%2FDC");
  });
});
