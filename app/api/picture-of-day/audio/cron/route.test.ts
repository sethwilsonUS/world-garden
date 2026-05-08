import { NextRequest } from "next/server";
import { beforeEach, describe, expect, it, vi } from "vitest";

const syncCurrentPictureOfDayAudio = vi.fn();
const resolvePictureOfDayFeedDateIso = vi.fn();
const getPodcastAdminAuthError = vi.fn();
const getPodcastSiteUrl = vi.fn();
const enforceRouteQuota = vi.fn();
const revalidatePath = vi.fn();

vi.mock("next/cache", () => ({
  revalidatePath,
}));

vi.mock("@/lib/picture-of-day-audio", () => ({
  resolvePictureOfDayFeedDateIso,
  syncCurrentPictureOfDayAudio,
}));

vi.mock("@/lib/podcast-admin-auth", () => ({
  getPodcastAdminAuthError,
}));

vi.mock("@/lib/podcast-feed", () => ({
  getPodcastSiteUrl,
}));

vi.mock("@/lib/route-rate-limit", () => ({
  enforceRouteQuota,
}));

describe("GET /api/picture-of-day/audio/cron", () => {
  beforeEach(() => {
    vi.resetModules();
    vi.clearAllMocks();
    getPodcastAdminAuthError.mockReturnValue(null);
    getPodcastSiteUrl.mockImplementation((origin?: string) => origin ?? "");
    enforceRouteQuota.mockResolvedValue(null);
    resolvePictureOfDayFeedDateIso.mockReturnValue("2026-05-08");
  });

  it("rejects missing or invalid authorization", async () => {
    getPodcastAdminAuthError.mockReturnValue("Unauthorized");

    const { GET } = await import("./route");
    const response = await GET(
      new NextRequest("https://curiogarden.org/api/picture-of-day/audio/cron"),
    );

    expect(response.status).toBe(401);
    await expect(response.json()).resolves.toEqual({ error: "Unauthorized" });
    expect(enforceRouteQuota).not.toHaveBeenCalled();
  });

  it("returns 201 and revalidates the home page when audio is created", async () => {
    syncCurrentPictureOfDayAudio.mockResolvedValue({
      status: "created",
      audio: null,
      feedDate: "2026-05-08",
      title: "Picture of the Day: May 8, 2026",
    });

    const { GET } = await import("./route");
    const response = await GET(
      new NextRequest("https://curiogarden.org/api/picture-of-day/audio/cron", {
        headers: { authorization: "Bearer test-secret" },
      }),
    );

    expect(response.status).toBe(201);
    expect(syncCurrentPictureOfDayAudio).toHaveBeenCalledWith({
      baseUrl: "https://curiogarden.org",
    });
    expect(revalidatePath).toHaveBeenCalledWith("/");
  });

  it("returns 202 without revalidating when generation is already in flight", async () => {
    syncCurrentPictureOfDayAudio.mockResolvedValue({
      status: "pending",
      audio: null,
      feedDate: "2026-05-08",
      title: "Picture of the Day: May 8, 2026",
    });

    const { GET } = await import("./route");
    const response = await GET(
      new NextRequest("https://curiogarden.org/api/picture-of-day/audio/cron", {
        headers: { authorization: "Bearer test-secret" },
      }),
    );

    expect(response.status).toBe(202);
    expect(revalidatePath).not.toHaveBeenCalled();
  });

  it("returns 404 when the featured feed has no picture", async () => {
    syncCurrentPictureOfDayAudio.mockResolvedValue({
      status: "missing_source",
      audio: null,
      feedDate: "2026-05-08",
      title: "Picture of the Day: May 8, 2026",
    });

    const { GET } = await import("./route");
    const response = await GET(
      new NextRequest("https://curiogarden.org/api/picture-of-day/audio/cron", {
        headers: { authorization: "Bearer test-secret" },
      }),
    );

    expect(response.status).toBe(404);
  });
});
