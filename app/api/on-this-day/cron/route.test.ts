import { revalidatePath } from "next/cache";
import { NextRequest } from "next/server";
import { beforeEach, describe, expect, it, vi } from "vitest";

const getPodcastAdminAuthError = vi.fn();
const enforceRouteQuota = vi.fn();
const runOnThisDayRollingRefresh = vi.fn();
const refreshSingleOnThisDayCalendarDay = vi.fn();

vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));
vi.mock("@/lib/podcast-admin-auth", () => ({ getPodcastAdminAuthError }));
vi.mock("@/lib/route-rate-limit", () => ({ enforceRouteQuota }));
vi.mock("@/lib/on-this-day-snapshot", () => ({
  runOnThisDayRollingRefresh,
  refreshSingleOnThisDayCalendarDay,
}));

describe("GET /api/on-this-day/cron", () => {
  beforeEach(() => {
    vi.resetModules();
    vi.clearAllMocks();
    getPodcastAdminAuthError.mockReturnValue(null);
    enforceRouteQuota.mockResolvedValue(null);
    runOnThisDayRollingRefresh.mockImplementation(
      async ({ onDayRefreshed }: { onDayRefreshed?: (d: { month: number; day: number }) => void }) => {
        const refreshedDays = [
          { month: 3, day: 5 },
          { month: 11, day: 23 },
        ];
        for (const day of refreshedDays) onDayRefreshed?.(day);
        return {
          refreshed: 2,
          unchanged: 5,
          degraded: 0,
          skipped: 1,
          suspicious: 0,
          failed: 0,
          refreshedDays,
          remainingStale: 0,
          oldestCheckedAt: 1_780_000_000_000,
          stoppedEarlyReason: "rate-limit",
          retryAfterSeconds: 600,
        };
      },
    );
  });

  it("runs the rolling refresh worker, propagates retryAfterSeconds, and revalidates refreshed day pages", async () => {
    const { GET } = await import("./route");
    const response = await GET(
      new NextRequest(
        "https://curiogarden.org/api/on-this-day/cron?budgetSeconds=180",
      ),
    );
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(runOnThisDayRollingRefresh).toHaveBeenCalledWith(
      expect.objectContaining({ budgetSeconds: 180 }),
    );
    expect(revalidatePath).toHaveBeenCalledWith("/on-this-day");
    expect(revalidatePath).toHaveBeenCalledWith("/api/on-this-day");
    expect(revalidatePath).toHaveBeenCalledWith("/on-this-day/march-5");
    expect(revalidatePath).toHaveBeenCalledWith("/on-this-day/november-23");
    expect(body).toMatchObject({
      refreshed: 2,
      unchanged: 5,
      skipped: 1,
      remainingStale: 0,
      stoppedEarlyReason: "rate-limit",
      retryAfterSeconds: 600,
    });
  });

  it("still revalidates already-committed days if a later day throws", async () => {
    const errorSpy = vi
      .spyOn(console, "error")
      .mockImplementation(() => undefined);
    try {
      runOnThisDayRollingRefresh.mockImplementationOnce(
        async ({ onDayRefreshed }: { onDayRefreshed?: (d: { month: number; day: number }) => void }) => {
          onDayRefreshed?.({ month: 3, day: 5 });
          throw new Error("Convex transient error on next day");
        },
      );

      const { GET } = await import("./route");
      const response = await GET(
        new NextRequest("https://curiogarden.org/api/on-this-day/cron"),
      );
      expect(response.status).toBe(500);
      expect(revalidatePath).toHaveBeenCalledWith("/on-this-day");
      expect(revalidatePath).toHaveBeenCalledWith("/on-this-day/march-5");
    } finally {
      errorSpy.mockRestore();
    }
  });

  it("supports forced single-day refresh and returns 409 when lease is held", async () => {
    refreshSingleOnThisDayCalendarDay.mockResolvedValueOnce({
      status: "refreshed",
      monthDay: "03-05",
      snapshot: { monthDay: "03-05" },
    });

    const { GET } = await import("./route");
    const response = await GET(
      new NextRequest(
        "https://curiogarden.org/api/on-this-day/cron?day=03-05&force=1",
      ),
    );
    expect(response.status).toBe(200);
    expect(refreshSingleOnThisDayCalendarDay).toHaveBeenCalledWith({
      day: { month: 3, day: 5 },
      force: true,
    });
    expect(revalidatePath).toHaveBeenCalledWith("/on-this-day/march-5");

    refreshSingleOnThisDayCalendarDay.mockResolvedValueOnce({
      status: "skipped",
      monthDay: "03-05",
      reason: "lease-held",
    });
    const conflict = await GET(
      new NextRequest("https://curiogarden.org/api/on-this-day/cron?day=03-05"),
    );
    expect(conflict.status).toBe(409);
  });

  it("rejects invalid budgetSeconds or day parameters", async () => {
    const { GET } = await import("./route");
    const badBudget = await GET(
      new NextRequest(
        "https://curiogarden.org/api/on-this-day/cron?budgetSeconds=abc",
      ),
    );
    expect(badBudget.status).toBe(400);

    const badDay = await GET(
      new NextRequest(
        "https://curiogarden.org/api/on-this-day/cron?day=february-30",
      ),
    );
    expect(badDay.status).toBe(400);
  });
});
