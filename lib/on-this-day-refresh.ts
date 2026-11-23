import {
  ALL_CALENDAR_DAYS,
  calendarDayFromUtcDate,
  calendarDayIndex,
  calendarDayKey,
  formatUtcDateIso,
  isSameCalendarDay,
  nextCalendarDay,
  previousCalendarDay,
  type CalendarDay,
} from "@/lib/calendar-day";
import type { WikipediaOnThisDayItem } from "@/lib/featured-article";
import {
  buildFeaturedOnThisDayFallback,
  buildOnThisDaySnapshot,
  hashOnThisDaySnapshot,
  OnThisDayUpstreamError,
  type OnThisDayImageResolver,
  type OnThisDayProvider,
} from "@/lib/on-this-day";
import {
  CURRENT_ON_THIS_DAY_SCHEMA_VERSION,
  ON_THIS_DAY_CATEGORIES,
  type OnThisDayRefreshState,
  type OnThisDaySnapshot,
} from "@/lib/on-this-day-contracts";

export const FRESHNESS_TARGET_MS = 6 * 24 * 60 * 60 * 1000;
export const SAFETY_NET_MAX_AGE_MS = 14 * 24 * 60 * 60 * 1000;
export const TODAY_WINDOW_MAX_AGE_MS = 20 * 60 * 60 * 1000;
export const DEGRADED_RETRY_COOLDOWN_MS = 60 * 60 * 1000;
export const IMAGE_RE_RESOLVE_MAX_AGE_MS = 90 * 24 * 60 * 60 * 1000;
export const REFRESH_LEASE_TTL_MS = 2 * 60 * 1000;
export const SUSPICIOUS_MIN_PREVIOUS_COUNT = 4;
export const SUSPICIOUS_SHRINK_RATIO = 0.5;
export const DEFAULT_WORKER_BUDGET_SECONDS = 240;
export const DEFAULT_WORKER_INTER_DAY_PAUSE_MS = 500;
export const MAX_CONSECUTIVE_RATE_LIMITS = 2;

export type StoredOnThisDayDay = {
  monthDay: string;
  schemaVersion: number;
  contentHash: string;
  data: OnThisDaySnapshot;
  state: OnThisDayRefreshState | null;
};

export type OnThisDayRefreshStore = {
  getDaySnapshot(monthDay: string): Promise<StoredOnThisDayDay | null>;
  listRefreshStates(): Promise<OnThisDayRefreshState[]>;
  saveDaySnapshot(args: {
    monthDay: string;
    schemaVersion: number;
    data: OnThisDaySnapshot;
    contentHash: string;
    degraded: boolean;
    checkedAt: number;
    changedAt: number;
    imagesCheckedAt: number;
    lastAttemptAt: number;
  }): Promise<void>;
  markDayCheckedUnchanged(args: {
    monthDay: string;
    schemaVersion: number;
    checkedAt: number;
    imagesCheckedAt: number;
    lastAttemptAt: number;
  }): Promise<void>;
  recordRefreshFailure(args: {
    monthDay: string;
    lastAttemptAt: number;
    lastError: string;
    suspicious: boolean;
  }): Promise<{ suspiciousStreak: number }>;
  claimRefreshLease(args: {
    monthDay: string;
    now: number;
    ttlMs: number;
  }): Promise<boolean>;
};

export type RefreshCalendarDayResult =
  | { status: "refreshed"; monthDay: string; snapshot: OnThisDaySnapshot }
  | { status: "unchanged"; monthDay: string; snapshot: OnThisDaySnapshot }
  | { status: "degraded"; monthDay: string; snapshot: OnThisDaySnapshot }
  | {
      status: "suspicious";
      monthDay: string;
      reason: string;
      suspiciousStreak: number;
    }
  | {
      status: "failed";
      monthDay: string;
      error: string;
      isRateLimited: boolean;
      retryAfterSeconds?: number;
    };

export const detectSuspiciousRefresh = (
  previous: OnThisDaySnapshot | null,
  next: OnThisDaySnapshot,
): string | null => {
  for (const category of ON_THIS_DAY_CATEGORIES) {
    if (!Array.isArray(next.categories[category])) {
      return `Missing ${category} category in Wikipedia response.`;
    }
  }

  if (!previous || previous.provider === "featured-fallback") {
    return null;
  }

  for (const category of ON_THIS_DAY_CATEGORIES) {
    const previousCount = previous.counts[category];
    const nextCount = next.counts[category];
    if (
      previousCount >= SUSPICIOUS_MIN_PREVIOUS_COUNT &&
      nextCount < previousCount * SUSPICIOUS_SHRINK_RATIO
    ) {
      return `Suspicious shrink in ${category}: ${previousCount} -> ${nextCount} (>50% drop).`;
    }
  }

  return null;
};

export const shouldTriggerSafetyNetRefresh = (
  state: OnThisDayRefreshState | null,
  now = Date.now(),
): boolean => {
  if (!state) return true;
  if (
    state.lastAttemptAt != null &&
    now - state.lastAttemptAt < DEGRADED_RETRY_COOLDOWN_MS
  ) {
    return false;
  }
  if (state.degraded) return true;
  if (state.schemaVersion < CURRENT_ON_THIS_DAY_SCHEMA_VERSION) return true;
  if (state.checkedAt <= 0 || now - state.checkedAt > SAFETY_NET_MAX_AGE_MS) {
    return true;
  }
  return false;
};

export type RefreshQueueSelection = {
  queue: CalendarDay[];
  oldestCheckedAt: number | null;
};

export const selectRefreshQueue = (
  stateRows: readonly OnThisDayRefreshState[],
  now = Date.now(),
): RefreshQueueSelection => {
  const byKey = new Map<string, OnThisDayRefreshState>(
    stateRows.map((row) => [row.monthDay, row]),
  );

  let oldestCheckedAt: number | null = null;
  for (const row of stateRows) {
    if (row.checkedAt > 0) {
      oldestCheckedAt =
        oldestCheckedAt === null
          ? row.checkedAt
          : Math.min(oldestCheckedAt, row.checkedAt);
    }
  }

  const utcToday = calendarDayFromUtcDate(new Date(now));
  const todayStartIndex = calendarDayIndex(utcToday);
  const daysStartingToday = [
    ...ALL_CALENDAR_DAYS.slice(todayStartIndex),
    ...ALL_CALENDAR_DAYS.slice(0, todayStartIndex),
  ];

  const seen = new Set<string>();
  const queue: CalendarDay[] = [];
  const enqueue = (day: CalendarDay) => {
    const key = calendarDayKey(day);
    if (seen.has(key)) return;
    seen.add(key);
    queue.push(day);
  };

  // 1. Missing days (no state row or never successfully checked).
  for (const day of daysStartingToday) {
    const state = byKey.get(calendarDayKey(day));
    if (!state || state.checkedAt <= 0) {
      enqueue(day);
    }
  }

  // 2. Degraded snapshots (oldest attempt first).
  const degradedDays = ALL_CALENDAR_DAYS.filter((day) => {
    const state = byKey.get(calendarDayKey(day));
    return Boolean(state?.degraded);
  }).sort((left, right) => {
    const leftState = byKey.get(calendarDayKey(left));
    const rightState = byKey.get(calendarDayKey(right));
    return (
      (leftState?.lastAttemptAt ?? leftState?.checkedAt ?? 0) -
      (rightState?.lastAttemptAt ?? rightState?.checkedAt ?? 0)
    );
  });
  for (const day of degradedDays) enqueue(day);

  // 3. Schema version behind current.
  const schemaBehindDays = ALL_CALENDAR_DAYS.filter((day) => {
    const state = byKey.get(calendarDayKey(day));
    return (
      state != null &&
      state.checkedAt > 0 &&
      state.schemaVersion < CURRENT_ON_THIS_DAY_SCHEMA_VERSION
    );
  }).sort((left, right) => {
    const leftChecked = byKey.get(calendarDayKey(left))?.checkedAt ?? 0;
    const rightChecked = byKey.get(calendarDayKey(right))?.checkedAt ?? 0;
    return leftChecked - rightChecked;
  });
  for (const day of schemaBehindDays) enqueue(day);

  // 4. UTC today ±1 if older than 20 hours.
  const todayWindow = [
    utcToday,
    nextCalendarDay(utcToday),
    previousCalendarDay(utcToday),
  ];
  for (const day of todayWindow) {
    const state = byKey.get(calendarDayKey(day));
    if (!state || now - state.checkedAt > TODAY_WINDOW_MAX_AGE_MS) {
      enqueue(day);
    }
  }

  // 5. Cold-built days waiting for image metadata enrichment.
  const unenrichedDays = ALL_CALENDAR_DAYS.filter((day) => {
    const state = byKey.get(calendarDayKey(day));
    return (
      state != null &&
      state.checkedAt > 0 &&
      !state.degraded &&
      state.imagesCheckedAt <= 0
    );
  }).sort((left, right) => {
    const leftChecked = byKey.get(calendarDayKey(left))?.checkedAt ?? 0;
    const rightChecked = byKey.get(calendarDayKey(right))?.checkedAt ?? 0;
    return leftChecked - rightChecked;
  });
  for (const day of unenrichedDays) enqueue(day);

  // 6. Any remaining day older than 6 days, oldest first.
  const staleDays = ALL_CALENDAR_DAYS.filter((day) => {
    const state = byKey.get(calendarDayKey(day));
    return (
      state != null &&
      state.checkedAt > 0 &&
      now - state.checkedAt > FRESHNESS_TARGET_MS
    );
  }).sort((left, right) => {
    const leftChecked = byKey.get(calendarDayKey(left))?.checkedAt ?? 0;
    const rightChecked = byKey.get(calendarDayKey(right))?.checkedAt ?? 0;
    return leftChecked - rightChecked;
  });
  for (const day of staleDays) enqueue(day);

  return { queue, oldestCheckedAt };
};

export const refreshCalendarDay = async (
  day: CalendarDay,
  {
    store,
    provider,
    resolveImages,
    getFeaturedItems,
    now = Date.now(),
    force = false,
  }: {
    store: OnThisDayRefreshStore;
    provider?: OnThisDayProvider;
    resolveImages?: OnThisDayImageResolver;
    getFeaturedItems?: (
      feedDateIso: string,
    ) => Promise<WikipediaOnThisDayItem[] | null>;
    now?: number;
    force?: boolean;
  },
): Promise<RefreshCalendarDayResult> => {
  const monthDay = calendarDayKey(day);
  const existing = await store.getDaySnapshot(monthDay);
  const previousSnapshot = existing?.data ?? null;
  const previousState = existing?.state ?? null;

  const shouldReResolveImages =
    force ||
    !previousState ||
    previousState.imagesCheckedAt <= 0 ||
    now - previousState.imagesCheckedAt > IMAGE_RE_RESOLVE_MAX_AGE_MS;

  try {
    const nextSnapshot = await buildOnThisDaySnapshot({
      day,
      provider,
      resolveImages,
      previousSnapshot,
      reResolveImages: shouldReResolveImages,
      checkedAt: now,
    });

    if (!force) {
      const suspiciousReason = detectSuspiciousRefresh(
        previousSnapshot,
        nextSnapshot,
      );
      if (suspiciousReason) {
        const { suspiciousStreak } = await store.recordRefreshFailure({
          monthDay,
          lastAttemptAt: now,
          lastError: suspiciousReason,
          suspicious: true,
        });
        if (suspiciousStreak >= 3) {
          console.error(
            `[on-this-day] Manual review needed for ${monthDay} (suspicious streak ${suspiciousStreak}): ${suspiciousReason}`,
          );
        } else {
          console.warn(
            `[on-this-day] Rejected suspicious refresh for ${monthDay} (streak ${suspiciousStreak}): ${suspiciousReason}`,
          );
        }
        return {
          status: "suspicious",
          monthDay,
          reason: suspiciousReason,
          suspiciousStreak,
        };
      }
    }

    const nextHash = hashOnThisDaySnapshot(nextSnapshot);
    const nextImagesCheckedAt = shouldReResolveImages
      ? now
      : (previousState?.imagesCheckedAt ?? now);

    const isUnchanged =
      existing !== null &&
      existing.contentHash === nextHash &&
      existing.schemaVersion === CURRENT_ON_THIS_DAY_SCHEMA_VERSION &&
      previousState !== null &&
      !previousState.degraded &&
      previousState.schemaVersion === CURRENT_ON_THIS_DAY_SCHEMA_VERSION;

    if (isUnchanged) {
      await store.markDayCheckedUnchanged({
        monthDay,
        schemaVersion: CURRENT_ON_THIS_DAY_SCHEMA_VERSION,
        checkedAt: now,
        imagesCheckedAt: nextImagesCheckedAt,
        lastAttemptAt: now,
      });
      return {
        status: "unchanged",
        monthDay,
        snapshot: { ...existing.data, checkedAt: now },
      };
    }

    await store.saveDaySnapshot({
      monthDay,
      schemaVersion: CURRENT_ON_THIS_DAY_SCHEMA_VERSION,
      data: nextSnapshot,
      contentHash: nextHash,
      degraded: false,
      checkedAt: now,
      changedAt: now,
      imagesCheckedAt: nextImagesCheckedAt,
      lastAttemptAt: now,
    });

    return {
      status: "refreshed",
      monthDay,
      snapshot: nextSnapshot,
    };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    const isRateLimited =
      error instanceof OnThisDayUpstreamError && error.status === 429;
    const retryAfterSeconds =
      error instanceof OnThisDayUpstreamError
        ? error.retryAfterSeconds
        : undefined;

    const utcNow = new Date(now);
    const isUtcToday = isSameCalendarDay(day, calendarDayFromUtcDate(utcNow));

    if (!previousSnapshot && isUtcToday && getFeaturedItems) {
      const items = await getFeaturedItems(formatUtcDateIso(utcNow)).catch(
        () => null,
      );
      if (items && items.length > 0) {
        const degradedSnapshot = buildFeaturedOnThisDayFallback({
          day,
          items,
          checkedAt: now,
        });
        await store.saveDaySnapshot({
          monthDay,
          schemaVersion: CURRENT_ON_THIS_DAY_SCHEMA_VERSION,
          data: degradedSnapshot,
          contentHash: hashOnThisDaySnapshot(degradedSnapshot),
          degraded: true,
          checkedAt: now,
          changedAt: now,
          imagesCheckedAt: 0,
          lastAttemptAt: now,
        });
        return {
          status: "degraded",
          monthDay,
          snapshot: degradedSnapshot,
        };
      }
    }

    await store.recordRefreshFailure({
      monthDay,
      lastAttemptAt: now,
      lastError: message,
      suspicious: false,
    });

    return {
      status: "failed",
      monthDay,
      error: message,
      isRateLimited,
      retryAfterSeconds,
    };
  }
};

export type RollingRefreshSummary = {
  refreshed: number;
  unchanged: number;
  degraded: number;
  suspicious: number;
  failed: number;
  refreshedDays: CalendarDay[];
  remainingStale: number;
  oldestCheckedAt: number | null;
  stoppedEarlyReason?: "budget" | "rate-limit";
};

const defaultSleep = async (ms: number): Promise<void> => {
  if (ms <= 0) return;
  await new Promise((resolve) => setTimeout(resolve, ms));
};

export const runRollingRefreshWorker = async ({
  store,
  provider,
  resolveImages,
  getFeaturedItems,
  budgetSeconds = DEFAULT_WORKER_BUDGET_SECONDS,
  interDayPauseMs = DEFAULT_WORKER_INTER_DAY_PAUSE_MS,
  nowFn = () => Date.now(),
  sleep = defaultSleep,
}: {
  store: OnThisDayRefreshStore;
  provider?: OnThisDayProvider;
  resolveImages?: OnThisDayImageResolver;
  getFeaturedItems?: (
    feedDateIso: string,
  ) => Promise<WikipediaOnThisDayItem[] | null>;
  budgetSeconds?: number;
  interDayPauseMs?: number;
  nowFn?: () => number;
  sleep?: (ms: number) => Promise<void>;
}): Promise<RollingRefreshSummary> => {
  const startMs = nowFn();
  const deadlineMs = startMs + budgetSeconds * 1000;
  const initialStates = await store.listRefreshStates();
  const { queue } = selectRefreshQueue(initialStates, startMs);

  let refreshed = 0;
  let unchanged = 0;
  let degraded = 0;
  let suspicious = 0;
  let failed = 0;
  let consecutiveRateLimits = 0;
  let stoppedEarlyReason: RollingRefreshSummary["stoppedEarlyReason"];
  const refreshedDays: CalendarDay[] = [];

  for (let index = 0; index < queue.length; index += 1) {
    const currentNow = nowFn();
    if (index > 0 && currentNow >= deadlineMs) {
      stoppedEarlyReason = "budget";
      break;
    }

    const day = queue[index];
    const result = await refreshCalendarDay(day, {
      store,
      provider,
      resolveImages,
      getFeaturedItems,
      now: currentNow,
    });

    if (result.status === "refreshed") {
      refreshed += 1;
      consecutiveRateLimits = 0;
      refreshedDays.push(day);
    } else if (result.status === "unchanged") {
      unchanged += 1;
      consecutiveRateLimits = 0;
    } else if (result.status === "degraded") {
      degraded += 1;
      consecutiveRateLimits = 0;
      refreshedDays.push(day);
    } else if (result.status === "suspicious") {
      suspicious += 1;
      consecutiveRateLimits = 0;
    } else {
      failed += 1;
      if (result.isRateLimited) {
        consecutiveRateLimits += 1;
        if (consecutiveRateLimits >= MAX_CONSECUTIVE_RATE_LIMITS) {
          stoppedEarlyReason = "rate-limit";
          break;
        }
        const retryWaitMs = Math.max(
          interDayPauseMs,
          (result.retryAfterSeconds ?? 5) * 1000,
        );
        if (nowFn() + retryWaitMs >= deadlineMs) {
          stoppedEarlyReason = "rate-limit";
          break;
        }
        await sleep(retryWaitMs);
        continue;
      }
      consecutiveRateLimits = 0;
    }

    if (index < queue.length - 1 && interDayPauseMs > 0) {
      if (nowFn() + interDayPauseMs >= deadlineMs) {
        stoppedEarlyReason = "budget";
        break;
      }
      await sleep(interDayPauseMs);
    }
  }

  const endNow = nowFn();
  const updatedStates = await store.listRefreshStates();
  const postSelection = selectRefreshQueue(updatedStates, endNow);

  if (
    postSelection.oldestCheckedAt !== null &&
    endNow - postSelection.oldestCheckedAt > SAFETY_NET_MAX_AGE_MS
  ) {
    console.warn(
      `[on-this-day] Oldest snapshot checkedAt (${new Date(postSelection.oldestCheckedAt).toISOString()}) is older than 14 days.`,
    );
  }

  return {
    refreshed,
    unchanged,
    degraded,
    suspicious,
    failed,
    refreshedDays,
    remainingStale: postSelection.queue.length,
    oldestCheckedAt: postSelection.oldestCheckedAt,
    ...(stoppedEarlyReason ? { stoppedEarlyReason } : {}),
  };
};
