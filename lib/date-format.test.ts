import { afterEach, describe, expect, it, vi } from "vitest";
import { formatLocalDateTime, formatUtcCalendarDate } from "./date-format";

afterEach(() => {
  vi.restoreAllMocks();
});

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

describe("formatLocalDateTime", () => {
  it("formats an instant in the listener's locale and timezone", () => {
    const formatter = vi
      .spyOn(Date.prototype, "toLocaleString")
      .mockReturnValue("Jul 12, 2026, 7:34 AM");

    expect(
      formatLocalDateTime("2026-07-12T12:34:00Z", "en-US"),
    ).toBe("Jul 12, 2026, 7:34 AM");
    expect(formatter).toHaveBeenCalledWith("en-US", {
      month: "short",
      day: "numeric",
      year: "numeric",
      hour: "numeric",
      minute: "2-digit",
    });
  });

  it.each([null, undefined, "not-a-date"])(
    "returns an empty label for %s",
    (value) => {
      expect(formatLocalDateTime(value, "en-US")).toBe("");
    },
  );
});
