import { NextRequest } from "next/server";
import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  createStatementAttestation: vi.fn(),
  fetchAction: vi.fn(),
}));

vi.mock("convex/nextjs", () => ({ fetchAction: mocks.fetchAction }));

vi.mock("convex/server", async (importOriginal) => {
  const actual = await importOriginal<typeof import("convex/server")>();
  return {
    ...actual,
    anyApi: {
      aiCostLedger: { upsertCostStatement: "aiCostLedger:upsertCostStatement" },
    },
  };
});

vi.mock("@/lib/ai-cost-owner-attestation", () => ({
  createAiCostStatementAttestation: mocks.createStatementAttestation,
}));

const statement = {
  statementKey: "openai-costs:2026-07",
  provider: "openai",
  serviceScope: "all_direct_ai",
  periodStartDay: "2026-07-01",
  periodEndDay: "2026-08-01",
  amountMicros: 130_000,
  currency: "USD",
  source: "provider_costs_api",
  allocationMethod: "estimated_cost_weight",
};

const makeRequest = (body: unknown, token?: string) =>
  new NextRequest("https://curiogarden.org/api/analytics/costs/statements", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
    },
    body: typeof body === "string" ? body : JSON.stringify(body),
  });

describe("POST /api/analytics/costs/statements", () => {
  beforeEach(() => {
    vi.resetModules();
    vi.unstubAllEnvs();
    mocks.fetchAction.mockReset();
    mocks.createStatementAttestation.mockReset();
    mocks.createStatementAttestation.mockResolvedValue({
      signature: "statement-signature",
    });
  });

  it("requires the configured owner secret", async () => {
    const { POST } = await import("./route");
    const response = await POST(makeRequest(statement, "anything"));

    expect(response.status).toBe(500);
    expect(response.headers.get("cache-control")).toBe("no-store");
    expect(mocks.fetchAction).not.toHaveBeenCalled();
  });

  it.each([undefined, "wrong-secret"])(
    "rejects missing or incorrect owner authorization",
    async (token) => {
      vi.stubEnv("ANALYTICS_REPORT_SECRET", "report-secret");
      const { POST } = await import("./route");
      const response = await POST(makeRequest(statement, token));

      expect(response.status).toBe(401);
      expect(mocks.fetchAction).not.toHaveBeenCalled();
    },
  );

  it.each([
    ["invalid JSON", "{"],
    ["unsupported field", { ...statement, invoiceContents: "do not store" }],
    ["invalid period", { ...statement, periodEndDay: "2026-07-01" }],
    ["floating-point money", { ...statement, amountMicros: 1.5 }],
    ["free-text note", { ...statement, allocationNote: "invoice 123" }],
  ])("rejects %s", async (_label, body) => {
    vi.stubEnv("ANALYTICS_REPORT_SECRET", "report-secret");
    const { POST } = await import("./route");
    const response = await POST(makeRequest(body, "report-secret"));

    expect(response.status).toBe(400);
    expect(mocks.fetchAction).not.toHaveBeenCalled();
  });

  it("upserts a validated statement with a payload-bound attestation", async () => {
    vi.stubEnv("ANALYTICS_REPORT_SECRET", "report-secret");
    mocks.fetchAction.mockResolvedValue({
      created: true,
      statementKey: statement.statementKey,
    });
    const { POST } = await import("./route");
    const response = await POST(makeRequest(statement, "report-secret"));

    expect(response.status).toBe(200);
    expect(response.headers.get("cache-control")).toBe("no-store");
    expect(await response.json()).toEqual({
      created: true,
      statementKey: statement.statementKey,
    });
    expect(mocks.createStatementAttestation).toHaveBeenCalledWith(statement);
    expect(mocks.fetchAction).toHaveBeenCalledWith(
      "aiCostLedger:upsertCostStatement",
      {
        statement,
        attestation: { signature: "statement-signature" },
      },
    );
  });

  it("does not expose storage details when an upsert fails", async () => {
    vi.stubEnv("ANALYTICS_REPORT_SECRET", "report-secret");
    mocks.fetchAction.mockRejectedValue(
      new Error("invoice-row-or-database-detail-must-not-escape"),
    );
    const { POST } = await import("./route");
    const response = await POST(makeRequest(statement, "report-secret"));
    const body = await response.text();

    expect(response.status).toBe(502);
    expect(response.headers.get("cache-control")).toBe("no-store");
    expect(body).toContain("Cost statement could not be stored");
    expect(body).not.toContain("database-detail");
  });
});
