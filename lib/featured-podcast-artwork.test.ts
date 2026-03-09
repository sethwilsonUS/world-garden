import { describe, expect, it } from "vitest";
import { formatFeaturedArtworkDate } from "./featured-podcast-artwork";

describe("formatFeaturedArtworkDate", () => {
  it("formats featured artwork dates in UTC", () => {
    expect(formatFeaturedArtworkDate("2026-03-09")).toBe("Mar 9, 2026");
  });
});
