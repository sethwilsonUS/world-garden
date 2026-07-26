import { describe, expect, it } from "vitest";
import {
  findWikipediaSectionMetadata,
  normalizeWikipediaSectionTitle,
  normalizeWikipediaTitle,
  slugToWikipediaTitle,
  wikipediaRevisionKey,
} from "./wikipedia-utils";

describe("Wikipedia client-safe utilities", () => {
  it("keys canonical complete revision identities without delimiter collisions", () => {
    const identity = {
      wikiPageId: "42",
      revisionId: "100",
      title: "Walter Savage Landor",
      language: "en",
    };

    expect(
      wikipediaRevisionKey({
        ...identity,
        wikiPageId: "00042",
        revisionId: "000100",
        title: "Walter_Savage  Landor",
        language: "EN",
      }),
    ).toBe(wikipediaRevisionKey(identity));
    expect(wikipediaRevisionKey({ ...identity, revisionId: "101" })).not.toBe(
      wikipediaRevisionKey(identity),
    );
    expect(
      wikipediaRevisionKey({ ...identity, title: "Another article" }),
    ).not.toBe(wikipediaRevisionKey(identity));
    expect(
      wikipediaRevisionKey({
        ...identity,
        wikiPageId: "1:2",
        revisionId: "3",
      }),
    ).not.toBe(
      wikipediaRevisionKey({
        ...identity,
        wikiPageId: "1",
        revisionId: "2:3",
      }),
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
      findWikipediaSectionMetadata([{ title: "History", value: "legacy" }], {
        sectionIndex: "8",
        sectionTitle: "  HISTORY ",
      })?.value,
    ).toBe("legacy");
  });
});
