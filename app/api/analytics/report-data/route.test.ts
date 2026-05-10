import { NextRequest } from "next/server";
import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  fetchAction: vi.fn(),
}));

vi.mock("convex/nextjs", () => ({
  fetchAction: mocks.fetchAction,
}));

vi.mock("convex/server", async (importOriginal) => {
  const actual = await importOriginal<typeof import("convex/server")>();
  return {
    ...actual,
    anyApi: {
      analyticsRollups: {
        readAnalyticsRollups: "analyticsRollups:readAnalyticsRollups",
      },
    },
  };
});

const makeRequest = (url: string, token?: string) =>
  new NextRequest(url, {
    headers: token ? { Authorization: `Bearer ${token}` } : {},
  });

describe("GET /api/analytics/report-data", () => {
  beforeEach(() => {
    vi.resetModules();
    vi.unstubAllEnvs();
    mocks.fetchAction.mockReset();
  });

  it("returns a configuration error when the report secret is missing", async () => {
    const { GET } = await import("./route");
    const response = await GET(
      makeRequest("https://curiogarden.com/api/analytics/report-data?since=1&until=2"),
    );

    expect(response.status).toBe(500);
    expect(mocks.fetchAction).not.toHaveBeenCalled();
  });

  it("rejects requests with no Authorization header", async () => {
    vi.stubEnv("ANALYTICS_REPORT_SECRET", "report-secret");
    const { GET } = await import("./route");
    const response = await GET(
      makeRequest("https://curiogarden.com/api/analytics/report-data?since=1&until=2"),
    );

    expect(response.status).toBe(401);
    expect(mocks.fetchAction).not.toHaveBeenCalled();
  });

  it("rejects unauthorized requests", async () => {
    vi.stubEnv("ANALYTICS_REPORT_SECRET", "report-secret");
    const { GET } = await import("./route");
    const response = await GET(
      makeRequest(
        "https://curiogarden.com/api/analytics/report-data?since=1&until=2",
        "wrong",
      ),
    );

    expect(response.status).toBe(401);
    expect(mocks.fetchAction).not.toHaveBeenCalled();
  });

  it("rejects invalid ranges", async () => {
    vi.stubEnv("ANALYTICS_REPORT_SECRET", "report-secret");
    const { GET } = await import("./route");
    const response = await GET(
      makeRequest(
        "https://curiogarden.com/api/analytics/report-data?since=2&until=1",
        "report-secret",
      ),
    );

    expect(response.status).toBe(400);
    expect(mocks.fetchAction).not.toHaveBeenCalled();
  });

  it("returns authorized rollups for a valid range", async () => {
    vi.stubEnv("ANALYTICS_REPORT_SECRET", "report-secret");
    mocks.fetchAction.mockResolvedValue([
      {
        key: "rollup-key",
        bucketStart: 1,
        source: "vercel_analytics_drain",
        eventType: "pageview",
        dimensionsJson: "{}",
        count: 4,
        createdAt: 1,
        updatedAt: 1,
      },
    ]);
    const { GET } = await import("./route");
    const response = await GET(
      makeRequest(
        "https://curiogarden.com/api/analytics/report-data?since=1&until=2",
        "report-secret",
      ),
    );
    const json = await response.json();

    expect(response.status).toBe(200);
    expect(json.rollups).toHaveLength(1);
    expect(mocks.fetchAction).toHaveBeenCalledWith(
      "analyticsRollups:readAnalyticsRollups",
      { adminSecret: "report-secret", since: 1, until: 2 },
    );
  });
});
