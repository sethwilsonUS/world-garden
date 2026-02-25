import { describe, it, expect } from "vitest";
import {
  isCategoryNsfw,
  isDisambiguation,
  isUnsuitableForRandom,
} from "@/lib/nsfw-filter";

describe("isCategoryNsfw", () => {
  describe("exact category matches", () => {
    it("flags Category:Sexual acts", () => {
      expect(isCategoryNsfw("Category:Sexual acts")).toBe(true);
    });

    it("flags Category:Shock sites", () => {
      expect(isCategoryNsfw("Category:Shock sites")).toBe(true);
    });

    it("flags Category:BDSM", () => {
      expect(isCategoryNsfw("Category:BDSM")).toBe(true);
    });

    it("flags Category:Gratis pornography", () => {
      expect(isCategoryNsfw("Category:Gratis pornography")).toBe(true);
    });

    it("flags Category:Sex positions", () => {
      expect(isCategoryNsfw("Category:Sex positions")).toBe(true);
    });

    it("flags Category:Pornography terminology", () => {
      expect(isCategoryNsfw("Category:Pornography terminology")).toBe(true);
    });
  });

  describe("keyword substring matches", () => {
    it("flags categories containing 'pornograph'", () => {
      expect(isCategoryNsfw("Category:2000s pornographic films")).toBe(true);
    });

    it("flags categories containing 'erotic'", () => {
      expect(isCategoryNsfw("Category:Canadian erotica and pornography websites")).toBe(true);
    });

    it("flags categories containing 'fetish'", () => {
      expect(isCategoryNsfw("Category:Rubber and PVC fetishism")).toBe(true);
    });

    it("flags categories containing 'hentai'", () => {
      expect(isCategoryNsfw("Category:Hentai anime and manga")).toBe(true);
    });

    it("flags categories containing 'obscenity'", () => {
      expect(isCategoryNsfw("Category:Obscenity controversies in film")).toBe(true);
    });

    it("is case-insensitive for keyword matching", () => {
      expect(isCategoryNsfw("Category:PORNOGRAPHY in Brazil")).toBe(true);
      expect(isCategoryNsfw("Category:Erotic Photography")).toBe(true);
    });
  });

  describe("safe categories pass through", () => {
    it("allows Category:History of mathematics", () => {
      expect(isCategoryNsfw("Category:History of mathematics")).toBe(false);
    });

    it("allows Category:1980s introductions", () => {
      expect(isCategoryNsfw("Category:1980s introductions")).toBe(false);
    });

    it("allows Category:Articles with short description", () => {
      expect(isCategoryNsfw("Category:Articles with short description")).toBe(false);
    });

    it("allows Category:Living people", () => {
      expect(isCategoryNsfw("Category:Living people")).toBe(false);
    });

    it("allows Category:Physics", () => {
      expect(isCategoryNsfw("Category:Physics")).toBe(false);
    });

    it("allows Category:Wikipedia pages semi-protected against vandalism", () => {
      expect(isCategoryNsfw("Category:Wikipedia pages semi-protected against vandalism")).toBe(false);
    });

    it("allows empty string", () => {
      expect(isCategoryNsfw("")).toBe(false);
    });
  });
});

describe("isDisambiguation", () => {
  it("flags Category:All disambiguation pages", () => {
    expect(isDisambiguation("Category:All disambiguation pages")).toBe(true);
  });

  it("flags Category:All article disambiguation pages", () => {
    expect(isDisambiguation("Category:All article disambiguation pages")).toBe(true);
  });

  it("flags Category:Human name disambiguation pages", () => {
    expect(isDisambiguation("Category:Human name disambiguation pages")).toBe(true);
  });

  it("is case-insensitive", () => {
    expect(isDisambiguation("Category:Disambiguation pages")).toBe(true);
    expect(isDisambiguation("Category:ALL DISAMBIGUATION PAGES")).toBe(true);
  });

  it("allows regular categories", () => {
    expect(isDisambiguation("Category:Living people")).toBe(false);
    expect(isDisambiguation("Category:Physics")).toBe(false);
    expect(isDisambiguation("")).toBe(false);
  });
});

describe("isUnsuitableForRandom", () => {
  const safe = [{ title: "Category:Living people" }];

  describe("list-of title filtering", () => {
    it("flags titles starting with 'List of'", () => {
      expect(isUnsuitableForRandom("List of U.S. presidents", safe)).toBe(true);
    });

    it("is case-insensitive for 'list of' prefix", () => {
      expect(isUnsuitableForRandom("list of rivers in France", safe)).toBe(true);
      expect(isUnsuitableForRandom("LIST OF Olympic medalists", safe)).toBe(true);
      expect(isUnsuitableForRandom("List Of sovereign states", safe)).toBe(true);
    });

    it("does not flag titles that merely contain 'list of' mid-string", () => {
      expect(isUnsuitableForRandom("Schindler's List", safe)).toBe(false);
      expect(isUnsuitableForRandom("The Blacklist of Hollywood", safe)).toBe(false);
    });
  });

  describe("disambiguation category filtering", () => {
    it("flags articles with disambiguation categories", () => {
      expect(
        isUnsuitableForRandom("Mercury", [
          { title: "Category:All disambiguation pages" },
        ]),
      ).toBe(true);
    });
  });

  describe("NSFW category filtering", () => {
    it("flags articles with NSFW categories", () => {
      expect(
        isUnsuitableForRandom("Some Article", [
          { title: "Category:Sexual acts" },
        ]),
      ).toBe(true);
    });

    it("flags articles with NSFW keyword categories", () => {
      expect(
        isUnsuitableForRandom("Some Article", [
          { title: "Category:Hentai anime and manga" },
        ]),
      ).toBe(true);
    });
  });

  describe("clean articles pass through", () => {
    it("allows a normal title with safe categories", () => {
      expect(
        isUnsuitableForRandom("Albert Einstein", [
          { title: "Category:Living people" },
          { title: "Category:Physics" },
        ]),
      ).toBe(false);
    });

    it("allows a normal title with no categories", () => {
      expect(isUnsuitableForRandom("Quantum mechanics", [])).toBe(false);
    });
  });
});
