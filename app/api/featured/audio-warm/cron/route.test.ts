import { NextRequest } from "next/server";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const getPodcastAdminAuthError = vi.fn();
const enforceRouteQuota = vi.fn();
const getRequestAudioGenerationBaseUrl = vi.fn();
const warmLatestHomepageArticleSummaries = vi.fn();

vi.mock("@/lib/podcast-admin-auth", () => ({ getPodcastAdminAuthError }));
vi.mock("@/lib/route-rate-limit", () => ({ enforceRouteQuota }));
vi.mock("@/lib/audio-generation-url", () => ({
  getRequestAudioGenerationBaseUrl,
}));
vi.mock("@/lib/homepage-audio-warm", () => ({
  warmLatestHomepageArticleSummaries,
  HOMEPAGE_AUDIO_WARM_DEADLINE_MS: 240_000,
  HOMEPAGE_AUDIO_WARM_DEADLINE_MESSAGE: "Homepage audio warm deadline exceeded",
}));

describe("GET /api/featured/audio-warm/cron", () => {
  afterEach(() => {
    vi.restoreAllMocks();
    vi.useRealTimers();
  });

  beforeEach(() => {
    vi.resetModules();
    vi.clearAllMocks();
    getPodcastAdminAuthError.mockReturnValue(null);
    enforceRouteQuota.mockResolvedValue(null);
    getRequestAudioGenerationBaseUrl.mockReturnValue(
      "https://trusted-preview.vercel.app",
    );
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
      failures: [
        { title: "One", slug: "One", source: "news", error: "Failed" },
      ],
    });
    const { GET } = await import("./route");
    const response = await GET(
      new NextRequest("https://curiogarden.org/api/featured/audio-warm/cron"),
    );
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(response.headers.get("Cache-Control")).toBe("no-store");
    expect(warmLatestHomepageArticleSummaries).toHaveBeenCalledWith({
      baseUrl: "https://trusted-preview.vercel.app",
      signal: expect.any(AbortSignal),
    });
    expect(getRequestAudioGenerationBaseUrl).toHaveBeenCalledWith(
      "https://curiogarden.org/api/featured/audio-warm/cron",
    );
    expect(body).toMatchObject({ status: "partial", degraded: 1, failed: 1 });
  });

  it("does not expose internal exception details", async () => {
    warmLatestHomepageArticleSummaries.mockRejectedValue(
      new Error("secret provider response"),
    );
    const consoleError = vi
      .spyOn(console, "error")
      .mockImplementation(() => {});
    const { GET } = await import("./route");
    const response = await GET(
      new NextRequest("https://curiogarden.org/api/featured/audio-warm/cron"),
    );
    const body = await response.json();

    expect(response.status).toBe(500);
    expect(body.error).toBe("Homepage article summary audio warm failed");
    expect(consoleError).toHaveBeenCalled();
  });

  it("bounds a stalled quota check and never warms after it eventually resolves", async () => {
    vi.useFakeTimers();
    vi.spyOn(console, "error").mockImplementation(() => {});
    let finishQuota!: (value: null) => void;
    enforceRouteQuota.mockImplementationOnce(
      () =>
        new Promise((resolve) => {
          finishQuota = resolve;
        }),
    );
    const { GET } = await import("./route");
    const pending = GET(
      new NextRequest("https://curiogarden.org/api/featured/audio-warm/cron"),
    );
    await vi.advanceTimersByTimeAsync(240_000);
    const response = await pending;
    expect(response.status).toBe(503);
    expect(enforceRouteQuota.mock.calls[0][0].signal.aborted).toBe(true);
    finishQuota(null);
    await vi.advanceTimersByTimeAsync(0);
    expect(warmLatestHomepageArticleSummaries).not.toHaveBeenCalled();
    expect(vi.getTimerCount()).toBe(0);
  });

  it("shares the route budget with warming after a slow quota check", async () => {
    vi.useFakeTimers();
    enforceRouteQuota.mockImplementationOnce(
      () => new Promise((resolve) => setTimeout(() => resolve(null), 60_000)),
    );
    warmLatestHomepageArticleSummaries.mockImplementationOnce(
      ({ signal }) =>
        new Promise((resolve) => {
          signal.addEventListener(
            "abort",
            () => resolve({ status: "partial", deadlineExceeded: true }),
            { once: true },
          );
        }),
    );
    const { GET } = await import("./route");
    const pending = GET(
      new NextRequest("https://curiogarden.org/api/featured/audio-warm/cron"),
    );
    await vi.advanceTimersByTimeAsync(240_000);
    const response = await pending;
    expect(response.status).toBe(200);
    expect(await response.json()).toMatchObject({
      status: "partial",
      deadlineExceeded: true,
    });
    expect(vi.getTimerCount()).toBe(0);
  });
});
