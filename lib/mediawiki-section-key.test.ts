import { describe, expect, it } from "vitest";
import fc from "fast-check";
import {
  createMediaWikiSpecialSectionKey,
  normalizeMediaWikiSpecialSectionKey,
  parseMediaWikiSpecialSectionKey,
} from "./mediawiki-section-key";

describe("MediaWiki special-section keys", () => {
  it("round-trips bounded repeatable source indices and fragments", () => {
    fc.assert(
      fc.property(
        fc.constantFrom("-1" as const, "-2" as const),
        fc.integer({ min: 1, max: 500_000 }),
        fc.integer({ min: 1, max: 500_000 }),
        (sourceIndex, occurrence, fragment) => {
          const key = createMediaWikiSpecialSectionKey(
            sourceIndex,
            occurrence,
            fragment,
          );
          expect(parseMediaWikiSpecialSectionKey(key)).toEqual({
            sourceIndex,
            occurrence,
            fragment,
          });
        },
      ),
    );
  });

  it("canonicalizes padded ordinals without accepting ambiguous raw negatives", () => {
    expect(normalizeMediaWikiSpecialSectionKey("mw-special:-1:0002:0003")).toBe(
      "mw-special:-1:2:3",
    );
    expect(normalizeMediaWikiSpecialSectionKey("-1")).toBeNull();
    expect(normalizeMediaWikiSpecialSectionKey("-2")).toBeNull();
  });

  it("rejects malformed, zero, and over-budget identities", () => {
    for (const value of [
      "mw-special:-3:1:1",
      "mw-special:-1:0:1",
      "mw-special:-1:1:0",
      "mw-special:-1:500001:1",
      "mw-special:-1:1:500001",
      "mw-special:-1:1",
      `mw-special:-1:${"1".repeat(1000)}:1`,
    ]) {
      expect(parseMediaWikiSpecialSectionKey(value)).toBeNull();
    }
  });
});
