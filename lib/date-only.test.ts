import { describe, expect, it } from "vitest";
import { formatUtcCalendarDate } from "./date-only";

describe("formatUtcCalendarDate", () => {
  it.each([
    "2026-07-12",
    "2026-07-12Z",
    "2026-07-12T00:00:00Z",
  ])("keeps the calendar day for %s", (value) => {
    expect(formatUtcCalendarDate(value, "en-US")).toBe("Jul 12, 2026");
  });

  it.each([
    null,
    undefined,
    "not-a-date",
    "2026-02-31",
    "2026-13-01Z",
  ])(
    "returns an empty label for %s",
    (value) => {
      expect(formatUtcCalendarDate(value, "en-US")).toBe("");
    },
  );
});
