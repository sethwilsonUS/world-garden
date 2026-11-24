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
  mapWikimediaTopicsToBadgeKeys,
  mapWikimediaTopicToBadgeKey,
  normalizeWikimediaTopicSlug,
  parseCirrusWeightedArticleTopics,
  WIKIMEDIA_TOPIC_MIN_CONFIDENCE,
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

describe("Wikimedia taxonomy topic-to-badge mapping", () => {
  it("maps representative Wikimedia taxonomy labels deterministically across all 8 domains", () => {
    expect(
      mapWikimediaTopicToBadgeKey("History_and_Society.Military_and_warfare"),
    ).toBe("history");
    expect(mapWikimediaTopicToBadgeKey("History_and_Society.History")).toBe(
      "history",
    );
    expect(
      mapWikimediaTopicToBadgeKey("Geography.Regions.Americas.South_America"),
    ).toBe("geography");
    expect(
      mapWikimediaTopicToBadgeKey("Geography.Regions.Europe.Europe*"),
    ).toBe("geography");
    expect(
      mapWikimediaTopicToBadgeKey("Culture.Biography.Biography*"),
    ).toBe("biography");
    expect(
      mapWikimediaTopicToBadgeKey(
        "History_and_Society.Politics_and_government",
      ),
    ).toBe("society_politics");
    expect(
      mapWikimediaTopicToBadgeKey("Culture.Philosophy_and_religion"),
    ).toBe("society_politics");
    expect(mapWikimediaTopicToBadgeKey("Culture.Media.Music")).toBe(
      "arts_culture",
    );
    expect(mapWikimediaTopicToBadgeKey("Culture.Linguistics")).toBe(
      "arts_culture",
    );
    expect(mapWikimediaTopicToBadgeKey("STEM.Physics")).toBe("science");
    expect(mapWikimediaTopicToBadgeKey("STEM.Medicine_&_Health")).toBe(
      "science",
    );
    expect(mapWikimediaTopicToBadgeKey("STEM.STEM*")).toBe("science");
    expect(mapWikimediaTopicToBadgeKey("STEM.Computing")).toBe("technology");
    expect(mapWikimediaTopicToBadgeKey("Culture.Media.Software")).toBe(
      "technology",
    );
    expect(mapWikimediaTopicToBadgeKey("STEM.Libraries_&_Information")).toBe(
      "technology",
    );
    expect(mapWikimediaTopicToBadgeKey("STEM.Biology")).toBe("nature");
    expect(mapWikimediaTopicToBadgeKey("STEM.Earth_and_environment")).toBe(
      "nature",
    );
    expect(mapWikimediaTopicToBadgeKey("STEM.Space")).toBe("nature");
    expect(mapWikimediaTopicToBadgeKey("Unknown.Nonexistent")).toBeNull();
    expect(normalizeWikimediaTopicSlug("  STEM.Libraries_&_Information  ")).toBe(
      "libraries-and-information",
    );
  });

  it("filters by confidence and outputs deduplicated badge keys in canonical launch order", () => {
    expect(
      mapWikimediaTopicsToBadgeKeys([
        { topic: "STEM.Biology", score: 0.99 },
        { topic: "STEM.STEM*", score: 0.95 },
        { topic: "History_and_Society.History", score: 0.49 },
        { topic: "Geography.Geographical", score: Number.NaN },
        { topic: "Culture.Media.Software", score: WIKIMEDIA_TOPIC_MIN_CONFIDENCE },
        { topic: "STEM.Computing", score: 0.91 },
      ]),
    ).toEqual(["science", "technology", "nature"]);
  });

  it("parses cirrusdoc weighted_tags articletopic predictions and ignores unrelated tags", () => {
    expect(
      parseCirrusWeightedArticleTopics([
        "classification.prediction.articlecountry/United Kingdom|1000",
        "classification.prediction.drafttopic/STEM.STEM*|645",
        "classification.prediction.articletopic/Culture.Biography.Biography*|538",
        "classification.prediction.articletopic/STEM.Physics|1000",
        "classification.prediction.articletopic/Invalid.Weight|-10",
        "classification.prediction.articletopic/Broken.Weight|abc",
        "classification.prediction.articletopic/History_and_Society.History",
        "ext.pageassessments.project/Mathematics|100",
        42,
      ]),
    ).toEqual([
      { topic: "Culture.Biography.Biography*", score: 0.538 },
      { topic: "STEM.Physics", score: 1 },
      { topic: "History_and_Society.History", score: 1 },
    ]);
  });
});
