import { NextRequest } from "next/server";
import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  fetchQuery: vi.fn(),
}));

vi.mock("convex/nextjs", () => ({
  fetchQuery: mocks.fetchQuery,
}));

vi.mock("convex/server", async (importOriginal) => {
  const actual = await importOriginal<typeof import("convex/server")>();
  return {
    ...actual,
    anyApi: {
      analyticsRollups: {
        getAnalyticsRollups: "analyticsRollups:getAnalyticsRollups",
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
    mocks.fetchQuery.mockReset();
  });

  it("returns a configuration error when the report secret is missing", async () => {
    const { GET } = await import("./route");
    const response = await GET(
      makeRequest("https://curiogarden.com/api/analytics/report-data?since=1&until=2"),
    );

    expect(response.status).toBe(500);
    expect(mocks.fetchQuery).not.toHaveBeenCalled();
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
    expect(mocks.fetchQuery).not.toHaveBeenCalled();
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
    expect(mocks.fetchQuery).not.toHaveBeenCalled();
  });

  it("returns authorized rollups for a valid range", async () => {
    vi.stubEnv("ANALYTICS_REPORT_SECRET", "report-secret");
    mocks.fetchQuery.mockResolvedValue([
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
    expect(mocks.fetchQuery).toHaveBeenCalledWith(
      "analyticsRollups:getAnalyticsRollups",
      { since: 1, until: 2 },
    );
  });
});
