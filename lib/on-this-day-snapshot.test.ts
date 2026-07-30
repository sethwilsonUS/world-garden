import { afterEach, describe, expect, it, vi } from "vitest";

const fetchMutation = vi.fn();
const fetchQuery = vi.fn();
const buildOnThisDaySnapshot = vi.fn();
const getTodayWikipediaData = vi.fn();

vi.mock("convex/nextjs", () => ({ fetchMutation, fetchQuery }));
vi.mock("convex/server", () => ({
  anyApi: {
    onThisDay: {
      getOnThisDaySnapshotByDate: "exact",
      getLatestOnThisDaySnapshotForMonthDay: "month-day",
      saveOnThisDaySnapshot: "save",
    },
  },
}));
vi.mock("@/lib/on-this-day", async (importOriginal) => {
  const original = await importOriginal<typeof import("./on-this-day")>();
  return { ...original, buildOnThisDaySnapshot };
});
vi.mock("@/lib/today-snapshot", () => ({ getTodayWikipediaData }));

const archived = {
  schemaVersion: 1 as const,
  provider: "wikifeeds-v1" as const,
  feedDate: "2025-07-30",
  monthDay: "07-30",
  generatedAt: 1,
  sourceUrl: "https://en.wikipedia.org/wiki/July_30",
  categories: {
    selected: [{ id: "selected-old", year: 2024, text: "Archived", pages: [] }],
    events: [],
    births: [],
    deaths: [],
    holidays: [],
  },
  counts: { selected: 1, events: 0, births: 0, deaths: 0, holidays: 0 },
  availableCategories: {
    selected: true,
    events: true,
    births: true,
    deaths: true,
    holidays: true,
  },
};

afterEach(() => {
  vi.clearAllMocks();
  delete process.env.NEXT_PUBLIC_LOCAL_MODE;
  delete process.env.NEXT_PUBLIC_CONVEX_URL;
});

describe("getOnThisDaySnapshot", () => {
  it("returns an exact persisted edition without consulting live or archived data", async () => {
    process.env.NEXT_PUBLIC_LOCAL_MODE = "false";
    process.env.NEXT_PUBLIC_CONVEX_URL = "https://example.convex.cloud";
    fetchQuery.mockResolvedValue({ feedDate: archived.feedDate, data: archived });

    const { getOnThisDaySnapshot } = await import("./on-this-day-snapshot");
    const result = await getOnThisDaySnapshot({
      requestedDate: "2025-07-30",
      allowLiveFallback: true,
      now: new Date("2026-07-30T12:00:00Z"),
    });

    expect(result).toBe(archived);
    expect(fetchQuery).toHaveBeenCalledTimes(1);
    expect(fetchQuery).toHaveBeenCalledWith("exact", {
      feedDate: "2025-07-30",
    });
    expect(buildOnThisDaySnapshot).not.toHaveBeenCalled();
  });

  it("uses only a matching month/day archive after today's live sources fail", async () => {
    process.env.NEXT_PUBLIC_LOCAL_MODE = "false";
    process.env.NEXT_PUBLIC_CONVEX_URL = "https://example.convex.cloud";
    fetchQuery.mockImplementation(async (query: string) => {
      if (query === "exact") return null;
      if (query === "month-day") {
        return { feedDate: archived.feedDate, data: archived };
      }
      return null;
    });
    buildOnThisDaySnapshot.mockRejectedValue(new Error("Wikifeeds unavailable"));
    getTodayWikipediaData.mockResolvedValue(null);

    const { getOnThisDaySnapshot } = await import("./on-this-day-snapshot");
    const result = await getOnThisDaySnapshot({
      requestedDate: "2026-07-30",
      allowLiveFallback: true,
      now: new Date("2026-07-30T12:00:00Z"),
    });

    expect(result?.feedDate).toBe("2025-07-30");
    expect(fetchQuery).toHaveBeenCalledWith("month-day", {
      monthDay: "07-30",
    });
    expect(buildOnThisDaySnapshot).toHaveBeenCalledWith({
      feedDate: "2026-07-30",
    });

    fetchQuery.mockResolvedValue(null);
    const historical = await getOnThisDaySnapshot({
      requestedDate: "2024-07-30",
      allowLiveFallback: true,
      now: new Date("2026-07-30T12:00:00Z"),
    });
    expect(historical).toBeNull();
    expect(buildOnThisDaySnapshot).toHaveBeenCalledTimes(1);
  });

  it("uses an exact-date selected-only fallback when the cron feed fails", async () => {
    process.env.NEXT_PUBLIC_LOCAL_MODE = "true";
    buildOnThisDaySnapshot.mockRejectedValue(new Error("Wikifeeds unavailable"));
    getTodayWikipediaData.mockResolvedValue({
      onThisDay: [
        {
          year: 1969,
          text: "Apollo 11 returned to Earth.",
          pages: [],
        },
      ],
    });

    const { syncOnThisDaySnapshot } = await import("./on-this-day-snapshot");
    const result = await syncOnThisDaySnapshot({ feedDate: "2026-07-30" });

    expect(result.provider).toBe("featured-fallback");
    expect(result.categories.selected).toHaveLength(1);
    expect(result.availableCategories).toEqual({
      selected: true,
      events: false,
      births: false,
      deaths: false,
      holidays: false,
    });
  });
});
