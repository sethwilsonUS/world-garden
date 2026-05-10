import { describe, expect, it } from "vitest";
import {
  buildAnalyticsRollups,
  parseVercelAnalyticsDrainPayload,
  verifyVercelDrainSignature,
} from "./vercel-analytics-drain";

const payloadEvent = (overrides: Record<string, unknown> = {}) => ({
  schema: "vercel.analytics.v2",
  eventType: "custom",
  eventName: "Audio Startup",
  eventData: JSON.stringify({
    scope: "summary",
    path: "generated",
    provider: "openai",
    sessionId: "drop-me",
  }),
  path: "/article/Lothlorien?utm_source=linkedin",
  timestamp: 1_767_873_600_000,
  sessionId: "drop-session",
  deviceId: "drop-device",
  ...overrides,
});

describe("Vercel Analytics Drain helpers", () => {
  it("verifies HMAC-SHA1 signatures", () => {
    const body = JSON.stringify([payloadEvent()]);
    const secret = "drain-secret";

    const signature = `sha1=${verifyVercelDrainSignature.sign(body, secret)}`;

    expect(verifyVercelDrainSignature(body, signature, secret)).toBe(true);
    expect(verifyVercelDrainSignature(body, "sha1=bad", secret)).toBe(false);
  });

  it("parses NDJSON and JSON-array payloads", () => {
    const ndjson = [payloadEvent(), payloadEvent({ eventName: "Page View" })]
      .map((event) => JSON.stringify(event))
      .join("\n");

    expect(parseVercelAnalyticsDrainPayload(ndjson)).toHaveLength(2);
    expect(
      parseVercelAnalyticsDrainPayload(JSON.stringify([payloadEvent()])),
    ).toHaveLength(1);
  });

  it("drops session and device identifiers before building rollups", () => {
    const events = parseVercelAnalyticsDrainPayload(
      JSON.stringify([payloadEvent(), payloadEvent()]),
    );
    const rollups = buildAnalyticsRollups(events);

    expect(rollups).toHaveLength(1);
    expect(rollups[0]).toMatchObject({
      bucketStart: 1_767_873_600_000,
      source: "vercel_analytics_drain",
      eventType: "custom",
      eventName: "Audio Startup",
      path: "/article/Lothlorien",
      count: 2,
    });
    expect(rollups[0].dimensionsJson).toContain('"provider":"openai"');
    expect(rollups[0].dimensionsJson).not.toContain("session");
    expect(rollups[0].dimensionsJson).not.toContain("device");
  });
});
