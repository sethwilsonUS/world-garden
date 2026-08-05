import { describe, expect, it } from "vitest";

import {
  createWikipediaRevisionIdentity,
  createWikipediaSearchResult,
  normalizeMediaWikiNumericId,
  type WikipediaArticle,
  type WikipediaArticleImage,
} from "./index";

describe("Wikipedia source contracts", () => {
  it("builds a canonical immutable revision identity from source values", () => {
    const identity = createWikipediaRevisionIdentity({
      wikiPageId: 123,
      revisionId: "00456",
      title: " Lothlo\u0301rien ",
      language: "EN",
    });

    expect(identity).toEqual({
      wikiPageId: "123",
      revisionId: "456",
      title: "Lothlórien",
      language: "en",
    });
    expect(Object.isFrozen(identity)).toBe(true);
  });

  it.each([
    ["wikiPageId", 0],
    ["wikiPageId", -1],
    ["wikiPageId", 1.5],
    ["wikiPageId", Number.MAX_SAFE_INTEGER + 1],
    ["revisionId", "0"],
    ["revisionId", "1e3"],
    ["revisionId", "12.5"],
    ["revisionId", "1".repeat(21)],
    ["revisionId", `${"0".repeat(64)}1`],
    ["title", "   "],
    ["language", "en_US"],
    ["language", "javascript:alert(1)"],
  ])("rejects an invalid %s source value", (field, value) => {
    expect(() =>
      createWikipediaRevisionIdentity({
        wikiPageId: field === "wikiPageId" ? value : "123",
        revisionId: field === "revisionId" ? value : "456",
        title: field === "title" ? value : "Fangorn",
        language: field === "language" ? value : "en",
      }),
    ).toThrow(`Invalid Wikipedia ${field}`);
  });

  it("shares the bounded MediaWiki numeric-ID normalization used by clients", () => {
    expect(normalizeMediaWikiNumericId("00042")).toBe("42");
    expect(normalizeMediaWikiNumericId("9".repeat(20))).toBe("9".repeat(20));
    expect(normalizeMediaWikiNumericId("9".repeat(21))).toBeNull();
    expect(normalizeMediaWikiNumericId(`${"0".repeat(64)}1`)).toBeNull();
  });

  it("builds a search result only from a canonical HTTPS Wikipedia URL", () => {
    expect(
      createWikipediaSearchResult({
        wikiPageId: "00042",
        title: "  Númenor ",
        description: "  A fictional island kingdom.  ",
        url: "https://en.wikipedia.org/wiki/N%C3%BAmenor",
      }),
    ).toEqual({
      wikiPageId: "42",
      title: "Númenor",
      description: "A fictional island kingdom.",
      url: "https://en.wikipedia.org/wiki/N%C3%BAmenor",
    });
  });

  it.each([
    "http://en.wikipedia.org/wiki/Fangorn",
    "//en.wikipedia.org/wiki/Fangorn",
    "https://wikipedia.org.evil.example/wiki/Fangorn",
    "https://attacker@en.wikipedia.org/wiki/Fangorn",
    "https://en.wikipedia.org:443/wiki/Fangorn",
    "https://en.wikipedia.org/w/index.php?title=Fangorn",
    "https://en.wikipedia.org/wiki/Fangorn#History",
  ])("rejects a non-allowlisted search-result URL: %s", (url) => {
    expect(() =>
      createWikipediaSearchResult({
        wikiPageId: "42",
        title: "Fangorn",
        description: "A forest.",
        url,
      }),
    ).toThrow("Invalid Wikipedia url");
  });

  it("keeps later native article content independent of rendering frameworks", () => {
    const image = {
      src: "https://upload.wikimedia.org/example.jpg",
      alt: "A mallorn tree with golden leaves",
      caption: "Mallorn trees in autumn",
      attribution: {
        creator: "Example photographer",
        licenseName: "CC BY-SA 4.0",
        sourceUrl: "https://commons.wikimedia.org/wiki/File:Example.jpg",
      },
    } satisfies WikipediaArticleImage;
    const article = {
      wikiPageId: "123",
      revisionId: "456",
      title: "Lothlórien",
      language: "en",
      narrationVersion: 2,
      summary: "An Elven realm in Middle-earth.",
      sections: [
        {
          wikiSectionIndex: "1",
          title: "Description",
          level: 2,
          content: "The realm lies west of the Anduin.",
        },
      ],
      thumbnailUrl: image.src,
      thumbnailAttribution: image.attribution,
    } satisfies WikipediaArticle;

    expect(article.sections[0]?.title).toBe("Description");
    expect(image.attribution.sourceUrl).toContain("commons.wikimedia.org");
  });
});
