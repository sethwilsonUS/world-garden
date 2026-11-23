import { describe, expect, it, vi } from "vitest";
import { ALL_CALENDAR_DAYS, calendarDayKey } from "./calendar-day";
import {
  hashOnThisDaySnapshot,
  OnThisDayUpstreamError,
  type OnThisDayFeedPayload,
  type OnThisDayProvider,
} from "./on-this-day";
import {
  CURRENT_ON_THIS_DAY_SCHEMA_VERSION,
  type OnThisDayRefreshState,
  type OnThisDaySnapshot,
} from "./on-this-day-contracts";
import {
  DEGRADED_RETRY_COOLDOWN_MS,
  FRESHNESS_TARGET_MS,
  IMAGE_RE_RESOLVE_MAX_AGE_MS,
  SAFETY_NET_MAX_AGE_MS,
  TODAY_WINDOW_MAX_AGE_MS,
  refreshCalendarDay,
  runRollingRefreshWorker,
  selectRefreshQueue,
  shouldTriggerSafetyNetRefresh,
  type OnThisDayRefreshStore,
  type StoredOnThisDayDay,
} from "./on-this-day-refresh";

const makeFeedPayload = ({
  selectedCount = 5,
  eventsCount = 10,
  birthsCount = 6,
  deathsCount = 6,
  holidaysCount = 4,
  imageSource = "https://upload.wikimedia.org/wikipedia/commons/sample.jpg",
  prefix = "Event",
}: {
  selectedCount?: number;
  eventsCount?: number;
  birthsCount?: number;
  deathsCount?: number;
  holidaysCount?: number;
  imageSource?: string;
  prefix?: string;
} = {}): OnThisDayFeedPayload => {
  const buildEntries = (label: string, count: number, includeYear = true) =>
    Array.from({ length: count }, (_, index) => ({
      ...(includeYear ? { year: 2000 - index } : {}),
      text: `${prefix} ${label} ${index + 1}`,
      pages: [
        {
          titles: { normalized: `${label} ${index + 1}` },
          pageid: index + 1,
          ...(index === 0 && label === "selected"
            ? {
                thumbnail: {
                  source: imageSource,
                  width: 320,
                  height: 240,
                },
              }
            : {}),
        },
      ],
    }));

  return {
    selected: buildEntries("selected", selectedCount),
    events: buildEntries("events", eventsCount),
    births: buildEntries("births", birthsCount),
    deaths: buildEntries("deaths", deathsCount),
    holidays: buildEntries("holidays", holidaysCount, false),
  };
};

const createMemoryStore = (): {
  store: OnThisDayRefreshStore;
  days: Map<string, StoredOnThisDayDay>;
  states: Map<string, OnThisDayRefreshState>;
  saveSpy: ReturnType<typeof vi.fn>;
  touchSpy: ReturnType<typeof vi.fn>;
  failureSpy: ReturnType<typeof vi.fn>;
} => {
  const days = new Map<string, StoredOnThisDayDay>();
  const states = new Map<string, OnThisDayRefreshState>();

  const saveSpy = vi.fn(
    async (args: Parameters<OnThisDayRefreshStore["saveDaySnapshot"]>[0]) => {
      const state: OnThisDayRefreshState = {
        monthDay: args.monthDay,
        schemaVersion: args.schemaVersion,
        degraded: args.degraded,
        checkedAt: args.checkedAt,
        changedAt: args.changedAt,
        imagesCheckedAt: args.imagesCheckedAt,
        lastAttemptAt: args.lastAttemptAt,
        suspiciousStreak: 0,
      };
      states.set(args.monthDay, state);
      days.set(args.monthDay, {
        monthDay: args.monthDay,
        schemaVersion: args.schemaVersion,
        contentHash: args.contentHash,
        data: args.data,
        state,
      });
    },
  );

  const touchSpy = vi.fn(
    async (
      args: Parameters<OnThisDayRefreshStore["markDayCheckedUnchanged"]>[0],
    ) => {
      const existing = states.get(args.monthDay);
      const nextState: OnThisDayRefreshState = {
        monthDay: args.monthDay,
        schemaVersion: args.schemaVersion,
        degraded: false,
        checkedAt: args.checkedAt,
        changedAt: existing?.changedAt ?? args.checkedAt,
        imagesCheckedAt: args.imagesCheckedAt,
        lastAttemptAt: args.lastAttemptAt,
        suspiciousStreak: 0,
      };
      states.set(args.monthDay, nextState);
      const storedDay = days.get(args.monthDay);
      if (storedDay) {
        days.set(args.monthDay, { ...storedDay, state: nextState });
      }
    },
  );

  const failureSpy = vi.fn(
    async (
      args: Parameters<OnThisDayRefreshStore["recordRefreshFailure"]>[0],
    ) => {
      const existing = states.get(args.monthDay);
      const nextStreak = args.suspicious
        ? (existing?.suspiciousStreak ?? 0) + 1
        : (existing?.suspiciousStreak ?? 0);
      const nextState: OnThisDayRefreshState = {
        monthDay: args.monthDay,
        schemaVersion: existing?.schemaVersion ?? 0,
        degraded: existing?.degraded ?? false,
        checkedAt: existing?.checkedAt ?? 0,
        changedAt: existing?.changedAt ?? 0,
        imagesCheckedAt: existing?.imagesCheckedAt ?? 0,
        lastAttemptAt: args.lastAttemptAt,
        lastError: args.lastError,
        suspiciousStreak: nextStreak,
      };
      states.set(args.monthDay, nextState);
      const storedDay = days.get(args.monthDay);
      if (storedDay) {
        days.set(args.monthDay, { ...storedDay, state: nextState });
      }
      return { suspiciousStreak: nextStreak };
    },
  );

  const store: OnThisDayRefreshStore = {
    getDaySnapshot: async (monthDay) => days.get(monthDay) ?? null,
    listRefreshStates: async () => [...states.values()],
    saveDaySnapshot: saveSpy,
    markDayCheckedUnchanged: touchSpy,
    recordRefreshFailure: failureSpy,
    claimRefreshLease: async () => true,
  };

  return { store, days, states, saveSpy, touchSpy, failureSpy };
};

describe("refreshCalendarDay", () => {
  it("saves changed snapshots, bumps only checkedAt when unchanged, and reuses image metadata until 90 days", async () => {
    const { store, states, saveSpy, touchSpy } = createMemoryStore();
    let payload = makeFeedPayload();
    const provider: OnThisDayProvider = {
      fetchAll: vi.fn(async () => payload),
    };
    const resolveImages = vi.fn(async () =>
      new Map([
        [
          "https://upload.wikimedia.org/wikipedia/commons/sample.jpg",
          {
            altText: "Verified alt text",
            attribution: {
              sourceTitle: "File:sample.jpg",
              sourceUrl: "https://commons.wikimedia.org/wiki/File:sample.jpg",
              creator: "Photographer",
              licenseName: "CC BY-SA 4.0",
            },
          },
        ],
      ]),
    );

    const t0 = Date.UTC(2026, 2, 5, 1, 0, 0);
    const first = await refreshCalendarDay(
      { month: 3, day: 5 },
      { store, provider, resolveImages, now: t0 },
    );
    expect(first.status).toBe("refreshed");
    expect(saveSpy).toHaveBeenCalledTimes(1);
    expect(resolveImages).toHaveBeenCalledTimes(1);

    // Same payload 2 days later -> unchanged, reuses image metadata, bumps checkedAt only.
    const t1 = t0 + 2 * 24 * 60 * 60 * 1000;
    const second = await refreshCalendarDay(
      { month: 3, day: 5 },
      { store, provider, resolveImages, now: t1 },
    );
    expect(second.status).toBe("unchanged");
    expect(saveSpy).toHaveBeenCalledTimes(1);
    expect(touchSpy).toHaveBeenCalledTimes(1);
    expect(resolveImages).toHaveBeenCalledTimes(1);
    expect(states.get("03-05")?.checkedAt).toBe(t1);
    expect(states.get("03-05")?.changedAt).toBe(t0);

    // After 90 days -> forces full image re-resolution even when payload text is unchanged.
    const t2 = t0 + IMAGE_RE_RESOLVE_MAX_AGE_MS + 1000;
    const third = await refreshCalendarDay(
      { month: 3, day: 5 },
      { store, provider, resolveImages, now: t2 },
    );
    expect(third.status).toBe("unchanged");
    expect(resolveImages).toHaveBeenCalledTimes(2);
    expect(states.get("03-05")?.imagesCheckedAt).toBe(t2);

    // Updated content -> saves replacement and updates changedAt.
    payload = makeFeedPayload({ prefix: "Updated" });
    const t3 = t2 + 1000;
    const fourth = await refreshCalendarDay(
      { month: 3, day: 5 },
      { store, provider, resolveImages, now: t3 },
    );
    expect(fourth.status).toBe("refreshed");
    expect(saveSpy).toHaveBeenCalledTimes(2);
    expect(states.get("03-05")?.changedAt).toBe(t3);
  });

  it("rejects suspicious shrinks without overwriting good snapshots, increments streak, and allows force override", async () => {
    const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => undefined);
    const errorSpy = vi
      .spyOn(console, "error")
      .mockImplementation(() => undefined);
    try {
      const { store, days } = createMemoryStore();
      const goodProvider: OnThisDayProvider = {
        fetchAll: vi.fn(async () => makeFeedPayload({ eventsCount: 20 })),
      };
      const t0 = Date.UTC(2026, 2, 5, 1, 0, 0);
      await refreshCalendarDay(
        { month: 3, day: 5 },
        { store, provider: goodProvider, resolveImages: async () => new Map(), now: t0 },
      );
      const originalHash = days.get("03-05")?.contentHash;

      // Shrink events from 20 -> 5 (>50% drop).
      const shrunkProvider: OnThisDayProvider = {
        fetchAll: vi.fn(async () => makeFeedPayload({ eventsCount: 5 })),
      };
      for (let attempt = 1; attempt <= 3; attempt += 1) {
        const result = await refreshCalendarDay(
          { month: 3, day: 5 },
          {
            store,
            provider: shrunkProvider,
            resolveImages: async () => new Map(),
            now: t0 + attempt * 1000,
          },
        );
        expect(result).toMatchObject({
          status: "suspicious",
          suspiciousStreak: attempt,
        });
      }
      expect(days.get("03-05")?.contentHash).toBe(originalHash);
      expect(warnSpy).toHaveBeenCalledTimes(2);
      expect(errorSpy).toHaveBeenCalledTimes(1);

      // Force bypasses the suspicion guard and resets the streak.
      const forced = await refreshCalendarDay(
        { month: 3, day: 5 },
        {
          store,
          provider: shrunkProvider,
          resolveImages: async () => new Map(),
          now: t0 + 10_000,
          force: true,
        },
      );
      expect(forced.status).toBe("refreshed");
      expect(days.get("03-05")?.state?.suspiciousStreak).toBe(0);
    } finally {
      warnSpy.mockRestore();
      errorSpy.mockRestore();
    }
  });

  it("never overwrites a good snapshot with a degraded fallback, and only creates degraded snapshots for UTC today", async () => {
    const { store, days } = createMemoryStore();
    const now = Date.UTC(2026, 10, 23, 12, 0, 0); // 11-23 UTC
    const failingProvider: OnThisDayProvider = {
      fetchAll: vi.fn(async () => {
        throw new Error("Upstream down");
      }),
    };
    const getFeaturedItems = vi.fn(async () => [
      { year: 1963, text: "Doctor Who premiered.", pages: [] },
    ]);

    // Non-today day with no snapshot -> fails cleanly (no degraded snapshot).
    const otherDay = await refreshCalendarDay(
      { month: 3, day: 5 },
      { store, provider: failingProvider, getFeaturedItems, now },
    );
    expect(otherDay.status).toBe("failed");
    expect(days.has("03-05")).toBe(false);

    // UTC today with no snapshot -> saves degraded snapshot.
    const todayDegraded = await refreshCalendarDay(
      { month: 11, day: 23 },
      { store, provider: failingProvider, getFeaturedItems, now },
    );
    expect(todayDegraded.status).toBe("degraded");
    expect(days.get("11-23")?.state?.degraded).toBe(true);

    // Once a real snapshot exists for UTC today, a subsequent failure preserves it.
    const workingProvider: OnThisDayProvider = {
      fetchAll: vi.fn(async () => makeFeedPayload()),
    };
    const recovered = await refreshCalendarDay(
      { month: 11, day: 23 },
      {
        store,
        provider: workingProvider,
        resolveImages: async () => new Map(),
        now: now + 1000,
      },
    );
    expect(recovered.status).toBe("refreshed");
    const goodHash = days.get("11-23")?.contentHash;

    const failedLater = await refreshCalendarDay(
      { month: 11, day: 23 },
      { store, provider: failingProvider, getFeaturedItems, now: now + 2000 },
    );
    expect(failedLater.status).toBe("failed");
    expect(days.get("11-23")?.contentHash).toBe(goodHash);
    expect(days.get("11-23")?.state?.degraded).toBe(false);
  });
});

describe("selectRefreshQueue and safety net", () => {
  it("orders missing, degraded, schema-behind, today ±1 (>20h), unenriched, then stale (>6d) oldest-first", () => {
    const now = Date.UTC(2026, 2, 5, 12, 0, 0); // 03-05 UTC
    const freshRow = (monthDay: string): OnThisDayRefreshState => ({
      monthDay,
      schemaVersion: CURRENT_ON_THIS_DAY_SCHEMA_VERSION,
      degraded: false,
      checkedAt: now - 2 * 60 * 60 * 1000,
      changedAt: now - 2 * 60 * 60 * 1000,
      imagesCheckedAt: now - 2 * 60 * 60 * 1000,
      suspiciousStreak: 0,
    });

    const rows = ALL_CALENDAR_DAYS.map((day) => freshRow(calendarDayKey(day)));
    const byKey = new Map(rows.map((row) => [row.monthDay, row]));

    // Remove 05-01 (missing)
    byKey.delete("05-01");
    // Mark 06-10 degraded
    byKey.get("06-10")!.degraded = true;
    // Mark 07-15 schema behind
    byKey.get("07-15")!.schemaVersion = 1;
    // Mark today (03-05) older than 20h, tomorrow (03-06) fresh, yesterday (03-04) older than 20h
    byKey.get("03-05")!.checkedAt = now - TODAY_WINDOW_MAX_AGE_MS - 1000;
    byKey.get("03-04")!.checkedAt = now - TODAY_WINDOW_MAX_AGE_MS - 1000;
    // Mark 08-20 cold-built (imagesCheckedAt = 0)
    byKey.get("08-20")!.imagesCheckedAt = 0;
    // Mark 09-01 and 10-01 stale (>6d), with 10-01 older than 09-01
    byKey.get("09-01")!.checkedAt = now - FRESHNESS_TARGET_MS - 10_000;
    byKey.get("10-01")!.checkedAt = now - FRESHNESS_TARGET_MS - 100_000;

    const { queue } = selectRefreshQueue([...byKey.values()], now);
    expect(queue.map(calendarDayKey)).toEqual([
      "05-01",
      "06-10",
      "07-15",
      "03-05",
      "03-04",
      "08-20",
      "10-01",
      "09-01",
    ]);
  });

  it("triggers safety-net refresh only when degraded, schema-behind, or >14d old and past cooldown", () => {
    const now = Date.UTC(2026, 2, 5, 12, 0, 0);
    const fresh: OnThisDayRefreshState = {
      monthDay: "03-05",
      schemaVersion: CURRENT_ON_THIS_DAY_SCHEMA_VERSION,
      degraded: false,
      checkedAt: now - 3 * 24 * 60 * 60 * 1000,
      changedAt: now - 3 * 24 * 60 * 60 * 1000,
      imagesCheckedAt: now - 3 * 24 * 60 * 60 * 1000,
      suspiciousStreak: 0,
    };

    expect(shouldTriggerSafetyNetRefresh(fresh, now)).toBe(false);
    expect(
      shouldTriggerSafetyNetRefresh(
        { ...fresh, degraded: true, lastAttemptAt: now - 5 * 60 * 1000 },
        now,
      ),
    ).toBe(false);
    expect(
      shouldTriggerSafetyNetRefresh(
        {
          ...fresh,
          degraded: true,
          lastAttemptAt: now - DEGRADED_RETRY_COOLDOWN_MS - 1000,
        },
        now,
      ),
    ).toBe(true);
    expect(
      shouldTriggerSafetyNetRefresh({ ...fresh, schemaVersion: 1 }, now),
    ).toBe(true);
    expect(
      shouldTriggerSafetyNetRefresh(
        { ...fresh, checkedAt: now - SAFETY_NET_MAX_AGE_MS - 1000 },
        now,
      ),
    ).toBe(true);
  });

  it("stops the rolling worker early after two consecutive HTTP 429 rate limits", async () => {
    const { store } = createMemoryStore();
    const sleep = vi.fn(async () => undefined);
    const provider: OnThisDayProvider = {
      fetchAll: vi.fn(async () => {
        throw new OnThisDayUpstreamError("rate limited", {
          status: 429,
          retryAfterSeconds: 12,
        });
      }),
    };

    const summary = await runRollingRefreshWorker({
      store,
      provider,
      budgetSeconds: 240,
      interDayPauseMs: 0,
      sleep,
    });

    expect(summary.failed).toBe(2);
    expect(summary.stoppedEarlyReason).toBe("rate-limit");
    expect(sleep).toHaveBeenCalledWith(12_000);
    expect(summary.remainingStale).toBe(366);
  });

  it("produces stable hashes that ignore checkedAt timestamps", () => {
    const base: OnThisDaySnapshot = {
      schemaVersion: CURRENT_ON_THIS_DAY_SCHEMA_VERSION,
      provider: "wikipedia-rest-v1",
      monthDay: "03-05",
      checkedAt: 1000,
      sourceUrl: "https://en.wikipedia.org/wiki/March_5",
      categories: {
        selected: [],
        events: [],
        births: [],
        deaths: [],
        holidays: [],
      },
      counts: { selected: 0, events: 0, births: 0, deaths: 0, holidays: 0 },
      availableCategories: {
        selected: true,
        events: true,
        births: true,
        deaths: true,
        holidays: true,
      },
    };
    expect(hashOnThisDaySnapshot(base)).toBe(
      hashOnThisDaySnapshot({ ...base, checkedAt: 999_999 }),
    );
  });
});
