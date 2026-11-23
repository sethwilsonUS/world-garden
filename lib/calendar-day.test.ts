import { describe, expect, it } from "vitest";
import {
  ALL_CALENDAR_DAYS,
  DAYS_IN_MONTH,
  calendarDayFromLocalDate,
  calendarDayFromUtcDate,
  calendarDayIndex,
  calendarDayKey,
  calendarDaySlug,
  formatCalendarDay,
  isCanonicalCalendarDaySlug,
  isSameCalendarDay,
  isValidCalendarDay,
  nextCalendarDay,
  onThisDayPath,
  parseCalendarDayKey,
  parseCalendarDaySlug,
  parseLegacyFeedDateToCalendarDay,
  previousCalendarDay,
  wikipediaCalendarUrl,
} from "./calendar-day";

describe("calendar-day", () => {
  it("contains all 366 calendar days in order, including February 29", () => {
    expect(ALL_CALENDAR_DAYS).toHaveLength(366);
    expect(DAYS_IN_MONTH[1]).toBe(29);
    expect(ALL_CALENDAR_DAYS[0]).toEqual({ month: 1, day: 1 });
    expect(ALL_CALENDAR_DAYS[59]).toEqual({ month: 2, day: 29 });
    expect(ALL_CALENDAR_DAYS[365]).toEqual({ month: 12, day: 31 });
  });

  it("round-trips slugs and keys for all 366 calendar days", () => {
    for (const [index, day] of ALL_CALENDAR_DAYS.entries()) {
      const slug = calendarDaySlug(day);
      const key = calendarDayKey(day);
      expect(parseCalendarDaySlug(slug)).toEqual(day);
      expect(isCanonicalCalendarDaySlug(slug, day)).toBe(true);
      expect(parseCalendarDayKey(key)).toEqual(day);
      expect(calendarDayIndex(day)).toBe(index);
      expect(onThisDayPath(day)).toBe(`/on-this-day/${slug}`);
    }
  });

  it("accepts non-canonical slugs and rejects invalid calendar dates", () => {
    expect(parseCalendarDaySlug("03-05")).toEqual({ month: 3, day: 5 });
    expect(isCanonicalCalendarDaySlug("03-05", { month: 3, day: 5 })).toBe(
      false,
    );
    expect(parseCalendarDaySlug("March-05")).toEqual({ month: 3, day: 5 });
    expect(parseCalendarDaySlug("MARCH-5")).toEqual({ month: 3, day: 5 });
    expect(parseCalendarDaySlug("3-5")).toEqual({ month: 3, day: 5 });
    expect(parseCalendarDaySlug("february-29")).toEqual({ month: 2, day: 29 });

    expect(parseCalendarDaySlug("february-30")).toBeNull();
    expect(parseCalendarDaySlug("april-31")).toBeNull();
    expect(parseCalendarDaySlug("13-01")).toBeNull();
    expect(parseCalendarDaySlug("00-10")).toBeNull();
    expect(parseCalendarDaySlug("march-0")).toBeNull();
    expect(parseCalendarDaySlug("not-a-day")).toBeNull();
    expect(parseCalendarDaySlug("%E0%A4%A")).toBeNull();
    expect(parseCalendarDayKey("02-30")).toBeNull();
    expect(parseCalendarDayKey("3-5")).toBeNull();
    expect(isValidCalendarDay(2, 29)).toBe(true);
    expect(isValidCalendarDay(2, 30)).toBe(false);
  });

  it("walks a fixed 366-day ring across year and leap-day boundaries", () => {
    expect(nextCalendarDay({ month: 12, day: 31 })).toEqual({
      month: 1,
      day: 1,
    });
    expect(previousCalendarDay({ month: 1, day: 1 })).toEqual({
      month: 12,
      day: 31,
    });
    expect(nextCalendarDay({ month: 2, day: 28 })).toEqual({
      month: 2,
      day: 29,
    });
    expect(nextCalendarDay({ month: 2, day: 29 })).toEqual({
      month: 3,
      day: 1,
    });
    expect(previousCalendarDay({ month: 3, day: 1 })).toEqual({
      month: 2,
      day: 29,
    });
    expect(previousCalendarDay({ month: 2, day: 29 })).toEqual({
      month: 2,
      day: 28,
    });
  });

  it("parses legacy YYYY-MM-DD feed dates accurately", () => {
    expect(parseLegacyFeedDateToCalendarDay("2026-07-30")).toEqual({
      month: 7,
      day: 30,
    });
    expect(parseLegacyFeedDateToCalendarDay("2024-02-29")).toEqual({
      month: 2,
      day: 29,
    });
    expect(parseLegacyFeedDateToCalendarDay("2026-02-29")).toBeNull();
    expect(parseLegacyFeedDateToCalendarDay("invalid")).toBeNull();
  });

  it("derives UTC and local calendar days without conflating them", () => {
    const instant = new Date("2026-11-24T01:30:00Z");
    expect(calendarDayFromUtcDate(instant)).toEqual({ month: 11, day: 24 });
    expect(calendarDayFromLocalDate(instant)).toEqual({
      month: instant.getMonth() + 1,
      day: instant.getDate(),
    });
    expect(
      isSameCalendarDay({ month: 3, day: 5 }, { month: 3, day: 5 }),
    ).toBe(true);
    expect(
      isSameCalendarDay({ month: 3, day: 5 }, { month: 3, day: 6 }),
    ).toBe(false);
  });

  it("formats display labels and Wikipedia calendar URLs in UTC", () => {
    expect(formatCalendarDay({ month: 3, day: 5 })).toBe("March 5");
    expect(formatCalendarDay({ month: 2, day: 29 })).toBe("February 29");
    expect(wikipediaCalendarUrl({ month: 3, day: 5 })).toBe(
      "https://en.wikipedia.org/wiki/March_5",
    );
    expect(wikipediaCalendarUrl({ month: 2, day: 29 })).toBe(
      "https://en.wikipedia.org/wiki/February_29",
    );
  });
});
