import { describe, expect, it } from "vitest";
import {
  buildLogRanges,
  parseVercelLogLines,
  redactPath,
  renderAccessibleReport,
  summarizeLogs,
} from "./site-analytics-report.mjs";

describe("site analytics report helpers", () => {
  it("redacts query strings and auth-like values from paths", () => {
    expect(redactPath("/api/podcast/personal.xml?token=super-secret")).toBe(
      "/api/podcast/personal.xml",
    );
    expect(redactPath("/article/Bilbo_Baggins?utm_source=linkedin")).toBe(
      "/article/Bilbo_Baggins",
    );
  });

  it("parses Vercel JSON logs while ignoring CLI status lines", () => {
    const lines = [
      "Retrieving project...",
      JSON.stringify({
        id: "log-1",
        requestPath: "/article/Rivendell?utm_source=linkedin",
        statusCode: 200,
        cache: "HIT",
        source: "lambda",
        domain: "curiogarden.com",
        deploymentId: "dpl_123",
      }),
      JSON.stringify({
        id: "log-2",
        requestPath: "/api/tts",
        statusCode: 200,
        cache: "MISS",
        source: "lambda",
        message:
          '[/api/tts] route {"provider":"edge","requestedProvider":"openai","fallback":true,"fallbackReason":"openai_quota","status":"success","statusCode":200,"quotaMode":"public","quotaExceeded":true,"wordCount":"150-399","duration":"5-14.9s"}',
      }),
      "Fetching logs...",
    ].join("\n");

    const logs = parseVercelLogLines(lines);
    const summary = summarizeLogs(logs);

    expect(logs).toHaveLength(2);
    expect(summary.totalRequests).toBe(2);
    expect(summary.cacheBuckets).toEqual({ HIT: 1, MISS: 1 });
    expect(summary.topRoutes).toContainEqual({
      path: "/article/Rivendell",
      count: 1,
    });
    expect(summary.tts.providerMix).toEqual({ edge: 1 });
    expect(summary.tts.fallbackReasons).toEqual({ openai_quota: 1 });
    expect(summary.tts.quotaExceededCount).toBe(1);
  });

  it("extracts short notable error summaries without raw stack traces", () => {
    const summary = summarizeLogs([
      {
        id: "err-1",
        requestPath: "/api/search?q=secret",
        statusCode: 500,
        message:
          "Error: upstream failed with token=very-secret\n    at handler (/var/task/app.js:10:3)",
      },
    ]);

    expect(summary.notableErrors[0]).toMatchObject({
      path: "/api/search",
      statusCode: 500,
    });
    expect(summary.notableErrors[0].message).toBe(
      "Error: upstream failed with token=[redacted]",
    );
  });

  it("renders screen-reader-friendly Markdown without tables", () => {
    const summary = summarizeLogs([
      {
        id: "log-1",
        requestPath: "/",
        statusCode: 200,
        cache: "HIT",
        source: "static",
      },
    ]);

    const report = renderAccessibleReport({
      generatedAt: new Date("2026-05-10T12:00:00.000Z"),
      since: new Date("2026-05-09T12:00:00.000Z"),
      until: new Date("2026-05-10T12:00:00.000Z"),
      environment: "production",
      summary,
      drain: { included: false, reason: "No report secret was configured." },
    });

    expect(report).toContain("# Curio Garden Analytics Report");
    expect(report).toContain("## Data Availability");
    expect(report).toContain("Vercel Analytics Drain data was not included");
    expect(report).not.toContain("|");
  });

  it("builds hourly Vercel log ranges", () => {
    const ranges = buildLogRanges(
      new Date("2026-05-10T00:00:00.000Z").getTime(),
      new Date("2026-05-10T02:30:00.000Z").getTime(),
      60 * 60 * 1000,
    );

    expect(ranges).toEqual([
      {
        since: new Date("2026-05-10T00:00:00.000Z"),
        until: new Date("2026-05-10T01:00:00.000Z"),
      },
      {
        since: new Date("2026-05-10T01:00:00.000Z"),
        until: new Date("2026-05-10T02:00:00.000Z"),
      },
      {
        since: new Date("2026-05-10T02:00:00.000Z"),
        until: new Date("2026-05-10T02:30:00.000Z"),
      },
    ]);
  });
});
