import { NextRequest } from "next/server";
import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  createResetAttestation: vi.fn(),
  fetchAction: vi.fn(),
}));

vi.mock("convex/nextjs", () => ({ fetchAction: mocks.fetchAction }));
vi.mock("convex/server", async (importOriginal) => {
  const actual = await importOriginal<typeof import("convex/server")>();
  return {
    ...actual,
    anyApi: {
      aiCostLedger: { resetCoverageEpoch: "aiCostLedger:resetCoverageEpoch" },
    },
  };
});
vi.mock("@/lib/ai-cost-owner-attestation", async (importOriginal) => {
  const actual =
    await importOriginal<typeof import("@/lib/ai-cost-owner-attestation")>();
  return {
    ...actual,
    createAiCostCoverageResetAttestation: mocks.createResetAttestation,
  };
});

const reset = { epochKey: "epoch.reset-0001" };
const request = (body: unknown, token?: string) =>
  new NextRequest("https://curiogarden.org/api/analytics/costs/coverage", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
    },
    body: typeof body === "string" ? body : JSON.stringify(body),
  });

describe("POST /api/analytics/costs/coverage", () => {
  beforeEach(() => {
    vi.resetModules();
    vi.unstubAllEnvs();
    mocks.fetchAction.mockReset();
    mocks.createResetAttestation.mockReset();
    mocks.createResetAttestation.mockResolvedValue({
      signature: "coverage-reset-signature",
    });
  });

  it("fails closed when owner authorization is not configured", async () => {
    const { POST } = await import("./route");
    const response = await POST(request(reset, "any-token"));

    expect(response.status).toBe(500);
    expect(response.headers.get("cache-control")).toBe("no-store");
    expect(mocks.fetchAction).not.toHaveBeenCalled();
  });

  it.each([undefined, "wrong-secret"])(
    "rejects missing or incorrect owner authorization",
    async (token) => {
      vi.stubEnv("ANALYTICS_REPORT_SECRET", "report-secret");
      const { POST } = await import("./route");
      const response = await POST(request(reset, token));

      expect(response.status).toBe(401);
      expect(response.headers.get("cache-control")).toBe("no-store");
      expect(mocks.fetchAction).not.toHaveBeenCalled();
    },
  );

  it.each([
    ["invalid JSON", "{"],
    ["invalid epoch", { epochKey: "short" }],
    ["free text", { ...reset, note: "do not store" }],
  ])("rejects %s", async (_label, body) => {
    vi.stubEnv("ANALYTICS_REPORT_SECRET", "report-secret");
    const { POST } = await import("./route");
    const response = await POST(request(body, "report-secret"));

    expect(response.status).toBe(400);
    expect(mocks.fetchAction).not.toHaveBeenCalled();
  });

  it("resets coverage with a payload-bound owner attestation", async () => {
    vi.stubEnv("ANALYTICS_REPORT_SECRET", "report-secret");
    mocks.fetchAction.mockResolvedValue({
      reset: true,
      disposition: "updated",
      epochVersion: 2,
    });
    const { POST } = await import("./route");
    const response = await POST(request(reset, "report-secret"));

    expect(response.status).toBe(200);
    expect(response.headers.get("cache-control")).toBe("no-store");
    expect(mocks.createResetAttestation).toHaveBeenCalledWith(reset);
    expect(mocks.fetchAction).toHaveBeenCalledWith(
      "aiCostLedger:resetCoverageEpoch",
      {
        reset,
        attestation: { signature: "coverage-reset-signature" },
      },
    );
    expect(await response.json()).toEqual({
      reset: true,
      disposition: "updated",
      epochVersion: 2,
    });
  });

  it("does not expose internal reset failures", async () => {
    vi.stubEnv("ANALYTICS_REPORT_SECRET", "report-secret");
    mocks.fetchAction.mockRejectedValue(
      new Error("database-row-details-must-not-escape"),
    );
    const { POST } = await import("./route");
    const response = await POST(request(reset, "report-secret"));
    const body = await response.text();

    expect(response.status).toBe(502);
    expect(body).toContain("Coverage epoch could not be reset");
    expect(body).not.toContain("database-row-details");
  });
});
