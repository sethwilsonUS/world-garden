import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { DashboardBadgeCard } from "./DashboardBadgeCard";

describe("DashboardBadgeCard", () => {
  it("renders locked badges with progress to level 1", () => {
    const markup = renderToStaticMarkup(
      createElement(DashboardBadgeCard, {
        badges: [
          {
            key: "history",
            label: "History",
            description: "Stories of empires.",
            glyph: "quill-scroll",
            exp: 2,
            creditedArticleCount: 2,
            level: 0,
            expIntoLevel: 2,
            expForNextLevel: 5,
            nextLevelTarget: 5,
          },
        ],
        totalExp: 2,
        unlockedBadgeCount: 0,
        isLoaded: true,
      }),
    );

    expect(markup).toContain("History");
    expect(markup).toContain("2 / 5 EXP to level 1");
    expect(markup).toContain("Lvl 0");
    expect(markup).toContain(
      "Podcast plays in podcast apps do not count toward badges yet.",
    );
  });

  it("renders unlocked badges with next-level progress", () => {
    const markup = renderToStaticMarkup(
      createElement(DashboardBadgeCard, {
        badges: [
          {
            key: "history",
            label: "History",
            description: "Stories of empires.",
            glyph: "quill-scroll",
            exp: 5,
            creditedArticleCount: 5,
            level: 1,
            expIntoLevel: 0,
            expForNextLevel: 10,
            nextLevelTarget: 15,
          },
        ],
        totalExp: 5,
        unlockedBadgeCount: 1,
        isLoaded: true,
      }),
    );

    expect(markup).toContain("5 total EXP");
    expect(markup).toContain("1 unlocked");
    expect(markup).toContain("Lvl 1");
    expect(markup).toContain("0 / 10 EXP to level 2");
  });
});
