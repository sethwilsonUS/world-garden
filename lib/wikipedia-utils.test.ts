import { describe, expect, it } from "vitest";
import {
  findWikipediaSectionMetadata,
  normalizeWikipediaSectionTitle,
  normalizeWikipediaTitle,
  slugToWikipediaTitle,
  wikipediaRevisionKey,
} from "./wikipedia-utils";

describe("Wikipedia client-safe utilities", () => {
  it("keys the same page differently for each immutable revision", () => {
    expect(wikipediaRevisionKey({ wikiPageId: "42", revisionId: "100" })).toBe(
      "42:100",
    );
    expect(wikipediaRevisionKey({ wikiPageId: "42", revisionId: "101" })).toBe(
      "42:101",
    );
  });

  it("normalizes titles without interpreting source markup", () => {
    expect(normalizeWikipediaTitle("Walter_Savage  Landor")).toBe(
      "walter savage landor",
    );
    expect(normalizeWikipediaSectionTitle("  EARLY   LIFE ")).toBe(
      "early life",
    );
  });

  it("converts route slugs with literal underscore replacement", () => {
    expect(slugToWikipediaTitle("Walter_Savage_Landor")).toBe(
      "Walter Savage Landor",
    );
  });

  it("resolves duplicate headings by section index and only title-falls back for legacy metadata", () => {
    const indexed = [
      { index: "3", title: "History", value: "first" },
      { index: "8", title: "History", value: "second" },
    ];

    expect(
      findWikipediaSectionMetadata(indexed, {
        sectionIndex: "8",
        sectionTitle: "History",
      })?.value,
    ).toBe("second");
    expect(
      findWikipediaSectionMetadata(indexed, {
        sectionIndex: "99",
        sectionTitle: "History",
      }),
    ).toBeUndefined();

    expect(
      findWikipediaSectionMetadata(
        [{ title: "History", value: "legacy" }],
        { sectionIndex: "8", sectionTitle: "  HISTORY " },
      )?.value,
    ).toBe("legacy");
  });
});
