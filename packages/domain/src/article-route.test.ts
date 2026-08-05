import { describe, expect, it } from "vitest";

import { articleRouteFromTitle, parseCanonicalArticlePath } from "./index";

describe("article route codec", () => {
  it("turns a Wikipedia title into its canonical Curio Garden route", () => {
    expect(articleRouteFromTitle("J. R. R. Tolkien")).toEqual({
      kind: "article",
      slug: "J._R._R._Tolkien",
      canonicalPath: "/article/J._R._R._Tolkien",
    });
    expect(articleRouteFromTitle("Taylor Swift: The Eras Tour")).toEqual({
      kind: "article",
      slug: "Taylor_Swift:_The_Eras_Tour",
      canonicalPath: "/article/Taylor_Swift%3A_The_Eras_Tour",
    });
  });

  it("normalizes Unicode and encodes a slash exactly once", () => {
    expect(articleRouteFromTitle("Lothlo\u0301rien")).toEqual({
      kind: "article",
      slug: "Lothlórien",
      canonicalPath: "/article/Lothl%C3%B3rien",
    });
    expect(articleRouteFromTitle("AC/DC")).toEqual({
      kind: "article",
      slug: "AC/DC",
      canonicalPath: "/article/AC%2FDC",
    });
  });

  it("parses relative paths and canonical HTTPS URLs without throwing", () => {
    const expected = {
      kind: "article" as const,
      slug: "AC/DC",
      canonicalPath: "/article/AC%2FDC" as const,
    };

    expect(parseCanonicalArticlePath("/article/AC%2fDC")).toEqual(expected);
    expect(
      parseCanonicalArticlePath("https://curiogarden.org/article/AC%2FDC"),
    ).toEqual(expected);
  });

  it.each([
    "",
    "/article/",
    "/article/Foo/Bar",
    "/article/%",
    "/article/%E0%A4%A",
    "/article/.",
    "/article/%2e%2e",
    "/article/Fangorn?from=random",
    "/article/Fangorn#history",
    "/library/Fangorn",
    "http://curiogarden.org/article/Fangorn",
    "https://www.curiogarden.org/article/Fangorn",
    "https://curiogarden.org.evil.example/article/Fangorn",
  ])("rejects a non-canonical article location: %s", (value) => {
    expect(parseCanonicalArticlePath(value)).toBeNull();
  });

  it.each(["", "   ", ".", ".."])(
    "rejects an unsafe article title: %j",
    (title) => {
      expect(() => articleRouteFromTitle(title)).toThrow(RangeError);
    },
  );
});
