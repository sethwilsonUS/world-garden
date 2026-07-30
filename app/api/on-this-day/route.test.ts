import { NextRequest } from "next/server";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { OnThisDaySnapshot } from "@/lib/on-this-day-contracts";

const getOnThisDaySnapshot = vi.fn();
const resolveOnThisDayFeedDate = vi.fn(() => "2026-07-30");

vi.mock("@/lib/on-this-day-snapshot", () => ({
  getOnThisDaySnapshot,
  resolveOnThisDayFeedDate,
}));

const snapshot: OnThisDaySnapshot = {
  schemaVersion: 1,
  provider: "wikifeeds-v1",
  feedDate: "2026-07-30",
  monthDay: "07-30",
  generatedAt: 1,
  sourceUrl: "https://en.wikipedia.org/wiki/July_30",
  categories: {
    selected: [],
    events: Array.from({ length: 30 }, (_, index) => ({
      id: `event-${index}`,
      year: 1900 + index,
      text: `Event ${index}`,
      pages: [],
    })),
    births: [],
    deaths: [],
    holidays: [],
  },
  counts: { selected: 0, events: 30, births: 0, deaths: 0, holidays: 0 },
  availableCategories: {
    selected: true,
    events: true,
    births: true,
    deaths: true,
    holidays: true,
  },
};

describe("GET /api/on-this-day", () => {
  beforeEach(() => {
    vi.resetModules();
    vi.clearAllMocks();
    resolveOnThisDayFeedDate.mockReturnValue("2026-07-30");
    getOnThisDaySnapshot.mockResolvedValue(snapshot);
  });

  it("returns a capped, ordered page with category metadata", async () => {
    const { GET } = await import("./route");
    const response = await GET(
      new NextRequest(
        "https://curiogarden.org/api/on-this-day?date=2026-07-30&category=events&order=oldest&offset=0&limit=99",
      ),
    );
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(response.headers.get("cache-control")).toContain("s-maxage=900");
    expect(getOnThisDaySnapshot).toHaveBeenCalledWith({
      requestedDate: "2026-07-30",
      allowLiveFallback: true,
    });
    expect(body).toMatchObject({
      requestedDate: "2026-07-30",
      snapshotDate: "2026-07-30",
      category: "events",
      order: "oldest",
      limit: 25,
      total: 30,
      nextOffset: 25,
    });
    expect(body.items).toHaveLength(25);
    expect(body.items[0].year).toBe(1900);
  });

  it("rejects invalid filters before loading a snapshot", async () => {
    const { GET } = await import("./route");
    const response = await GET(
      new NextRequest(
        "https://curiogarden.org/api/on-this-day?category=anniversaries",
      ),
    );
    expect(response.status).toBe(400);
    expect(getOnThisDaySnapshot).not.toHaveBeenCalled();
  });
});
