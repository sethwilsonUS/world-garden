import { describe, expect, it, vi } from "vitest";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import {
  buildLogRanges,
  collectVercelLogs,
  fetchDrainData,
  loadLocalEnvFile,
  parseArgs,
  parseVercelLogLines,
  redactPath,
  renderAccessibleReport,
  summarizeLogs,
  warnIfLogLimitReached,
} from "./site-analytics-report.mjs";

describe("site analytics report helpers", () => {
  it("recovers capped windows by splitting them until all returned logs fit", async () => {
    const since = new Date("2026-09-17T19:00:00.000Z");
    const until = new Date("2026-09-17T20:00:00.000Z");
    const records = Array.from({ length: 125 }, (_, index) => ({
      id: `request-${index}`,
      timestamp: since.getTime() + index * 20000,
      requestPath: "/",
      statusCode: 200,
    }));
    const result = await collectVercelLogs({
      since,
      until,
      fetchRange: async (range) => records.filter(
        (log) => log.timestamp >= range.since.getTime()
          && log.timestamp < range.until.getTime(),
      ).slice(0, 50),
      progress: vi.fn(),
    });

    expect(result.logs).toEqual(records);
    expect(result.coverage).toMatchObject({
      status: "complete",
      splitCount: 2,
      queryCount: 5,
      limitedRanges: [],
    });
  });

  it("persists unresolved caps in JSON and Markdown without discarding the sample", async () => {
    const since = new Date("2026-09-17T19:00:00.000Z");
    const until = new Date("2026-09-17T19:00:01.000Z");
    const records = Array.from({ length: 50 }, (_, index) => ({ id: String(index) }));
    const { logs, coverage } = await collectVercelLogs({
      since, until,
      fetchRange: async () => records,
      progress: vi.fn(),
    });
    expect(logs).toEqual(records);
    expect(JSON.parse(JSON.stringify(coverage))).toEqual({
      status: "incomplete", queryCount: 1, splitCount: 0,
      limitedRanges: [{
        since: since.toISOString(), until: until.toISOString(),
        reason: "minimum_window", entryCount: 50,
      }],
    });
    const report = renderAccessibleReport({
      generatedAt: until, since, until, environment: "production",
      summary: summarizeLogs(logs), logCoverage: coverage,
    });
    expect(report).toContain("WARNING: This report may be incomplete.");
    expect(report).toContain(`${since.toISOString()} through ${until.toISOString()}`);
    expect(report.indexOf("## Log Coverage")).toBeLessThan(report.indexOf("## Plain-English Summary"));
  });

  it("bounds automatic retries and still collects later hourly windows", async () => {
    const records = Array.from({ length: 50 }, (_, index) => ({ id: String(index) }));
    const result = await collectVercelLogs({
      since: new Date("2026-09-17T19:00:00.000Z"),
      until: new Date("2026-09-17T21:00:00.000Z"),
      fetchRange: async (range) => range.since.getUTCHours() === 19
        ? records : [{ id: "later-request" }],
      maxSplits: 1,
      progress: vi.fn(),
    });
    expect(result.coverage).toMatchObject({ status: "incomplete", queryCount: 4, splitCount: 1 });
    expect(result.coverage.limitedRanges).toHaveLength(2);
    expect(result.coverage.limitedRanges.every((range) => range.reason === "split_limit")).toBe(true);
    expect(result.logs).toContainEqual({ id: "later-request" });
  });

  it("counts requests once when split boundaries return overlapping IDs", async () => {
    const since = new Date("2026-09-17T19:00:00.000Z");
    const until = new Date("2026-09-17T20:00:00.000Z");
    const records = Array.from({ length: 75 }, (_, index) => ({
      id: String(index), timestamp: since.getTime() + index * 40000,
      requestPath: "/", statusCode: 200,
    }));
    const { logs, coverage } = await collectVercelLogs({
      since, until, progress: vi.fn(),
      fetchRange: async (range) => records.filter((log) =>
        log.timestamp >= range.since.getTime() && log.timestamp <= range.until.getTime(),
      ).slice(0, 50),
    });
    expect(coverage.status).toBe("complete");
    expect(logs).toHaveLength(76);
    expect(summarizeLogs(logs).totalRequests).toBe(75);
  });

  it("does not silently treat a failed child query as complete coverage", async () => {
    const records = Array.from({ length: 50 }, (_, index) => ({ id: String(index) }));
    const fetchRange = vi.fn().mockResolvedValueOnce(records).mockRejectedValueOnce(new Error("CLI failed"));
    await expect(collectVercelLogs({
      since: new Date("2026-09-17T19:00:00.000Z"),
      until: new Date("2026-09-17T20:00:00.000Z"),
      fetchRange, progress: vi.fn(),
    })).rejects.toThrow("CLI failed");
  });

  it("counts Vercel event rollups as custom events", () => {
    const report = renderAccessibleReport({
      generatedAt: new Date("2026-09-18T12:00:00Z"),
      since: new Date("2026-09-17T12:00:00Z"),
      until: new Date("2026-09-18T12:00:00Z"),
      environment: "production", summary: summarizeLogs([]),
      drain: { included: true, rollups: [
        { eventType: "event", eventName: "audio_play", path: "/", count: 18 },
        { eventType: "pageview", path: "/", count: 4 },
      ] },
    });
    expect(report).toContain("22 rolled-up events");
    expect(report).toContain("Drain pageviews: 4.");
    expect(report).toContain("Drain custom events: 18.");
  });

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

  it("keeps server failures visible when missing routes fill the error display", () => {
    const summary = summarizeLogs([
      ...Array.from({ length: 13 }, (_, index) => ({
        id: `missing-${index}`, requestPath: `/missing-${index}`, statusCode: 404,
      })),
      {
        id: "timeout", requestPath: "/api/featured/audio-warm/cron", statusCode: 504,
        message: "Task timed out after 300 seconds",
      },
    ]);

    expect(summary.notableErrors).toHaveLength(12);
    expect(summary.notableErrors[0]).toMatchObject({
      path: "/api/featured/audio-warm/cron", statusCode: 504,
    });
    expect(summary.notableErrorCount).toBe(14);
    const report = renderAccessibleReport({
      generatedAt: new Date("2026-09-18T12:00:00Z"),
      since: new Date("2026-09-17T12:00:00Z"),
      until: new Date("2026-09-18T12:00:00Z"),
      environment: "production", summary,
    });
    expect(report).toContain("Showing 12 of 14 notable errors, with server errors listed first.");
    expect(report).toContain("/api/featured/audio-warm/cron: status 504; Task timed out after 300 seconds");
  });

  it("redacts JSON and object-style secrets from notable error summaries", () => {
    const jsonSummary = summarizeLogs([
      {
        id: "err-json",
        requestPath: "/api/report",
        statusCode: 500,
        message: JSON.stringify({
          message: "failed",
          sessionId: "session-secret",
          nested: { apiKey: "api-secret" },
        }),
      },
    ]);
    const objectSummary = summarizeLogs([
      {
        id: "err-object",
        requestPath: "/api/report",
        statusCode: 500,
        message: 'Error: failed apiKey: "api-secret" sessionId: "session-secret"',
      },
    ]);

    expect(jsonSummary.notableErrors[0].message).toContain(
      '"sessionId":"[redacted]"',
    );
    expect(jsonSummary.notableErrors[0].message).toContain(
      '"apiKey":"[redacted]"',
    );
    expect(jsonSummary.notableErrors[0].message).not.toContain("session-secret");
    expect(jsonSummary.notableErrors[0].message).not.toContain("api-secret");
    expect(objectSummary.notableErrors[0].message).toContain(
      'apiKey: "[redacted]"',
    );
    expect(objectSummary.notableErrors[0].message).toContain(
      'sessionId: "[redacted]"',
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

  it("rejects flags that are missing values", () => {
    expect(() => parseArgs(["--output", "--json"])).toThrow(
      "--output requires a value.",
    );
    expect(() => parseArgs(["--hours"])).toThrow(
      "--hours requires a value.",
    );
  });

  it("treats drain fetch URL failures as optional data unavailability", async () => {
    const previousReportSecret = process.env.ANALYTICS_REPORT_SECRET;
    const previousSiteUrl = process.env.NEXT_PUBLIC_SITE_URL;

    try {
      process.env.ANALYTICS_REPORT_SECRET = "report-secret";
      process.env.NEXT_PUBLIC_SITE_URL = "not a url";

      const drain = await fetchDrainData({
        since: new Date("2026-05-10T00:00:00.000Z"),
        until: new Date("2026-05-10T01:00:00.000Z"),
        includeDrain: true,
      });

      expect(drain).toMatchObject({ included: false });
      expect(drain.reason).toMatch(/Invalid URL/);
    } finally {
      if (previousReportSecret == null) {
        delete process.env.ANALYTICS_REPORT_SECRET;
      } else {
        process.env.ANALYTICS_REPORT_SECRET = previousReportSecret;
      }
      if (previousSiteUrl == null) {
        delete process.env.NEXT_PUBLIC_SITE_URL;
      } else {
        process.env.NEXT_PUBLIC_SITE_URL = previousSiteUrl;
      }
    }
  });

  it("warns when a Vercel log chunk reaches the CLI result limit", () => {
    const warn = vi.fn();
    const range = {
      since: new Date("2026-05-10T00:00:00.000Z"),
      until: new Date("2026-05-10T01:00:00.000Z"),
    };
    const logs = Array.from({ length: 50 }, (_, index) => ({ id: String(index) }));

    expect(warnIfLogLimitReached(logs, range, warn)).toBe(true);
    expect(warn).toHaveBeenCalledWith(expect.stringContaining("50 entry limit"));
    expect(warn).toHaveBeenCalledWith(
      expect.stringContaining("2026-05-10T00:00:00.000Z"),
    );
  });

  it("loads .env.local without overriding already-exported values", async () => {
    const dir = await mkdtemp(path.join(os.tmpdir(), "curio-env-"));
    const previousReportSecret = process.env.ANALYTICS_REPORT_SECRET;
    const previousProject = process.env.VERCEL_PROJECT;

    try {
      process.env.ANALYTICS_REPORT_SECRET = "from-shell";
      delete process.env.VERCEL_PROJECT;
      await writeFile(
        path.join(dir, ".env.local"),
        [
          "ANALYTICS_REPORT_SECRET=from-file",
          'VERCEL_PROJECT="world-garden"',
          "",
        ].join("\n"),
      );

      await expect(loadLocalEnvFile(dir)).resolves.toBe(true);

      expect(process.env.ANALYTICS_REPORT_SECRET).toBe("from-shell");
      expect(process.env.VERCEL_PROJECT).toBe("world-garden");
    } finally {
      if (previousReportSecret == null) {
        delete process.env.ANALYTICS_REPORT_SECRET;
      } else {
        process.env.ANALYTICS_REPORT_SECRET = previousReportSecret;
      }
      if (previousProject == null) {
        delete process.env.VERCEL_PROJECT;
      } else {
        process.env.VERCEL_PROJECT = previousProject;
      }
      await rm(dir, { recursive: true, force: true });
    }
  });
});
