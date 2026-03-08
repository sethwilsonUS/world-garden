import { describe, expect, it } from "vitest";
import {
  formatTrendingArtworkDate,
  selectTrendingArtworkTiles,
} from "./trending-podcast-artwork";

describe("formatTrendingArtworkDate", () => {
  it("formats the trending date for artwork badges", () => {
    expect(formatTrendingArtworkDate("2026-03-07")).toBe("Mar 7, 2026");
  });
});

describe("selectTrendingArtworkTiles", () => {
  it("pairs titles with image urls and limits output to four tiles", () => {
    expect(
      selectTrendingArtworkTiles(
        ["One", "Two", "Three", "Four", "Five"],
        ["1.png", "2.png", "3.png", "4.png", "5.png"],
      ),
    ).toEqual([
      { title: "One", imageUrl: "1.png" },
      { title: "Two", imageUrl: "2.png" },
      { title: "Three", imageUrl: "3.png" },
      { title: "Four", imageUrl: "4.png" },
    ]);
  });

  it("falls back to title-only tiles when some image urls are missing", () => {
    expect(
      selectTrendingArtworkTiles(
        ["One", "Two"],
        ["1.png"],
      ),
    ).toEqual([
      { title: "One", imageUrl: "1.png" },
      { title: "Two", imageUrl: undefined },
    ]);
  });
});
