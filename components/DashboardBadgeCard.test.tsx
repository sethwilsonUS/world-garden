import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { buildEmptyBadgeCreditsByBadge } from "@/lib/badges";
import { DashboardBadgeCard } from "./DashboardBadgeCard";

describe("DashboardBadgeCard", () => {
  it("renders locked badges with progress to level 1", () => {
    const badgeCredits = buildEmptyBadgeCreditsByBadge();

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
        badgeCredits,
        totalExp: 2,
        unlockedBadgeCount: 0,
        isLoaded: true,
      }),
    );

    expect(markup).toContain("History");
    expect(markup).toContain("2 / 5 EXP to level 1");
    expect(markup).toContain("Open History badge details.");
    expect(markup).toContain('aria-haspopup="dialog"');
    expect(markup).toContain(
      "Podcast plays in podcast apps do not count toward badges yet.",
    );
    expect(markup).not.toContain("Stories of empires.");
  });

  it("renders unlocked badges with next-level progress", () => {
    const badgeCredits = buildEmptyBadgeCreditsByBadge();

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
        badgeCredits,
        totalExp: 5,
        unlockedBadgeCount: 1,
        isLoaded: true,
      }),
    );

    expect(markup).toContain("5 EXP");
    expect(markup).toContain("1 unlocked");
    expect(markup).toContain("0 / 10 EXP to level 2");
    expect(markup).toContain("Open History badge details.");
  });
});
