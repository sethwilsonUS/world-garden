import { NextRequest } from "next/server";
import { beforeEach, describe, expect, it, vi } from "vitest";

const getPodcastAdminAuthError = vi.fn();
const enforceRouteQuota = vi.fn();
const getPodcastSiteUrl = vi.fn();
const warmLatestHomepageArticleSummaries = vi.fn();

vi.mock("@/lib/podcast-admin-auth", () => ({ getPodcastAdminAuthError }));
vi.mock("@/lib/route-rate-limit", () => ({ enforceRouteQuota }));
vi.mock("@/lib/podcast-feed", () => ({ getPodcastSiteUrl }));
vi.mock("@/lib/homepage-audio-warm", () => ({
  warmLatestHomepageArticleSummaries,
}));

describe("GET /api/featured/audio-warm/cron", () => {
  beforeEach(() => {
    vi.resetModules();
    vi.clearAllMocks();
    getPodcastAdminAuthError.mockReturnValue(null);
    enforceRouteQuota.mockResolvedValue(null);
    getPodcastSiteUrl.mockImplementation((origin: string) => origin);
    warmLatestHomepageArticleSummaries.mockResolvedValue({
      status: "completed",
      targets: 8,
      reused: 5,
      generated: 3,
      degraded: 0,
      failed: 0,
      capped: 0,
      deadlineSkipped: 0,
      failures: [],
    });
  });

  it("requires cron authorization", async () => {
    getPodcastAdminAuthError.mockReturnValue("Unauthorized");
    const { GET } = await import("./route");
    const response = await GET(
      new NextRequest("https://curiogarden.org/api/featured/audio-warm/cron"),
    );

    expect(response.status).toBe(401);
    expect(warmLatestHomepageArticleSummaries).not.toHaveBeenCalled();
  });

  it("honors route quota responses", async () => {
    enforceRouteQuota.mockResolvedValue(
      Response.json({ error: "Too many requests" }, { status: 429 }),
    );
    const { GET } = await import("./route");
    const response = await GET(
      new NextRequest("https://curiogarden.org/api/featured/audio-warm/cron"),
    );

    expect(response.status).toBe(429);
    expect(warmLatestHomepageArticleSummaries).not.toHaveBeenCalled();
  });

  it("returns structured partial results with a successful HTTP status", async () => {
    warmLatestHomepageArticleSummaries.mockResolvedValue({
      status: "partial",
      targets: 8,
      reused: 5,
      generated: 2,
      degraded: 1,
      failed: 1,
      capped: 0,
      deadlineSkipped: 0,
      failures: [{ title: "One", slug: "One", source: "news", error: "Failed" }],
    });
    const { GET } = await import("./route");
    const response = await GET(
      new NextRequest("https://curiogarden.org/api/featured/audio-warm/cron"),
    );
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(response.headers.get("Cache-Control")).toBe("no-store");
    expect(warmLatestHomepageArticleSummaries).toHaveBeenCalledWith({
      baseUrl: "https://curiogarden.org",
    });
    expect(body).toMatchObject({ status: "partial", degraded: 1, failed: 1 });
  });

  it("does not expose internal exception details", async () => {
    warmLatestHomepageArticleSummaries.mockRejectedValue(
      new Error("secret provider response"),
    );
    const consoleError = vi.spyOn(console, "error").mockImplementation(() => {});
    const { GET } = await import("./route");
    const response = await GET(
      new NextRequest("https://curiogarden.org/api/featured/audio-warm/cron"),
    );
    const body = await response.json();

    expect(response.status).toBe(500);
    expect(body.error).toBe("Homepage article summary audio warm failed");
    consoleError.mockRestore();
  });
});
