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
    runOnThisDayRollingRefresh.mockResolvedValue({
      refreshed: 2,
      unchanged: 5,
      degraded: 0,
      suspicious: 0,
      failed: 0,
      refreshedDays: [
        { month: 3, day: 5 },
        { month: 11, day: 23 },
      ],
      remainingStale: 0,
      oldestCheckedAt: 1_780_000_000_000,
    });
  });

  it("runs the rolling refresh worker and revalidates refreshed day pages", async () => {
    const { GET } = await import("./route");
    const response = await GET(
      new NextRequest(
        "https://curiogarden.org/api/on-this-day/cron?budgetSeconds=180",
      ),
    );
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(runOnThisDayRollingRefresh).toHaveBeenCalledWith({
      budgetSeconds: 180,
    });
    expect(revalidatePath).toHaveBeenCalledWith("/on-this-day");
    expect(revalidatePath).toHaveBeenCalledWith("/api/on-this-day");
    expect(revalidatePath).toHaveBeenCalledWith("/on-this-day/march-5");
    expect(revalidatePath).toHaveBeenCalledWith("/on-this-day/november-23");
    expect(body).toMatchObject({
      refreshed: 2,
      unchanged: 5,
      remainingStale: 0,
    });
  });

  it("supports forced single-day refresh for manual review", async () => {
    refreshSingleOnThisDayCalendarDay.mockResolvedValue({
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
