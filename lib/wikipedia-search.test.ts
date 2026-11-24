import { describe, expect, it } from "vitest";

import {
  formatWikipediaSearchStatus,
  formatWikipediaTypeaheadStatus,
  normalizeWikipediaSearchResponse,
  normalizeWikipediaSearchTerm,
} from "./wikipedia-search";

describe("Wikipedia search language", () => {
  it("normalizes user-entered whitespace without changing their words", () => {
    expect(normalizeWikipediaSearchTerm(" \n The\tTwo\u00a0Towers  ")).toBe(
      "The Two Towers",
    );
    expect(normalizeWikipediaSearchTerm("   ")).toBe("");
  });

  it("formats the pending search announcement", () => {
    expect(formatWikipediaSearchStatus("  Moria  ")).toBe(
      "Searching Wikipedia for Moria.",
    );
  });

  it("formats empty, singular, and plural result announcements", () => {
    expect(formatWikipediaSearchStatus("Entwives", 0)).toBe(
      "No search results found for Entwives.",
    );
    expect(formatWikipediaSearchStatus("Entwives", 1)).toBe(
      "1 search result found for Entwives.",
    );
    expect(formatWikipediaSearchStatus("Entwives", 2)).toBe(
      "2 search results found for Entwives.",
    );
  });

  it("appends Did you mean guidance to search status when a suggestion is present", () => {
    expect(
      formatWikipediaSearchStatus("Albrt Einstien", 0, "albert einstein"),
    ).toBe(
      "No search results found for Albrt Einstien. Did you mean albert einstein?",
    );
    expect(
      formatWikipediaSearchStatus("Shakespere", 3, "shakespeare"),
    ).toBe("3 search results found for Shakespere. Did you mean shakespeare?");
    expect(formatWikipediaSearchStatus("Moria", 1, "   ")).toBe(
      "1 search result found for Moria.",
    );
  });

  it("normalizes legacy result arrays and structured search responses", () => {
    const sample = [
      {
        wikiPageId: "974",
        title: "Ada Lovelace",
        description: "English mathematician and writer",
        url: "https://en.wikipedia.org/wiki/Ada_Lovelace",
      },
    ];
    expect(normalizeWikipediaSearchResponse(sample)).toEqual({
      results: sample,
    });
    expect(
      normalizeWikipediaSearchResponse({
        results: sample,
        suggestion: "  ada lovelace  ",
      }),
    ).toEqual({
      results: sample,
      suggestion: "ada lovelace",
    });
    expect(
      normalizeWikipediaSearchResponse({
        results: sample,
        suggestion: "   ",
      }),
    ).toEqual({
      results: sample,
    });
  });

  it("formats accessible typeahead live announcements", () => {
    expect(formatWikipediaTypeaheadStatus("   ", 3)).toBe("");
    expect(formatWikipediaTypeaheadStatus("Zzzq", 0)).toBe(
      "No instant suggestions for Zzzq. Press Enter to run a full search.",
    );
    expect(formatWikipediaTypeaheadStatus("Ada", 1)).toBe(
      "1 suggestion available for Ada. Use up and down arrow keys to choose, or press Enter to search.",
    );
    expect(formatWikipediaTypeaheadStatus("Ada", 6)).toBe(
      "6 suggestions available for Ada. Use up and down arrow keys to choose, or press Enter to search.",
    );
  });

  it("keeps an idle search silent", () => {
    expect(formatWikipediaSearchStatus("   ")).toBe("");
    expect(formatWikipediaSearchStatus("   ", 0)).toBe("");
  });

  it.each([-1, 1.5, Number.NaN, Number.POSITIVE_INFINITY])(
    "rejects an impossible result count: %s",
    (resultCount) => {
      expect(() =>
        formatWikipediaSearchStatus("Rivendell", resultCount),
      ).toThrow(RangeError);
      expect(() =>
        formatWikipediaTypeaheadStatus("Rivendell", resultCount),
      ).toThrow(RangeError);
    },
  );
});
