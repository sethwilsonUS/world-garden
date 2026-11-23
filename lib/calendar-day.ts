export type CalendarDay = {
  readonly month: number;
  readonly day: number;
};

export const MONTH_NAMES = [
  "January",
  "February",
  "March",
  "April",
  "May",
  "June",
  "July",
  "August",
  "September",
  "October",
  "November",
  "December",
] as const;

export const MONTH_SLUGS = [
  "january",
  "february",
  "march",
  "april",
  "may",
  "june",
  "july",
  "august",
  "september",
  "october",
  "november",
  "december",
] as const;

/** Fixed leap-year month lengths so February 29 is always reachable. */
export const DAYS_IN_MONTH = [
  31, 29, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31,
] as const;

const MONTH_INDEX_BY_SLUG = new Map<string, number>(
  MONTH_SLUGS.map((slug, index) => [slug, index + 1]),
);

const LEAP_REFERENCE_YEAR = 2000;

export const isValidCalendarDay = (month: number, day: number): boolean => {
  if (!Number.isInteger(month) || !Number.isInteger(day)) return false;
  if (month < 1 || month > 12) return false;
  const maxDay = DAYS_IN_MONTH[month - 1];
  return maxDay !== undefined && day >= 1 && day <= maxDay;
};

export const ALL_CALENDAR_DAYS: readonly CalendarDay[] = Object.freeze(
  DAYS_IN_MONTH.flatMap((maxDay, monthIndex) =>
    Array.from({ length: maxDay }, (_, dayIndex) =>
      Object.freeze({ month: monthIndex + 1, day: dayIndex + 1 }),
    ),
  ),
);

const INDEX_BY_KEY = new Map<string, number>(
  ALL_CALENDAR_DAYS.map((entry, index) => [
    `${String(entry.month).padStart(2, "0")}-${String(entry.day).padStart(2, "0")}`,
    index,
  ]),
);

const assertValidCalendarDay = (day: CalendarDay): void => {
  if (!isValidCalendarDay(day.month, day.day)) {
    throw new RangeError(
      `Invalid Calendar Day: month=${day.month}, day=${day.day}`,
    );
  }
};

export const isSameCalendarDay = (
  left: CalendarDay,
  right: CalendarDay,
): boolean => left.month === right.month && left.day === right.day;

export const calendarDayKey = (day: CalendarDay): string => {
  assertValidCalendarDay(day);
  return `${String(day.month).padStart(2, "0")}-${String(day.day).padStart(2, "0")}`;
};

export const parseCalendarDayKey = (value: string): CalendarDay | null => {
  const match = value.trim().match(/^(\d{2})-(\d{2})$/u);
  if (!match) return null;
  const month = Number(match[1]);
  const day = Number(match[2]);
  return isValidCalendarDay(month, day) ? { month, day } : null;
};

export const calendarDaySlug = (day: CalendarDay): string => {
  assertValidCalendarDay(day);
  return `${MONTH_SLUGS[day.month - 1]}-${day.day}`;
};

export const onThisDayPath = (day: CalendarDay): string =>
  `/on-this-day/${calendarDaySlug(day)}`;

export const isCanonicalCalendarDaySlug = (
  raw: string,
  day: CalendarDay,
): boolean => raw === calendarDaySlug(day);

export const parseCalendarDaySlug = (raw: string): CalendarDay | null => {
  let decoded = raw;
  try {
    decoded = decodeURIComponent(raw);
  } catch (error) {
    if (error instanceof URIError) return null;
    throw error;
  }

  const trimmed = decoded.trim().toLowerCase();
  if (!trimmed) return null;

  const namedMatch = trimmed.match(/^([a-z]+)-(\d{1,2})$/u);
  if (namedMatch) {
    const month = MONTH_INDEX_BY_SLUG.get(namedMatch[1]);
    const day = Number(namedMatch[2]);
    return month && isValidCalendarDay(month, day) ? { month, day } : null;
  }

  const numericMatch = trimmed.match(/^(\d{1,2})-(\d{1,2})$/u);
  if (numericMatch) {
    const month = Number(numericMatch[1]);
    const day = Number(numericMatch[2]);
    return isValidCalendarDay(month, day) ? { month, day } : null;
  }

  return null;
};

export const parseLegacyFeedDateToCalendarDay = (
  value: string,
): CalendarDay | null => {
  const match = value.trim().match(/^(\d{4})-(\d{2})-(\d{2})$/u);
  if (!match) return null;
  const year = Number(match[1]);
  const month = Number(match[2]);
  const day = Number(match[3]);
  const parsed = new Date(Date.UTC(year, month - 1, day));
  if (
    Number.isNaN(parsed.getTime()) ||
    parsed.getUTCFullYear() !== year ||
    parsed.getUTCMonth() + 1 !== month ||
    parsed.getUTCDate() !== day
  ) {
    return null;
  }
  return { month, day };
};

export const calendarDayIndex = (day: CalendarDay): number => {
  const index = INDEX_BY_KEY.get(calendarDayKey(day));
  if (index === undefined) {
    throw new RangeError(
      `Invalid Calendar Day: month=${day.month}, day=${day.day}`,
    );
  }
  return index;
};

export const nextCalendarDay = (day: CalendarDay): CalendarDay => {
  const index = calendarDayIndex(day);
  return ALL_CALENDAR_DAYS[(index + 1) % ALL_CALENDAR_DAYS.length];
};

export const previousCalendarDay = (day: CalendarDay): CalendarDay => {
  const index = calendarDayIndex(day);
  return ALL_CALENDAR_DAYS[
    (index - 1 + ALL_CALENDAR_DAYS.length) % ALL_CALENDAR_DAYS.length
  ];
};

export const calendarDayFromLocalDate = (date = new Date()): CalendarDay => ({
  month: date.getMonth() + 1,
  day: date.getDate(),
});

export const calendarDayFromUtcDate = (date = new Date()): CalendarDay => ({
  month: date.getUTCMonth() + 1,
  day: date.getUTCDate(),
});

export const formatCalendarDay = (
  day: CalendarDay,
  locales: string | string[] = "en-US",
): string => {
  assertValidCalendarDay(day);
  const reference = new Date(
    Date.UTC(LEAP_REFERENCE_YEAR, day.month - 1, day.day),
  );
  return reference.toLocaleDateString(locales, {
    month: "long",
    day: "numeric",
    timeZone: "UTC",
  });
};

export const wikipediaCalendarUrl = (day: CalendarDay): string => {
  assertValidCalendarDay(day);
  return `https://en.wikipedia.org/wiki/${MONTH_NAMES[day.month - 1]}_${day.day}`;
};

export const formatUtcDateIso = (date = new Date()): string =>
  `${date.getUTCFullYear()}-${String(date.getUTCMonth() + 1).padStart(2, "0")}-${String(date.getUTCDate()).padStart(2, "0")}`;
