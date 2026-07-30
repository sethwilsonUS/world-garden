import { describe, expect, it } from "vitest";
import { ON_THIS_DAY_CATEGORIES } from "./on-this-day-contracts";
import { wikifeedsOnThisDayProvider } from "./on-this-day";

const runLive = process.env.WIKIMEDIA_ON_THIS_DAY_LIVE_TEST === "1";

describe.runIf(runLive)("live Wikimedia On This Day contract", () => {
  it("returns every supported category as an array", async () => {
    const now = new Date();
    const payload = await wikifeedsOnThisDayProvider.fetchAll({
      month: String(now.getUTCMonth() + 1).padStart(2, "0"),
      day: String(now.getUTCDate()).padStart(2, "0"),
    });

    for (const category of ON_THIS_DAY_CATEGORIES) {
      expect(Array.isArray(payload[category]), `${category} was not an array`).toBe(
        true,
      );
    }
    expect(payload.selected?.length).toBeGreaterThan(0);
  }, 30_000);
});
