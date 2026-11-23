import { describe, expect, it } from "vitest";
import { calendarDayFromUtcDate, calendarDayKey } from "./calendar-day";
import { ON_THIS_DAY_CATEGORIES } from "./on-this-day-contracts";
import { wikipediaRestOnThisDayProvider } from "./on-this-day";

const runLive = process.env.WIKIMEDIA_ON_THIS_DAY_LIVE_TEST === "1";

const FIXED_SAMPLE_DAYS = ["01-01", "02-29", "07-04", "12-31"] as const;

describe.runIf(runLive)("live Wikipedia On This Day contract", () => {
  const todayKey = calendarDayKey(calendarDayFromUtcDate());
  const sampleDays = Array.from(new Set([...FIXED_SAMPLE_DAYS, todayKey]));

  for (const monthDay of sampleDays) {
    it(`returns valid categories and item shapes for ${monthDay}`, async () => {
      const [month, day] = monthDay.split("-");
      const payload = await wikipediaRestOnThisDayProvider.fetchAll({
        month,
        day,
      });

      for (const category of ON_THIS_DAY_CATEGORIES) {
        const events = payload[category];
        expect(
          Array.isArray(events),
          `${monthDay} ${category} was not an array`,
        ).toBe(true);

        for (const entry of (events ?? []).slice(0, 5)) {
          expect(typeof entry).toBe("object");
          expect(entry).not.toBeNull();
          const record = entry as Record<string, unknown>;
          expect(typeof record.text).toBe("string");
          expect(Array.isArray(record.pages)).toBe(true);
          if (category !== "holidays") {
            expect(typeof record.year).toBe("number");
          }
        }
      }

      expect(payload.selected?.length).toBeGreaterThan(0);
    }, 30_000);
  }
});
