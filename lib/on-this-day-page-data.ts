import { revalidatePath } from "next/cache";
import { after } from "next/server";
import { onThisDayPath, type CalendarDay } from "@/lib/calendar-day";
import { paginateOnThisDaySnapshot } from "@/lib/on-this-day";
import type { OnThisDayPageResponse } from "@/lib/on-this-day-contracts";
import {
  getOnThisDayDayRecord,
  shouldUseOnThisDaySnapshotCache,
  triggerSafetyNetRefresh,
} from "@/lib/on-this-day-snapshot";

export const getInitialOnThisDayPageResponse = async (
  day: CalendarDay,
): Promise<OnThisDayPageResponse | null> => {
  // In local mode (no Convex cache), let the client fetch `/api/on-this-day`
  // so builds and browser tests never hit live Wikipedia during SSR.
  if (!shouldUseOnThisDaySnapshotCache()) {
    return null;
  }

  try {
    const record = await getOnThisDayDayRecord({
      day,
      allowColdBuild: true,
    });
    if (!record) return null;

    if (record.needsSafetyNetRefresh) {
      after(async () => {
        try {
          const result = await triggerSafetyNetRefresh(day);
          if (
            result &&
            (result.status === "refreshed" || result.status === "degraded")
          ) {
            revalidatePath("/on-this-day");
            revalidatePath(onThisDayPath(day));
          }
        } catch (refreshError) {
          console.error(
            "[on-this-day page] safety-net refresh failed",
            refreshError,
          );
        }
      });
    }

    return paginateOnThisDaySnapshot(record.snapshot, {
      category: "selected",
      order: "newest",
      offset: 0,
      limit: 25,
      checkedAt: record.checkedAt,
      changedAt: record.changedAt,
      degraded: record.degraded,
    });
  } catch (error) {
    console.error("[on-this-day page] initial snapshot load failed", error);
    return null;
  }
};
