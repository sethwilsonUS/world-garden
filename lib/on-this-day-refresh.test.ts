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

const createMemoryStore = () => {
  const days = new Map<string, StoredOnThisDayDay>();
  const states = new Map<string, OnThisDayRefreshState>();
  const leaseTokens = new Map<string, string>();

  const claimSpy = vi.fn(
    async (
      args: Parameters<OnThisDayRefreshStore["claimRefreshLease"]>[0],
    ) => {
      const existing = states.get(args.monthDay);
      if (
        existing?.refreshLeaseUntil != null &&
        existing.refreshLeaseUntil > args.now
      ) {
        return false;
      }
      if (
        args.minRetryIntervalMs != null &&
        existing?.lastAttemptAt != null &&
        args.now - existing.lastAttemptAt < args.minRetryIntervalMs
      ) {
        return false;
      }
      const nextState: OnThisDayRefreshState = existing
        ? { ...existing, refreshLeaseUntil: args.now + args.ttlMs }
        : {
            monthDay: args.monthDay,
            schemaVersion: 0,
            degraded: false,
            checkedAt: 0,
            changedAt: 0,
            imagesCheckedAt: 0,
            suspiciousStreak: 0,
            refreshLeaseUntil: args.now + args.ttlMs,
          };
      states.set(args.monthDay, nextState);
      leaseTokens.set(args.monthDay, args.leaseToken);
      return true;
    },
  );

  const saveSpy = vi.fn(
    async (args: Parameters<OnThisDayRefreshStore["saveDaySnapshot"]>[0]) => {
      if (leaseTokens.get(args.monthDay) !== args.leaseToken) {
        return { applied: false, superseded: true };
      }
      leaseTokens.delete(args.monthDay);
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
      return { applied: true, superseded: false };
    },
  );

  const touchSpy = vi.fn(
    async (
      args: Parameters<OnThisDayRefreshStore["markDayCheckedUnchanged"]>[0],
    ) => {
      if (leaseTokens.get(args.monthDay) !== args.leaseToken) {
        return { applied: false, superseded: true };
      }
      leaseTokens.delete(args.monthDay);
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
      return { applied: true, superseded: false };
    },
  );

  const failureSpy = vi.fn(
    async (
      args: Parameters<OnThisDayRefreshStore["recordRefreshFailure"]>[0],
    ) => {
      const existing = states.get(args.monthDay);
      if (leaseTokens.get(args.monthDay) !== args.leaseToken) {
        return {
          applied: false,
          superseded: true,
          suspiciousStreak: existing?.suspiciousStreak ?? 0,
        };
      }
      leaseTokens.delete(args.monthDay);
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
      return { applied: true, superseded: false, suspiciousStreak: nextStreak };
    },
  );

  const store: OnThisDayRefreshStore = {
    getDaySnapshot: async (monthDay) => days.get(monthDay) ?? null,
    listRefreshStates: async () => [...states.values()],
    saveDaySnapshot: saveSpy,
    markDayCheckedUnchanged: touchSpy,
    recordRefreshFailure: failureSpy,
    claimRefreshLease: claimSpy,
  };

  return { store, days, states, leaseTokens, claimSpy, saveSpy, touchSpy, failureSpy };
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

    // Failed 90-day re-resolution preserves prior image metadata and does NOT advance imagesCheckedAt.
    const warnSpy = vi
      .spyOn(console, "warn")
      .mockImplementation(() => undefined);
    const t2 = t0 + IMAGE_RE_RESOLVE_MAX_AGE_MS + 1000;
    try {
      const failedRecheck = await refreshCalendarDay(
        { month: 3, day: 5 },
        {
          store,
          provider,
          resolveImages: vi.fn(async () => {
            throw new Error("Commons unavailable");
          }),
          now: t2,
        },
      );
      expect(failedRecheck.status).toBe("unchanged");
      expect(states.get("03-05")?.imagesCheckedAt).toBe(t0);
    } finally {
      warnSpy.mockRestore();
    }

    // Successful 90-day re-resolution advances imagesCheckedAt.
    const t3 = t2 + 1000;
    const third = await refreshCalendarDay(
      { month: 3, day: 5 },
      { store, provider, resolveImages, now: t3 },
    );
    expect(third.status).toBe("unchanged");
    expect(resolveImages).toHaveBeenCalledTimes(2);
    expect(states.get("03-05")?.imagesCheckedAt).toBe(t3);

    // Updated content -> saves replacement and updates changedAt.
    payload = makeFeedPayload({ prefix: "Updated" });
    const t4 = t3 + 1000;
    const fourth = await refreshCalendarDay(
      { month: 3, day: 5 },
      { store, provider, resolveImages, now: t4 },
    );
    expect(fourth.status).toBe("refreshed");
    expect(saveSpy).toHaveBeenCalledTimes(2);
    expect(states.get("03-05")?.changedAt).toBe(t4);
  });

  it("keeps failed new-image enrichment pending and retries only the failed URL next pass while reusing verified URLs", async () => {
    const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => undefined);
    try {
      const { store, states, days } = createMemoryStore();
      const firstImage =
        "https://upload.wikimedia.org/wikipedia/commons/first.jpg";
      const secondImage =
        "https://upload.wikimedia.org/wikipedia/commons/second.jpg";

      let payload: OnThisDayFeedPayload = makeFeedPayload({
        imageSource: firstImage,
      });
      const provider: OnThisDayProvider = {
        fetchAll: vi.fn(async () => payload),
      };
      const resolveImages = vi.fn(async (requests: Array<{ imageUrl: string }>) =>
        new Map(
          requests.map(({ imageUrl }) => [
            imageUrl,
            {
              altText: `Verified alt for ${imageUrl}`,
              attribution: {
                sourceTitle: "File:verified.jpg",
                sourceUrl: "https://commons.wikimedia.org/wiki/File:verified.jpg",
                creator: "Verified Author",
                licenseName: "CC BY-SA 4.0",
              },
            },
          ]),
        ),
      );

      const t0 = Date.UTC(2026, 2, 5, 1, 0, 0);
      await refreshCalendarDay(
        { month: 3, day: 5 },
        { store, provider, resolveImages, now: t0 },
      );
      expect(states.get("03-05")?.imagesCheckedAt).toBe(t0);
      expect(resolveImages).toHaveBeenCalledTimes(1);

      // Six days later, a second image is introduced and Commons fails for it.
      payload = {
        ...makeFeedPayload({ imageSource: firstImage }),
        events: [
          {
            year: 2020,
            text: "New event with a second image",
            pages: [
              {
                titles: { normalized: "Second image page" },
                pageid: 999,
                thumbnail: { source: secondImage, width: 320, height: 240 },
              },
            ],
          },
          ...(payload.events ?? []),
        ],
      };
      const t1 = t0 + 6 * 24 * 60 * 60 * 1000;
      const failingResolve = vi.fn(async () => {
        throw new Error("Commons timed out");
      });

      const partial = await refreshCalendarDay(
        { month: 3, day: 5 },
        { store, provider, resolveImages: failingResolve, now: t1 },
      );
      expect(partial.status).toBe("refreshed");
      // Only the new image was attempted; first image stayed verified; enrichment stays pending (imagesCheckedAt = 0).
      expect(failingResolve).toHaveBeenCalledWith([
        expect.objectContaining({ imageUrl: secondImage }),
      ]);
      expect(states.get("03-05")?.imagesCheckedAt).toBe(0);
      expect(
        days.get("03-05")?.data.categories.events[0]?.image?.attributionIsFallback,
      ).toBe(true);
      expect(
        days.get("03-05")?.data.categories.selected[0]?.image?.attributionIsFallback,
      ).toBeUndefined();

      // Next refresh retries ONLY the fallback URL (reusing the verified first image!) and clears pending enrichment.
      resolveImages.mockClear();
      const t2 = t1 + 60_000;
      const retried = await refreshCalendarDay(
        { month: 3, day: 5 },
        { store, provider, resolveImages, now: t2 },
      );
      expect(retried.status).toBe("refreshed");
      expect(resolveImages).toHaveBeenCalledWith([
        expect.objectContaining({ imageUrl: secondImage }),
      ]);
      expect(states.get("03-05")?.imagesCheckedAt).toBe(t2);
      expect(
        days.get("03-05")?.data.categories.events[0]?.image?.attributionIsFallback,
      ).toBeUndefined();
      expect(
        days.get("03-05")?.data.categories.events[0]?.image?.altText,
      ).toBe(`Verified alt for ${secondImage}`);
    } finally {
      warnSpy.mockRestore();
    }
  });

  it("skips when another worker already holds the lease and detects superseded completions", async () => {
    const { store, states, leaseTokens } = createMemoryStore();
    const now = Date.UTC(2026, 2, 5, 12, 0, 0);
    states.set("03-05", {
      monthDay: "03-05",
      schemaVersion: 2,
      degraded: false,
      checkedAt: now - 1000,
      changedAt: now - 1000,
      imagesCheckedAt: now - 1000,
      suspiciousStreak: 0,
      refreshLeaseUntil: now + 60_000,
    });
    leaseTokens.set("03-05", "other-worker");

    const provider: OnThisDayProvider = {
      fetchAll: vi.fn(async () => makeFeedPayload()),
    };
    const held = await refreshCalendarDay(
      { month: 3, day: 5 },
      { store, provider, now, force: true },
    );
    expect(held).toEqual({
      status: "skipped",
      monthDay: "03-05",
      reason: "lease-held",
    });
    expect(provider.fetchAll).not.toHaveBeenCalled();

    // Simulate lease superseding mid-fetch.
    states.get("03-05")!.refreshLeaseUntil = now - 1;
    const supersededProvider: OnThisDayProvider = {
      fetchAll: vi.fn(async () => {
        leaseTokens.set("03-05", "newer-owner");
        return makeFeedPayload({ prefix: "Late" });
      }),
    };
    const superseded = await refreshCalendarDay(
      { month: 3, day: 5 },
      {
        store,
        provider: supersededProvider,
        resolveImages: async () => new Map(),
        now,
      },
    );
    expect(superseded).toEqual({
      status: "skipped",
      monthDay: "03-05",
      reason: "lease-superseded",
    });
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
        {
          store,
          provider: goodProvider,
          resolveImages: async () => new Map(),
          now: t0,
        },
      );
      const originalHash = days.get("03-05")?.contentHash;

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

  it("never overwrites a good snapshot with a degraded fallback, and preserves rate-limit metadata on degraded fallback", async () => {
    const { store, days } = createMemoryStore();
    const now = Date.UTC(2026, 10, 23, 12, 0, 0);
    const rateLimitedProvider: OnThisDayProvider = {
      fetchAll: vi.fn(async () => {
        throw new OnThisDayUpstreamError("rate limited", {
          status: 429,
          retryAfterSeconds: 30,
        });
      }),
    };
    const getFeaturedItems = vi.fn(async () => [
      { year: 1963, text: "Doctor Who premiered.", pages: [] },
    ]);

    const otherDay = await refreshCalendarDay(
      { month: 3, day: 5 },
      { store, provider: rateLimitedProvider, getFeaturedItems, now },
    );
    expect(otherDay.status).toBe("failed");
    expect(days.has("03-05")).toBe(false);

    const todayDegraded = await refreshCalendarDay(
      { month: 11, day: 23 },
      { store, provider: rateLimitedProvider, getFeaturedItems, now },
    );
    expect(todayDegraded).toMatchObject({
      status: "degraded",
      isRateLimited: true,
      retryAfterSeconds: 30,
    });
    expect(days.get("11-23")?.state?.degraded).toBe(true);

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
      {
        store,
        provider: rateLimitedProvider,
        getFeaturedItems,
        now: now + 2000,
      },
    );
    expect(failedLater.status).toBe("failed");
    expect(days.get("11-23")?.contentHash).toBe(goodHash);
    expect(days.get("11-23")?.state?.degraded).toBe(false);
  });
});

describe("selectRefreshQueue and rolling worker", () => {
  it("orders missing, degraded, schema-behind, today ±1 (>20h), unenriched, then stale (>6d) oldest-first", () => {
    const now = Date.UTC(2026, 2, 5, 12, 0, 0);
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

    byKey.delete("05-01");
    byKey.get("06-10")!.degraded = true;
    byKey.get("07-15")!.schemaVersion = 1;
    byKey.get("03-05")!.checkedAt = now - TODAY_WINDOW_MAX_AGE_MS - 1000;
    byKey.get("03-04")!.checkedAt = now - TODAY_WINDOW_MAX_AGE_MS - 1000;
    byKey.get("08-20")!.imagesCheckedAt = 0;
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

  it("applies 429 backoff even after UTC-today degraded fallback and propagates retryAfterSeconds", async () => {
    const { store } = createMemoryStore();
    const sleep = vi.fn(async () => undefined);
    const onDayRefreshed = vi.fn();
    const now = Date.UTC(2026, 10, 23, 12, 0, 0);
    const provider: OnThisDayProvider = {
      fetchAll: vi.fn(async () => {
        throw new OnThisDayUpstreamError("rate limited", {
          status: 429,
          retryAfterSeconds: 12,
        });
      }),
    };
    const getFeaturedItems = vi.fn(async () => [
      { year: 1963, text: "Doctor Who premiered.", pages: [] },
    ]);

    const summary = await runRollingRefreshWorker({
      store,
      provider,
      getFeaturedItems,
      budgetSeconds: 240,
      interDayPauseMs: 0,
      nowFn: () => now,
      sleep,
      onDayRefreshed,
    });

    // First day (UTC today 11-23) becomes degraded with 429 -> sleeps 12s -> second day fails with 429 -> stops early.
    expect(summary.degraded).toBe(1);
    expect(summary.failed).toBe(1);
    expect(summary.stoppedEarlyReason).toBe("rate-limit");
    expect(summary.retryAfterSeconds).toBe(12);
    expect(sleep).toHaveBeenCalledWith(12_000);
    expect(onDayRefreshed).toHaveBeenCalledWith({ month: 11, day: 23 });
  });

  it("propagates long Retry-After when it exceeds the remaining budget", async () => {
    const { store } = createMemoryStore();
    const sleep = vi.fn(async () => undefined);
    const provider: OnThisDayProvider = {
      fetchAll: vi.fn(async () => {
        throw new OnThisDayUpstreamError("rate limited", {
          status: 429,
          retryAfterSeconds: 600,
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

    expect(summary.stoppedEarlyReason).toBe("rate-limit");
    expect(summary.retryAfterSeconds).toBe(600);
    expect(sleep).not.toHaveBeenCalled();
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
