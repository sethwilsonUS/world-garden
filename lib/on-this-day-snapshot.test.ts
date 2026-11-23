import { afterEach, describe, expect, it, vi } from "vitest";
import { CURRENT_ON_THIS_DAY_SCHEMA_VERSION } from "./on-this-day-contracts";

const fetchMutation = vi.fn();
const fetchQuery = vi.fn();
const buildOnThisDaySnapshot = vi.fn();
const getTodayWikipediaData = vi.fn();

vi.mock("convex/nextjs", () => ({ fetchMutation, fetchQuery }));
vi.mock("convex/server", () => ({
  anyApi: {
    onThisDay: {
      getDaySnapshot: "getDaySnapshot",
      listRefreshStates: "listRefreshStates",
      saveDaySnapshot: "saveDaySnapshot",
      markDayCheckedUnchanged: "markDayCheckedUnchanged",
      recordRefreshFailure: "recordRefreshFailure",
      claimRefreshLease: "claimRefreshLease",
    },
  },
}));
vi.mock("@/lib/on-this-day", async (importOriginal) => {
  const original = await importOriginal<typeof import("./on-this-day")>();
  return { ...original, buildOnThisDaySnapshot };
});
vi.mock("@/lib/today-snapshot", () => ({ getTodayWikipediaData }));

const makeSnapshot = (monthDay: string, checkedAt = 10_000) => ({
  schemaVersion: CURRENT_ON_THIS_DAY_SCHEMA_VERSION,
  provider: "wikipedia-rest-v1" as const,
  monthDay,
  checkedAt,
  sourceUrl: `https://en.wikipedia.org/wiki/${monthDay}`,
  categories: {
    selected: [
      { id: `selected-${monthDay}`, year: 1999, text: `Item ${monthDay}`, pages: [] },
    ],
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
});

afterEach(async () => {
  const mod = await import("./on-this-day-snapshot");
  mod.clearLocalOnThisDayCache();
  vi.clearAllMocks();
  delete process.env.NEXT_PUBLIC_LOCAL_MODE;
  delete process.env.NEXT_PUBLIC_CONVEX_URL;
  delete process.env.TTS_QUOTA_BYPASS_SECRET;
});

describe("on-this-day-snapshot", () => {
  it("caches up to 10 days with a 1-hour LRU TTL in local mode", async () => {
    process.env.NEXT_PUBLIC_LOCAL_MODE = "true";
    buildOnThisDaySnapshot.mockImplementation(async ({ day, checkedAt }) =>
      makeSnapshot(
        `${String(day.month).padStart(2, "0")}-${String(day.day).padStart(2, "0")}`,
        checkedAt,
      ),
    );

    const { getOnThisDayDayRecord } = await import("./on-this-day-snapshot");
    const t0 = 1_000_000;

    // Load 10 days
    for (let day = 1; day <= 10; day += 1) {
      await getOnThisDayDayRecord({ day: { month: 1, day }, now: t0 });
    }
    expect(buildOnThisDaySnapshot).toHaveBeenCalledTimes(10);

    // Hit day 1 -> cached (moves day 1 to MRU, day 2 is now LRU)
    await getOnThisDayDayRecord({ day: { month: 1, day: 1 }, now: t0 + 1000 });
    expect(buildOnThisDaySnapshot).toHaveBeenCalledTimes(10);

    // Load day 11 -> evicts day 2
    await getOnThisDayDayRecord({ day: { month: 1, day: 11 }, now: t0 + 2000 });
    expect(buildOnThisDaySnapshot).toHaveBeenCalledTimes(11);

    // Day 1 is still cached; day 2 must rebuild
    await getOnThisDayDayRecord({ day: { month: 1, day: 1 }, now: t0 + 3000 });
    expect(buildOnThisDaySnapshot).toHaveBeenCalledTimes(11);
    await getOnThisDayDayRecord({ day: { month: 1, day: 2 }, now: t0 + 3000 });
    expect(buildOnThisDaySnapshot).toHaveBeenCalledTimes(12);

    // After 1 hour TTL, day 1 rebuilds
    await getOnThisDayDayRecord({
      day: { month: 1, day: 1 },
      now: t0 + 60 * 60 * 1000 + 10,
    });
    expect(buildOnThisDaySnapshot).toHaveBeenCalledTimes(13);
  });

  it("returns stored Convex snapshots and flags safety-net refreshes when stale", async () => {
    process.env.NEXT_PUBLIC_LOCAL_MODE = "false";
    process.env.NEXT_PUBLIC_CONVEX_URL = "https://example.convex.cloud";
    const now = Date.UTC(2026, 2, 25, 12, 0, 0);
    const oldCheckedAt = now - 15 * 24 * 60 * 60 * 1000;

    fetchQuery.mockResolvedValue({
      monthDay: "03-05",
      schemaVersion: 2,
      contentHash: "hash-1",
      data: makeSnapshot("03-05", oldCheckedAt),
      state: {
        monthDay: "03-05",
        schemaVersion: 2,
        degraded: false,
        checkedAt: oldCheckedAt,
        changedAt: oldCheckedAt,
        imagesCheckedAt: oldCheckedAt,
        suspiciousStreak: 0,
      },
    });

    const { getOnThisDayDayRecord } = await import("./on-this-day-snapshot");
    const result = await getOnThisDayDayRecord({
      day: { month: 3, day: 5 },
      now,
    });

    expect(result?.snapshot.monthDay).toBe("03-05");
    expect(result?.needsSafetyNetRefresh).toBe(true);
    expect(buildOnThisDaySnapshot).not.toHaveBeenCalled();
  });

  it("builds a fast cold day without image enrichment and saves imagesCheckedAt=0", async () => {
    process.env.NEXT_PUBLIC_LOCAL_MODE = "false";
    process.env.NEXT_PUBLIC_CONVEX_URL = "https://example.convex.cloud";
    process.env.TTS_QUOTA_BYPASS_SECRET = "test-secret";
    fetchQuery.mockResolvedValue(null);
    fetchMutation.mockResolvedValue("day-id");
    const cold = makeSnapshot("03-05", 50_000);
    buildOnThisDaySnapshot.mockResolvedValue(cold);

    const { getOnThisDayDayRecord } = await import("./on-this-day-snapshot");
    const result = await getOnThisDayDayRecord({
      day: { month: 3, day: 5 },
      allowColdBuild: true,
      now: 50_000,
    });

    expect(buildOnThisDaySnapshot).toHaveBeenCalledWith({
      day: { month: 3, day: 5 },
      skipImageResolution: true,
      checkedAt: 50_000,
    });
    expect(fetchMutation).toHaveBeenCalledWith(
      "saveDaySnapshot",
      expect.objectContaining({
        monthDay: "03-05",
        imagesCheckedAt: 0,
        degraded: false,
      }),
    );
    expect(result?.snapshot).toBe(cold);
  });

  it("only runs triggerSafetyNetRefresh when the Convex lease is claimed", async () => {
    process.env.NEXT_PUBLIC_LOCAL_MODE = "false";
    process.env.NEXT_PUBLIC_CONVEX_URL = "https://example.convex.cloud";
    process.env.TTS_QUOTA_BYPASS_SECRET = "test-secret";
    fetchMutation.mockResolvedValueOnce(false);

    const { triggerSafetyNetRefresh } = await import("./on-this-day-snapshot");
    const skipped = await triggerSafetyNetRefresh({ month: 3, day: 5 }, 10_000);
    expect(skipped).toBeNull();
    expect(buildOnThisDaySnapshot).not.toHaveBeenCalled();
  });
});
