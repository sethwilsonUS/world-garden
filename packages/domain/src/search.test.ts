import { describe, expect, it } from "vitest";

import {
  formatWikipediaSearchStatus,
  normalizeWikipediaSearchTerm,
} from "./index";

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
    },
  );
});
