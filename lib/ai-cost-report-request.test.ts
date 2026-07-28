import { describe, expect, it } from "vitest";
import {
  isAuthorizedAiCostOwnerRequest,
  parseAiCostReportRange,
} from "./ai-cost-report-request";

describe("AI cost owner report requests", () => {
  it("compares the bearer secret without accepting malformed or partial values", () => {
    const secret = "owner-report-secret";

    expect(isAuthorizedAiCostOwnerRequest(`Bearer ${secret}`, secret)).toBe(
      true,
    );
    expect(isAuthorizedAiCostOwnerRequest(`Bearer ${secret}x`, secret)).toBe(
      false,
    );
    expect(isAuthorizedAiCostOwnerRequest(secret, secret)).toBe(false);
    expect(isAuthorizedAiCostOwnerRequest(null, secret)).toBe(false);
    expect(isAuthorizedAiCostOwnerRequest("Bearer ", secret)).toBe(false);
  });

  it("parses an exact half-open UTC date range", () => {
    expect(
      parseAiCostReportRange(
        new URL(
          "https://example.test/api/analytics/costs?from=2026-07-01&to=2026-07-31",
        ),
      ),
    ).toEqual({
      fromDay: "2026-07-01",
      fromMs: Date.UTC(2026, 6, 1),
      toDay: "2026-07-31",
      toMs: Date.UTC(2026, 6, 31),
    });
  });

  it.each([
    ["missing from", "?to=2026-07-31"],
    ["invalid calendar date", "?from=2026-02-29&to=2026-03-01"],
    ["timestamp instead of date", "?from=2026-07-01T00:00:00Z&to=2026-07-02"],
    ["reversed range", "?from=2026-07-02&to=2026-07-01"],
    ["empty range", "?from=2026-07-01&to=2026-07-01"],
    ["more than 90 days", "?from=2026-01-01&to=2026-04-02"],
  ])("rejects %s", (_label, query) => {
    const result = parseAiCostReportRange(
      new URL(`https://example.test/api/analytics/costs${query}`),
    );

    expect(result).toHaveProperty("error");
  });
});
