import { afterEach, describe, expect, it, vi } from "vitest";
import sitemap from "./sitemap";

const { listOnThisDayRefreshStates } = vi.hoisted(() => ({
  listOnThisDayRefreshStates: vi.fn(),
}));

vi.mock("@/lib/on-this-day-snapshot", () => ({
  listOnThisDayRefreshStates,
}));

const originalSiteUrl = process.env.NEXT_PUBLIC_SITE_URL;

afterEach(() => {
  listOnThisDayRefreshStates.mockReset();
  if (originalSiteUrl === undefined) {
    delete process.env.NEXT_PUBLIC_SITE_URL;
  } else {
    process.env.NEXT_PUBLIC_SITE_URL = originalSiteUrl;
  }
});

describe("sitemap", () => {
  it("lists canonical public pages plus all 366 On This Day calendar day URLs", async () => {
    process.env.NEXT_PUBLIC_SITE_URL = "https://curiogarden.org/";
    const marchFifthChangedAt = Date.UTC(2026, 2, 5, 10, 0, 0);
    listOnThisDayRefreshStates.mockResolvedValue([
      {
        monthDay: "03-05",
        schemaVersion: 2,
        degraded: false,
        checkedAt: marchFifthChangedAt,
        changedAt: marchFifthChangedAt,
        imagesCheckedAt: marchFifthChangedAt,
        suspiciousStreak: 0,
      },
    ]);

    const entries = await sitemap();
    const expectedStatic = [
      "/",
      "/on-this-day",
      "/trending",
      "/podcasts",
      "/podcasts/featured",
      "/podcasts/trending",
      "/about",
      "/feedback",
      "/privacy",
      "/terms",
    ].map((path) => ({
      url: `https://curiogarden.org${path === "/" ? "" : path}`,
    }));

    expect(entries.slice(0, expectedStatic.length)).toEqual(expectedStatic);
    expect(entries).toHaveLength(expectedStatic.length + 366);

    const marchFifth = entries.find(
      (entry) => entry.url === "https://curiogarden.org/on-this-day/march-5",
    );
    expect(marchFifth).toEqual({
      url: "https://curiogarden.org/on-this-day/march-5",
      lastModified: new Date(marchFifthChangedAt),
    });

    expect(
      entries.some(
        (entry) =>
          entry.url === "https://curiogarden.org/on-this-day/february-29",
      ),
    ).toBe(true);
  });

  it("excludes utility and legacy redirect URLs", async () => {
    listOnThisDayRefreshStates.mockResolvedValue([]);
    const entries = await sitemap();
    const paths = entries.map((entry) => new URL(entry.url).pathname);

    expect(paths).not.toContain("/library");
    expect(paths).not.toContain("/search");
    expect(paths).not.toContain("/dashboard");
    expect(paths).not.toContain("/podcast");
    expect(paths).not.toContain("/did-you-know");
  });
});
