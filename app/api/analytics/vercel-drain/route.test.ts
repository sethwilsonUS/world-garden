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
        ingestAnalyticsRollups: "analyticsRollups:ingestAnalyticsRollups",
      },
    },
  };
});

const signBody = async (body: string, secret: string) => {
  const { createHmac } = await import("node:crypto");
  return `sha1=${createHmac("sha1", secret).update(body).digest("hex")}`;
};

const makeRequest = async (body: string, signature?: string) =>
  new NextRequest("https://curiogarden.com/api/analytics/vercel-drain", {
    method: "POST",
    headers: signature ? { "x-vercel-signature": signature } : {},
    body,
  });

describe("POST /api/analytics/vercel-drain", () => {
  beforeEach(() => {
    vi.resetModules();
    vi.unstubAllEnvs();
    mocks.fetchAction.mockReset();
  });

  it("rejects requests when the drain secret is not configured", async () => {
    const { POST } = await import("./route");
    const response = await POST(await makeRequest("[]", "sha1=anything"));

    expect(response.status).toBe(500);
    expect(mocks.fetchAction).not.toHaveBeenCalled();
  });

  it("rejects requests when the Convex report secret is not configured", async () => {
    vi.stubEnv("VERCEL_ANALYTICS_DRAIN_SECRET", "secret");
    const body = "[]";
    const { POST } = await import("./route");
    const response = await POST(await makeRequest(body, await signBody(body, "secret")));

    expect(response.status).toBe(500);
    expect(mocks.fetchAction).not.toHaveBeenCalled();
  });

  it("rejects missing or invalid signatures", async () => {
    vi.stubEnv("VERCEL_ANALYTICS_DRAIN_SECRET", "secret");
    vi.stubEnv("ANALYTICS_REPORT_SECRET", "report-secret");
    const { POST } = await import("./route");
    const invalidResponse = await POST(await makeRequest("[]", "sha1=bad"));
    const missingResponse = await POST(await makeRequest("[]"));

    expect(invalidResponse.status).toBe(403);
    expect(missingResponse.status).toBe(403);
    expect(mocks.fetchAction).not.toHaveBeenCalled();
  });

  it("accepts signed NDJSON payloads and stores compact rollups", async () => {
    vi.stubEnv("VERCEL_ANALYTICS_DRAIN_SECRET", "secret");
    vi.stubEnv("ANALYTICS_REPORT_SECRET", "report-secret");
    mocks.fetchAction.mockResolvedValue({
      duplicate: false,
      inserted: 1,
      updated: 0,
      upserted: 1,
    });
    const { POST } = await import("./route");
    const body = [
      {
        eventType: "custom",
        eventName: "Audio Startup",
        eventData: JSON.stringify({ provider: "edge", sessionId: "drop-me" }),
        path: "/article/Fangorn?token=secret",
        timestamp: 1_767_873_600_000,
        sessionId: "drop-session",
        deviceId: "drop-device",
      },
      {
        eventType: "custom",
        eventName: "Audio Startup",
        eventData: JSON.stringify({ provider: "edge", sessionId: "drop-me" }),
        path: "/article/Fangorn?token=secret",
        timestamp: 1_767_873_600_000,
        sessionId: "drop-session",
        deviceId: "drop-device",
      },
    ]
      .map((event) => JSON.stringify(event))
      .join("\n");

    const response = await POST(await makeRequest(body, await signBody(body, "secret")));
    const json = await response.json();

    expect(response.status).toBe(200);
    expect(json).toMatchObject({ accepted: 2, rollups: 1, duplicate: false });
    expect(mocks.fetchAction).toHaveBeenCalledWith(
      "analyticsRollups:ingestAnalyticsRollups",
      {
        adminSecret: "report-secret",
        deliveryKey: expect.any(String),
        deliveryExpiresAt: expect.any(Number),
        rollups: [
          expect.objectContaining({
            path: "/article/Fangorn",
            count: 2,
            dimensionsJson: '{"provider":"edge"}',
          }),
        ],
      },
    );
  });

  it("reports duplicate deliveries without inserting again", async () => {
    vi.stubEnv("VERCEL_ANALYTICS_DRAIN_SECRET", "secret");
    vi.stubEnv("ANALYTICS_REPORT_SECRET", "report-secret");
    mocks.fetchAction.mockResolvedValue({ duplicate: true, inserted: 0, updated: 0, upserted: 0 });
    const { POST } = await import("./route");
    const body = JSON.stringify([
      {
        eventType: "pageview",
        path: "/",
        timestamp: 1_767_873_600_000,
      },
    ]);

    const response = await POST(await makeRequest(body, await signBody(body, "secret")));
    const json = await response.json();

    expect(response.status).toBe(200);
    expect(json).toMatchObject({ duplicate: true });
  });

  it("accepts signed JSON-array payloads", async () => {
    vi.stubEnv("VERCEL_ANALYTICS_DRAIN_SECRET", "secret");
    vi.stubEnv("ANALYTICS_REPORT_SECRET", "report-secret");
    mocks.fetchAction.mockResolvedValue({
      duplicate: false,
      inserted: 1,
      updated: 0,
      upserted: 1,
    });
    const { POST } = await import("./route");
    const body = JSON.stringify([
      {
        eventType: "pageview",
        path: "/",
        timestamp: 1_767_873_600_000,
      },
    ]);

    const response = await POST(await makeRequest(body, await signBody(body, "secret")));

    expect(response.status).toBe(200);
    expect(mocks.fetchAction).toHaveBeenCalledOnce();
  });
});
