const WIKIMEDIA_DATE_ONLY = /^(\d{4})-(\d{2})-(\d{2})Z?$/;

/**
 * Formats a calendar date without allowing the browser timezone to change its day.
 * Wikimedia may return YYYY-MM-DD or legacy YYYY-MM-DDZ, so date-only values are
 * expanded to a Safari-safe UTC timestamp before formatting.
 */
export const formatUtcCalendarDate = (
  value: string | null | undefined,
  locales?: string | string[],
): string => {
  if (!value) return "";

  try {
    const match = value.match(WIKIMEDIA_DATE_ONLY);
    const normalized = match
      ? `${match[1]}-${match[2]}-${match[3]}T00:00:00Z`
      : value;
    const date = new Date(normalized);
    if (Number.isNaN(date.getTime())) return "";
    if (
      match &&
      (date.getUTCFullYear() !== Number(match[1]) ||
        date.getUTCMonth() + 1 !== Number(match[2]) ||
        date.getUTCDate() !== Number(match[3]))
    ) {
      return "";
    }

    return date.toLocaleDateString(locales, {
      month: "short",
      day: "numeric",
      year: "numeric",
      timeZone: "UTC",
    });
  } catch {
    return "";
  }
};
