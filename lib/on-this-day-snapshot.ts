import { anyApi } from "convex/server";
import { fetchMutation, fetchQuery } from "convex/nextjs";
import {
  calendarDayFromUtcDate,
  calendarDayKey,
  formatUtcDateIso,
  isSameCalendarDay,
  type CalendarDay,
} from "@/lib/calendar-day";
import type { WikipediaOnThisDayItem } from "@/lib/featured-article";
import {
  buildFeaturedOnThisDayFallback,
  buildOnThisDaySnapshot,
  hashOnThisDaySnapshot,
} from "@/lib/on-this-day";
import {
  CURRENT_ON_THIS_DAY_SCHEMA_VERSION,
  type OnThisDayRefreshState,
  type OnThisDaySnapshot,
} from "@/lib/on-this-day-contracts";
import {
  REFRESH_LEASE_TTL_MS,
  refreshCalendarDay,
  runRollingRefreshWorker,
  shouldTriggerSafetyNetRefresh,
  type OnThisDayRefreshStore,
  type RefreshCalendarDayResult,
  type RollingRefreshSummary,
  type StoredOnThisDayDay,
} from "@/lib/on-this-day-refresh";
import { createPublicAudioWriteAttestation } from "@/lib/public-audio-write-attestation";
import { getTodayWikipediaData } from "@/lib/today-snapshot";

const LOCAL_CACHE_MAX_ENTRIES = 10;
const LOCAL_CACHE_TTL_MS = 60 * 60 * 1000;

type LocalCacheEntry = {
  snapshot: OnThisDaySnapshot;
  checkedAt: number;
  changedAt: number;
  expiresAt: number;
};

const localCache = new Map<string, LocalCacheEntry>();

export const clearLocalOnThisDayCache = (): void => {
  localCache.clear();
};

export const shouldUseOnThisDaySnapshotCache = (): boolean =>
  process.env.NEXT_PUBLIC_LOCAL_MODE !== "true" &&
  Boolean(process.env.NEXT_PUBLIC_CONVEX_URL);

const getFeaturedItemsForUtcDate = async (
  feedDateIso: string,
): Promise<WikipediaOnThisDayItem[] | null> => {
  const today = await getTodayWikipediaData({
    allowLiveFallback: false,
    feedDateIso,
  });
  if (!today || today.onThisDay.length === 0) return null;
  return today.onThisDay;
};

export const createConvexOnThisDayStore = (): OnThisDayRefreshStore => ({
  async getDaySnapshot(monthDay) {
    if (!shouldUseOnThisDaySnapshotCache()) return null;
    const record = (await fetchQuery(anyApi.onThisDay.getDaySnapshot, {
      monthDay,
    })) as StoredOnThisDayDay | null;
    return record ?? null;
  },

  async listRefreshStates() {
    if (!shouldUseOnThisDaySnapshotCache()) return [];
    const rows = (await fetchQuery(
      anyApi.onThisDay.listRefreshStates,
      {},
    )) as OnThisDayRefreshState[] | null;
    return rows ?? [];
  },

  async saveDaySnapshot(writeArgs) {
    if (!shouldUseOnThisDaySnapshotCache()) return;
    const attestation = await createPublicAudioWriteAttestation({
      pipeline: "on-this-day",
      operation: "save-record",
      args: writeArgs,
    });
    await fetchMutation(anyApi.onThisDay.saveDaySnapshot, {
      ...writeArgs,
      attestation,
    });
  },

  async markDayCheckedUnchanged(writeArgs) {
    if (!shouldUseOnThisDaySnapshotCache()) return;
    const attestation = await createPublicAudioWriteAttestation({
      pipeline: "on-this-day",
      operation: "finalize-job",
      args: writeArgs,
    });
    await fetchMutation(anyApi.onThisDay.markDayCheckedUnchanged, {
      ...writeArgs,
      attestation,
    });
  },

  async recordRefreshFailure(writeArgs) {
    if (!shouldUseOnThisDaySnapshotCache()) {
      return { suspiciousStreak: writeArgs.suspicious ? 1 : 0 };
    }
    const attestation = await createPublicAudioWriteAttestation({
      pipeline: "on-this-day",
      operation: "upsert-job",
      args: writeArgs,
    });
    const result = (await fetchMutation(
      anyApi.onThisDay.recordRefreshFailure,
      {
        ...writeArgs,
        attestation,
      },
    )) as { suspiciousStreak?: number } | null;
    return { suspiciousStreak: result?.suspiciousStreak ?? 0 };
  },

  async claimRefreshLease(writeArgs) {
    if (!shouldUseOnThisDaySnapshotCache()) return false;
    const attestation = await createPublicAudioWriteAttestation({
      pipeline: "on-this-day",
      operation: "claim-job",
      args: writeArgs,
    });
    const claimed = (await fetchMutation(anyApi.onThisDay.claimRefreshLease, {
      ...writeArgs,
      attestation,
    })) as boolean;
    return Boolean(claimed);
  },
});

const getLocalCachedDay = async (
  day: CalendarDay,
  now: number,
): Promise<OnThisDayDayRecord> => {
  const key = calendarDayKey(day);
  const existing = localCache.get(key);
  if (existing && now < existing.expiresAt) {
    localCache.delete(key);
    localCache.set(key, existing);
    return {
      snapshot: existing.snapshot,
      checkedAt: existing.checkedAt,
      changedAt: existing.changedAt,
      degraded: existing.snapshot.provider === "featured-fallback",
      needsSafetyNetRefresh: false,
    };
  }
  if (existing) localCache.delete(key);

  const snapshot = await buildOnThisDaySnapshot({
    day,
    checkedAt: now,
  });
  if (localCache.size >= LOCAL_CACHE_MAX_ENTRIES) {
    const oldestKey = localCache.keys().next().value;
    if (oldestKey !== undefined) localCache.delete(oldestKey);
  }
  localCache.set(key, {
    snapshot,
    checkedAt: now,
    changedAt: now,
    expiresAt: now + LOCAL_CACHE_TTL_MS,
  });

  return {
    snapshot,
    checkedAt: now,
    changedAt: now,
    degraded: false,
    needsSafetyNetRefresh: false,
  };
};

export type OnThisDayDayRecord = {
  snapshot: OnThisDaySnapshot;
  checkedAt: number;
  changedAt: number;
  degraded: boolean;
  needsSafetyNetRefresh: boolean;
};

export const getOnThisDayDayRecord = async ({
  day,
  allowColdBuild = true,
  now = Date.now(),
}: {
  day: CalendarDay;
  allowColdBuild?: boolean;
  now?: number;
}): Promise<OnThisDayDayRecord | null> => {
  if (!shouldUseOnThisDaySnapshotCache()) {
    if (!allowColdBuild) return null;
    return await getLocalCachedDay(day, now);
  }

  const store = createConvexOnThisDayStore();
  const monthDay = calendarDayKey(day);
  const stored = await store.getDaySnapshot(monthDay);

  if (stored?.data) {
    const state = stored.state;
    const degraded =
      state?.degraded ?? stored.data.provider === "featured-fallback";
    const checkedAt = state?.checkedAt || stored.data.checkedAt || now;
    const changedAt = state?.changedAt || checkedAt;
    return {
      snapshot: stored.data,
      checkedAt,
      changedAt,
      degraded,
      needsSafetyNetRefresh: shouldTriggerSafetyNetRefresh(state, now),
    };
  }

  if (!allowColdBuild) return null;

  try {
    const coldSnapshot = await buildOnThisDaySnapshot({
      day,
      skipImageResolution: true,
      checkedAt: now,
    });
    await store
      .saveDaySnapshot({
        monthDay,
        schemaVersion: CURRENT_ON_THIS_DAY_SCHEMA_VERSION,
        data: coldSnapshot,
        contentHash: hashOnThisDaySnapshot(coldSnapshot),
        degraded: false,
        checkedAt: now,
        changedAt: now,
        imagesCheckedAt: 0,
        lastAttemptAt: now,
      })
      .catch((error) => {
        console.error(
          `[on-this-day] Failed to persist cold snapshot for ${monthDay}`,
          error,
        );
      });

    return {
      snapshot: coldSnapshot,
      checkedAt: now,
      changedAt: now,
      degraded: false,
      needsSafetyNetRefresh: false,
    };
  } catch (error) {
    const utcNow = new Date(now);
    if (isSameCalendarDay(day, calendarDayFromUtcDate(utcNow))) {
      const items = await getFeaturedItemsForUtcDate(
        formatUtcDateIso(utcNow),
      ).catch(() => null);
      if (items && items.length > 0) {
        const degradedSnapshot = buildFeaturedOnThisDayFallback({
          day,
          items,
          checkedAt: now,
        });
        await store
          .saveDaySnapshot({
            monthDay,
            schemaVersion: CURRENT_ON_THIS_DAY_SCHEMA_VERSION,
            data: degradedSnapshot,
            contentHash: hashOnThisDaySnapshot(degradedSnapshot),
            degraded: true,
            checkedAt: now,
            changedAt: now,
            imagesCheckedAt: 0,
            lastAttemptAt: now,
          })
          .catch(() => undefined);

        return {
          snapshot: degradedSnapshot,
          checkedAt: now,
          changedAt: now,
          degraded: true,
          needsSafetyNetRefresh: false,
        };
      }
    }
    throw error;
  }
};

export const triggerSafetyNetRefresh = async (
  day: CalendarDay,
  now = Date.now(),
): Promise<RefreshCalendarDayResult | null> => {
  if (!shouldUseOnThisDaySnapshotCache()) return null;
  const store = createConvexOnThisDayStore();
  const monthDay = calendarDayKey(day);
  const claimed = await store
    .claimRefreshLease({
      monthDay,
      now,
      ttlMs: REFRESH_LEASE_TTL_MS,
    })
    .catch(() => false);
  if (!claimed) return null;

  return await refreshCalendarDay(day, {
    store,
    getFeaturedItems: getFeaturedItemsForUtcDate,
    now,
  });
};

export const listOnThisDayRefreshStates = async (): Promise<
  OnThisDayRefreshState[]
> => {
  if (!shouldUseOnThisDaySnapshotCache()) return [];
  try {
    return await createConvexOnThisDayStore().listRefreshStates();
  } catch (error) {
    console.error("[on-this-day] failed to list refresh states", error);
    return [];
  }
};

export const runOnThisDayRollingRefresh = async ({
  budgetSeconds,
}: {
  budgetSeconds?: number;
} = {}): Promise<RollingRefreshSummary> => {
  const store = createConvexOnThisDayStore();
  return await runRollingRefreshWorker({
    store,
    getFeaturedItems: getFeaturedItemsForUtcDate,
    budgetSeconds,
  });
};

export const refreshSingleOnThisDayCalendarDay = async ({
  day,
  force = false,
}: {
  day: CalendarDay;
  force?: boolean;
}): Promise<RefreshCalendarDayResult> => {
  const store = createConvexOnThisDayStore();
  return await refreshCalendarDay(day, {
    store,
    getFeaturedItems: getFeaturedItemsForUtcDate,
    force,
  });
};
