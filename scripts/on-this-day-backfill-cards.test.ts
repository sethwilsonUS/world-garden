import { describe, expect, it, vi } from "vitest";
import { ON_THIS_DAY_SHARE_CARD_VERSION } from "@/lib/on-this-day-share-card";
import {
  createPoliteWikimediaFetch,
  parseCliArgs,
  resolveTargetCalendarDays,
  shouldSkipStoredShareCard,
  waitAbortable,
} from "./on-this-day-backfill-cards";

describe("on-this-day-backfill-cards CLI target selection", () => {
  it("selects all 366 calendar days only when neither --evergreen nor --day is provided", () => {
    const bare = parseCliArgs([]);
    expect(resolveTargetCalendarDays(bare)).toHaveLength(366);
  });

  it("selects zero calendar days when --evergreen is passed without --day (even without --preview-only or with --force)", () => {
    const evergreenOnly = parseCliArgs(["--evergreen"]);
    expect(evergreenOnly.evergreen).toBe(true);
    expect(evergreenOnly.day).toBeNull();
    expect(resolveTargetCalendarDays(evergreenOnly)).toEqual([]);

    const evergreenForce = parseCliArgs(["--evergreen", "--force"]);
    expect(evergreenForce.evergreen).toBe(true);
    expect(evergreenForce.force).toBe(true);
    expect(resolveTargetCalendarDays(evergreenForce)).toEqual([]);
  });

  it("selects the single requested calendar day for --day with or without --evergreen", () => {
    const evergreenAndDay = parseCliArgs(["--evergreen", "--day", "10-18"]);
    expect(resolveTargetCalendarDays(evergreenAndDay)).toEqual([
      { month: 10, day: 18 },
    ]);

    const dayOnly = parseCliArgs(["--day=october-18"]);
    expect(resolveTargetCalendarDays(dayOnly)).toEqual([
      { month: 10, day: 18 },
    ]);
  });
});

describe("shouldSkipStoredShareCard", () => {
  it("skips only current-version cards with plates and an existing Convex storage blob", () => {
    expect(
      shouldSkipStoredShareCard(
        {
          version: ON_THIS_DAY_SHARE_CARD_VERSION,
          plateCount: 5,
          hasBlob: true,
        },
        false,
      ),
    ).toBe(true);

    expect(
      shouldSkipStoredShareCard(
        {
          version: ON_THIS_DAY_SHARE_CARD_VERSION,
          plateCount: 5,
          hasBlob: false,
        },
        false,
      ),
    ).toBe(false);

    expect(
      shouldSkipStoredShareCard(
        {
          version: ON_THIS_DAY_SHARE_CARD_VERSION - 1,
          plateCount: 5,
          hasBlob: true,
        },
        false,
      ),
    ).toBe(false);

    expect(
      shouldSkipStoredShareCard(
        {
          version: ON_THIS_DAY_SHARE_CARD_VERSION,
          plateCount: 0,
          hasBlob: true,
        },
        false,
      ),
    ).toBe(false);

    expect(
      shouldSkipStoredShareCard(
        {
          version: ON_THIS_DAY_SHARE_CARD_VERSION,
          plateCount: 5,
          hasBlob: true,
        },
        true,
      ),
    ).toBe(false);
  });
});

describe("waitAbortable and createPoliteWikimediaFetch", () => {
  it("aborts waitAbortable promptly when the signal fires", async () => {
    const controller = new AbortController();
    const pending = waitAbortable(30_000, controller.signal);
    const start = Date.now();
    controller.abort(new Error("cancelled"));

    await expect(pending).rejects.toThrow("cancelled");
    expect(Date.now() - start).toBeLessThan(500);
  });

  it("aborts immediately during 429 retry backoff without starting a second attempt", async () => {
    const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});
    const fetchMock = vi.fn<typeof fetch>().mockResolvedValue(
      new Response("rate limited", {
        status: 429,
        headers: { "retry-after": "30" },
      }),
    );

    const politeFetch = createPoliteWikimediaFetch({
      fetchImpl: fetchMock,
      minRequestIntervalMs: 0,
      maxRetries: 2,
    });

    const controller = new AbortController();
    const start = Date.now();
    const requestPromise = politeFetch(
      "https://upload.wikimedia.org/wikipedia/commons/a/ab/Test.jpg",
      { signal: controller.signal },
    );

    setTimeout(() => controller.abort(new Error("stop retries")), 30);

    try {
      await expect(requestPromise).rejects.toThrow("stop retries");
      expect(fetchMock).toHaveBeenCalledTimes(1);
      expect(Date.now() - start).toBeLessThan(1_000);
    } finally {
      warnSpy.mockRestore();
    }
  });

  it("aborts immediately during request-spacing wait without issuing the next fetch", async () => {
    const fetchMock = vi
      .fn<typeof fetch>()
      .mockResolvedValue(new Response("ok", { status: 200 }));

    const politeFetch = createPoliteWikimediaFetch({
      fetchImpl: fetchMock,
      minRequestIntervalMs: 10_000,
    });

    await politeFetch(
      "https://upload.wikimedia.org/wikipedia/commons/a/ab/First.jpg",
    );
    expect(fetchMock).toHaveBeenCalledTimes(1);

    const controller = new AbortController();
    const start = Date.now();
    const secondPromise = politeFetch(
      "https://upload.wikimedia.org/wikipedia/commons/a/ab/Second.jpg",
      { signal: controller.signal },
    );
    setTimeout(() => controller.abort(new Error("stop spacing")), 30);

    await expect(secondPromise).rejects.toThrow("stop spacing");
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(Date.now() - start).toBeLessThan(1_000);
  });
});
