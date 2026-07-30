import { revalidatePath } from "next/cache";
import { NextRequest } from "next/server";
import { beforeEach, describe, expect, it, vi } from "vitest";

const getPodcastAdminAuthError = vi.fn();
const enforceRouteQuota = vi.fn();
const syncOnThisDaySnapshot = vi.fn();

vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));
vi.mock("@/lib/podcast-admin-auth", () => ({ getPodcastAdminAuthError }));
vi.mock("@/lib/route-rate-limit", () => ({ enforceRouteQuota }));
vi.mock("@/lib/on-this-day-snapshot", () => ({ syncOnThisDaySnapshot }));

describe("GET /api/on-this-day/cron", () => {
  beforeEach(() => {
    vi.resetModules();
    vi.clearAllMocks();
    getPodcastAdminAuthError.mockReturnValue(null);
    enforceRouteQuota.mockResolvedValue(null);
    syncOnThisDaySnapshot.mockResolvedValue({
      feedDate: "2026-07-30",
      provider: "wikifeeds-v1",
      counts: { selected: 16, events: 54, births: 193, deaths: 104, holidays: 15 },
    });
  });

  it("publishes the daily edition and revalidates its page", async () => {
    const { GET } = await import("./route");
    const response = await GET(
      new NextRequest("https://curiogarden.org/api/on-this-day/cron"),
    );
    const body = await response.json();

    expect(response.status).toBe(201);
    expect(syncOnThisDaySnapshot).toHaveBeenCalledWith();
    expect(revalidatePath).toHaveBeenCalledWith("/on-this-day");
    expect(revalidatePath).toHaveBeenCalledWith("/api/on-this-day");
    expect(body.counts.events).toBe(54);
  });
});
