import { revalidatePath } from "next/cache";
import { NextRequest } from "next/server";
import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  CURRENT_ON_THIS_DAY_SCHEMA_VERSION,
  type OnThisDaySnapshot,
} from "@/lib/on-this-day-contracts";

const {
  afterCallbacks,
  afterMock,
  getOnThisDayDayRecord,
  triggerSafetyNetRefresh,
} = vi.hoisted(() => {
  const callbacks: Array<() => unknown> = [];
  return {
    afterCallbacks: callbacks,
    afterMock: vi.fn((callback: () => unknown) => {
      callbacks.push(callback);
    }),
    getOnThisDayDayRecord: vi.fn(),
    triggerSafetyNetRefresh: vi.fn(),
  };
});

vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));
vi.mock("next/server", async (importOriginal) => {
  const original = await importOriginal<typeof import("next/server")>();
  return { ...original, after: afterMock };
});
vi.mock("@/lib/on-this-day-snapshot", () => ({
  getOnThisDayDayRecord,
  triggerSafetyNetRefresh,
}));

const snapshot: OnThisDaySnapshot = {
  schemaVersion: CURRENT_ON_THIS_DAY_SCHEMA_VERSION,
  provider: "wikipedia-rest-v1",
  monthDay: "07-30",
  checkedAt: 1_780_000_000_000,
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
    afterCallbacks.length = 0;
    getOnThisDayDayRecord.mockResolvedValue({
      snapshot,
      checkedAt: 1_780_000_000_000,
      changedAt: 1_779_900_000_000,
      degraded: false,
      needsSafetyNetRefresh: false,
    });
  });

  it("returns a capped, ordered page with Calendar Day metadata and normal cache headers", async () => {
    const { GET } = await import("./route");
    const response = await GET(
      new NextRequest(
        "https://curiogarden.org/api/on-this-day?day=07-30&category=events&order=oldest&offset=0&limit=99",
      ),
    );
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(response.headers.get("cache-control")).toBe(
      "public, max-age=900, s-maxage=3600, stale-while-revalidate=86400",
    );
    expect(getOnThisDayDayRecord).toHaveBeenCalledWith(
      expect.objectContaining({
        day: { month: 7, day: 30 },
        allowColdBuild: true,
      }),
    );
    expect(afterMock).not.toHaveBeenCalled();
    expect(body).toMatchObject({
      calendarDay: "07-30",
      checkedAt: 1_780_000_000_000,
      changedAt: 1_779_900_000_000,
      degraded: false,
      category: "events",
      order: "oldest",
      limit: 25,
      total: 30,
      nextOffset: 25,
    });
    expect(body.items).toHaveLength(25);
    expect(body.items[0].year).toBe(1900);
  });

  it("caps Cache-Control at UTC midnight for undated requests so caches cannot cross midnight", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-07-30T23:59:00Z"));
    try {
      const { GET } = await import("./route");
      const response = await GET(
        new NextRequest("https://curiogarden.org/api/on-this-day"),
      );
      expect(response.status).toBe(200);
      expect(response.headers.get("cache-control")).toBe(
        "public, max-age=60, s-maxage=60",
      );
    } finally {
      vi.useRealTimers();
    }
  });

  it("maps legacy date=YYYY-MM-DD parameters for one-release backwards compatibility", async () => {
    const { GET } = await import("./route");
    const response = await GET(
      new NextRequest(
        "https://curiogarden.org/api/on-this-day?date=2026-07-30&category=events",
      ),
    );
    expect(response.status).toBe(200);
    expect(getOnThisDayDayRecord).toHaveBeenCalledWith(
      expect.objectContaining({
        day: { month: 7, day: 30 },
        allowColdBuild: true,
      }),
    );
  });

  it("uses no-store headers for degraded snapshots and schedules safety-net refresh via after()", async () => {
    getOnThisDayDayRecord.mockResolvedValue({
      snapshot: { ...snapshot, provider: "featured-fallback" },
      checkedAt: 1_780_000_000_000,
      changedAt: 1_780_000_000_000,
      degraded: true,
      needsSafetyNetRefresh: true,
    });
    triggerSafetyNetRefresh.mockResolvedValue({
      status: "refreshed",
      monthDay: "07-30",
      snapshot,
    });

    const { GET } = await import("./route");
    const response = await GET(
      new NextRequest("https://curiogarden.org/api/on-this-day?day=07-30"),
    );

    expect(response.status).toBe(200);
    expect(response.headers.get("cache-control")).toBe("no-store");
    expect(afterMock).toHaveBeenCalledTimes(1);

    await afterCallbacks[0]?.();
    expect(triggerSafetyNetRefresh).toHaveBeenCalledWith({
      month: 7,
      day: 30,
    });
    expect(revalidatePath).toHaveBeenCalledWith("/on-this-day");
    expect(revalidatePath).toHaveBeenCalledWith("/on-this-day/july-30");
  });

  it("rejects invalid days and filters before loading a snapshot", async () => {
    const { GET } = await import("./route");
    const badCategory = await GET(
      new NextRequest(
        "https://curiogarden.org/api/on-this-day?category=anniversaries",
      ),
    );
    expect(badCategory.status).toBe(400);

    const badDay = await GET(
      new NextRequest("https://curiogarden.org/api/on-this-day?day=02-30"),
    );
    expect(badDay.status).toBe(400);
    expect(getOnThisDayDayRecord).not.toHaveBeenCalled();
  });

  it("returns 503 with a clear message when a cold day cannot be built", async () => {
    const errorSpy = vi
      .spyOn(console, "error")
      .mockImplementation(() => undefined);
    try {
      getOnThisDayDayRecord.mockRejectedValue(new Error("Upstream failure"));
      const { GET } = await import("./route");
      const response = await GET(
        new NextRequest("https://curiogarden.org/api/on-this-day?day=03-05"),
      );
      expect(response.status).toBe(503);
      expect(response.headers.get("cache-control")).toBe("no-store");
      await expect(response.json()).resolves.toEqual({
        error: "This day isn't available right now.",
      });
    } finally {
      errorSpy.mockRestore();
    }
  });
});
