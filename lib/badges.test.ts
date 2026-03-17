import { describe, expect, it } from "vitest";
import {
  BADGE_DEFINITIONS,
  BADGE_KEYS,
  buildAwardedBadgeProgress,
  buildBadgeProgress,
  expRequiredForLevel,
  getBadgeProgressLabel,
  getBadgeProgressPercent,
  getBadgeTopicQuery,
} from "./badges";

describe("badge config", () => {
  it("keeps the badge keys in the launch order", () => {
    expect(BADGE_KEYS).toEqual([
      "history",
      "geography",
      "biography",
      "society_politics",
      "arts_culture",
      "science",
      "technology",
      "nature",
    ]);
  });

  it("exposes articletopic queries for each badge", () => {
    expect(getBadgeTopicQuery("history")).toContain("history");
    expect(getBadgeTopicQuery("technology")).toContain("technology");
    expect(BADGE_DEFINITIONS).toHaveLength(8);
  });
});

describe("badge level math", () => {
  it("uses the exact gentle-ramp thresholds", () => {
    expect(expRequiredForLevel(1)).toBe(5);
    expect(expRequiredForLevel(2)).toBe(15);
    expect(expRequiredForLevel(3)).toBe(30);
    expect(expRequiredForLevel(4)).toBe(50);
    expect(expRequiredForLevel(5)).toBe(75);
  });

  it("builds progress metadata for locked and unlocked badges", () => {
    expect(buildBadgeProgress("history", 0)).toMatchObject({
      level: 0,
      expIntoLevel: 0,
      expForNextLevel: 5,
      nextLevelTarget: 5,
    });

    expect(buildBadgeProgress("history", 5)).toMatchObject({
      level: 1,
      expIntoLevel: 0,
      expForNextLevel: 10,
      nextLevelTarget: 15,
    });

    expect(buildBadgeProgress("history", 16)).toMatchObject({
      level: 2,
      expIntoLevel: 1,
      expForNextLevel: 15,
      nextLevelTarget: 30,
    });
  });

  it("shares progress labels and percentages for display surfaces", () => {
    expect(getBadgeProgressLabel(buildBadgeProgress("history", 2))).toBe(
      "2 / 5 EXP to level 1",
    );
    expect(getBadgeProgressPercent(buildBadgeProgress("history", 2))).toBe(40);
  });

  it("marks award payloads when a new level is reached", () => {
    expect(buildAwardedBadgeProgress("history", 1)).toMatchObject({
      level: 0,
      previousLevel: 0,
      leveledUp: false,
      gainedExp: 1,
    });

    expect(buildAwardedBadgeProgress("history", 5)).toMatchObject({
      level: 1,
      previousLevel: 0,
      leveledUp: true,
      gainedExp: 1,
    });
  });
});
