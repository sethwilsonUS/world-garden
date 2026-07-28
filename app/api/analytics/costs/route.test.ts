import { NextRequest } from "next/server";
import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  createReportAttestation: vi.fn(),
  fetchAction: vi.fn(),
}));

vi.mock("convex/nextjs", () => ({ fetchAction: mocks.fetchAction }));

vi.mock("convex/server", async (importOriginal) => {
  const actual = await importOriginal<typeof import("convex/server")>();
  return {
    ...actual,
    anyApi: {
      aiCostLedger: { readCostReport: "aiCostLedger:readCostReport" },
    },
  };
});

vi.mock("@/lib/ai-cost-owner-attestation", () => ({
  createAiCostReportAttestation: mocks.createReportAttestation,
}));

const makeRequest = (query: string, token?: string) =>
  new NextRequest(`https://curiogarden.org/api/analytics/costs${query}`, {
    headers: token ? { Authorization: `Bearer ${token}` } : {},
  });

describe("GET /api/analytics/costs", () => {
  beforeEach(() => {
    vi.resetModules();
    vi.unstubAllEnvs();
    mocks.fetchAction.mockReset();
    mocks.createReportAttestation.mockReset();
    mocks.createReportAttestation.mockResolvedValue({
      signature: "report-signature",
    });
  });

  it("fails closed when the owner secret is missing", async () => {
    const { GET } = await import("./route");
    const response = await GET(
      makeRequest("?from=2026-07-01&to=2026-07-02", "anything"),
    );

    expect(response.status).toBe(500);
    expect(response.headers.get("cache-control")).toBe("no-store");
    expect(mocks.fetchAction).not.toHaveBeenCalled();
  });

  it.each([undefined, "wrong-secret"])(
    "rejects missing or incorrect owner authorization",
    async (token) => {
      vi.stubEnv("ANALYTICS_REPORT_SECRET", "report-secret");
      const { GET } = await import("./route");
      const response = await GET(
        makeRequest("?from=2026-07-01&to=2026-07-02", token),
      );

      expect(response.status).toBe(401);
      expect(response.headers.get("cache-control")).toBe("no-store");
      expect(mocks.fetchAction).not.toHaveBeenCalled();
    },
  );

  it.each([
    "?from=2026-07-01",
    "?from=2026-02-29&to=2026-03-01",
    "?from=2026-07-02&to=2026-07-01",
    "?from=2026-01-01&to=2026-04-02",
  ])("rejects an invalid or out-of-range query: %s", async (query) => {
    vi.stubEnv("ANALYTICS_REPORT_SECRET", "report-secret");
    const { GET } = await import("./route");
    const response = await GET(makeRequest(query, "report-secret"));

    expect(response.status).toBe(400);
    expect(mocks.fetchAction).not.toHaveBeenCalled();
  });

  it("returns only the aggregate report for an authorized half-open UTC range", async () => {
    vi.stubEnv("ANALYTICS_REPORT_SECRET", "report-secret");
    const report = {
      range: { from: "2026-07-01", to: "2026-08-01", timezone: "UTC" },
      costs: { reconciled_direct_ai_cost_micros: null },
    };
    mocks.fetchAction.mockResolvedValue(report);
    const { GET } = await import("./route");
    const response = await GET(
      makeRequest("?from=2026-07-01&to=2026-08-01", "report-secret"),
    );

    expect(response.status).toBe(200);
    expect(response.headers.get("cache-control")).toBe("no-store");
    expect(await response.json()).toEqual(report);
    expect(mocks.createReportAttestation).toHaveBeenCalledWith({
      fromDay: "2026-07-01",
      toDay: "2026-08-01",
    });
    expect(mocks.fetchAction).toHaveBeenCalledWith(
      "aiCostLedger:readCostReport",
      {
        fromDay: "2026-07-01",
        toDay: "2026-08-01",
        attestation: { signature: "report-signature" },
      },
    );
  });

  it("returns a no-store generic error when report generation fails", async () => {
    vi.stubEnv("ANALYTICS_REPORT_SECRET", "report-secret");
    mocks.fetchAction.mockRejectedValue(
      new Error("raw-attempt-or-internal-linkage-must-not-escape"),
    );
    const { GET } = await import("./route");
    const response = await GET(
      makeRequest("?from=2026-07-01&to=2026-07-02", "report-secret"),
    );
    const body = await response.text();

    expect(response.status).toBe(502);
    expect(response.headers.get("cache-control")).toBe("no-store");
    expect(body).toContain("AI cost report is temporarily unavailable");
    expect(body).not.toContain("internal-linkage");
  });
});
