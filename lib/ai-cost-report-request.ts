import { createHash, timingSafeEqual } from "node:crypto";

const DAY_MS = 24 * 60 * 60 * 1000;
const MAX_REPORT_DAYS = 90;
const UTC_DAY_PATTERN = /^\d{4}-\d{2}-\d{2}$/;

export type AiCostReportRange = {
  fromDay: string;
  fromMs: number;
  toDay: string;
  toMs: number;
};

export type AiCostReportRangeError = { error: string };

const digest = (value: string): Buffer =>
  createHash("sha256").update(value, "utf8").digest();

export const isAuthorizedAiCostOwnerRequest = (
  authorization: string | null,
  secret: string,
): boolean => {
  const expected = `Bearer ${secret}`;
  const received = authorization ?? "";
  return timingSafeEqual(digest(received), digest(expected));
};

const parseUtcDay = (value: string | null): number | null => {
  if (!value || !UTC_DAY_PATTERN.test(value)) return null;
  const timestamp = Date.parse(`${value}T00:00:00.000Z`);
  if (!Number.isFinite(timestamp)) return null;
  return new Date(timestamp).toISOString().slice(0, 10) === value
    ? timestamp
    : null;
};

export const parseAiCostReportRange = (
  url: URL,
): AiCostReportRange | AiCostReportRangeError => {
  const fromDay = url.searchParams.get("from");
  const toDay = url.searchParams.get("to");
  const fromMs = parseUtcDay(fromDay);
  const toMs = parseUtcDay(toDay);

  if (fromMs === null || toMs === null || !fromDay || !toDay) {
    return {
      error: "from and to must be exact UTC dates in YYYY-MM-DD format",
    };
  }
  if (toMs <= fromMs) {
    return { error: "from must be before to" };
  }
  if (toMs - fromMs > MAX_REPORT_DAYS * DAY_MS) {
    return { error: "AI cost reports are limited to 90 days" };
  }

  return { fromDay, fromMs, toDay, toMs };
};
