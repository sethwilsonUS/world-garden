import { describe, expect, it, vi } from "vitest";
import { ON_THIS_DAY_SHARE_CARD_VERSION } from "@/lib/on-this-day-share-card";
import {
  buildUploadDayRunReport,
  createPoliteWikimediaFetch,
  parseCliArgs,
  resolveShareCardCreditTarget,
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

describe("buildUploadDayRunReport", () => {
  it("reports rejectedStaleVersion as skipped with retainedVersion and nests rejected render metadata under attempted", () => {
    const sampleReportPlates = [
      {
        slot: 0,
        year: 1775,
        yearLabel: "1775",
        articleTitle: "American Revolutionary War",
        category: "selected",
        licenseTier: "pd-cc0",
        licenseName: "Public domain",
        isPortrait: false,
        dimensions: "330x218",
        imageUrl: "https://upload.wikimedia.org/wikipedia/commons/a/ab/Rev.jpg",
      },
    ];

    const staleReport = buildUploadDayRunReport({
      monthDay: "10-18",
      dayLabel: "October 18",
      snapshotSource: "convex",
      subtitle: "54 events · 258 births",
      byteSize: 150_000,
      reportPlates: sampleReportPlates,
      saved: {
        monthDay: "10-18",
        version: 2,
        storageId: "storage-v2",
        replaced: false,
        rejectedStaleVersion: true,
      },
    });

    expect(staleReport.status).toBe("skipped");
    expect(staleReport.replaced).toBe(false);
    expect(staleReport.storageId).toBe("storage-v2");
    expect(staleReport.retainedVersion).toBe(2);
    expect(staleReport.reason).toBe("retained newer v2");
    expect(staleReport.byteSize).toBeUndefined();
    expect(staleReport.plateCount).toBeUndefined();
    expect(staleReport.plates).toBeUndefined();
    expect(staleReport.attempted).toEqual({
      byteSize: 150_000,
      plateCount: 1,
      plates: sampleReportPlates,
    });

    const uploadedReport = buildUploadDayRunReport({
      monthDay: "10-18",
      dayLabel: "October 18",
      snapshotSource: "convex",
      subtitle: "54 events · 258 births",
      byteSize: 150_000,
      reportPlates: sampleReportPlates,
      saved: {
        monthDay: "10-18",
        version: 2,
        storageId: "storage-v2-new",
        replaced: true,
        rejectedStaleVersion: false,
      },
    });

    expect(uploadedReport.status).toBe("uploaded");
    expect(uploadedReport.replaced).toBe(true);
    expect(uploadedReport.byteSize).toBe(150_000);
    expect(uploadedReport.plateCount).toBe(1);
    expect(uploadedReport.plates).toEqual(sampleReportPlates);
    expect(uploadedReport.attempted).toBeUndefined();
    expect(uploadedReport.retainedVersion).toBeUndefined();
    expect(uploadedReport.reason).toBeUndefined();
  });
});

describe("resolveShareCardCreditTarget", () => {
  it("uses local preview sidecar credit label in --preview-only mode instead of an unpublished API URL", () => {
    const previewTarget = resolveShareCardCreditTarget({
      monthDay: "10-18",
      creditRevisionId: "a1b2c3d4e5f60708",
      previewOnly: true,
    });
    expect(previewTarget.creditPath).toBe(
      "local preview — on-this-day-10-18.credits.json",
    );
    expect(previewTarget.creditPath).not.toContain("/api/on-this-day/");
    expect(previewTarget.previewCreditsFilename).toBe(
      "on-this-day-10-18.credits.json",
    );

    const uploadTarget = resolveShareCardCreditTarget({
      monthDay: "10-18",
      creditRevisionId: "a1b2c3d4e5f60708",
      previewOnly: false,
    });
    expect(uploadTarget.creditPath).toBe(
      "/api/on-this-day/share-card-credits?day=10-18&rev=a1b2c3d4e5f60708",
    );
    expect(uploadTarget.previewCreditsFilename).toBeUndefined();
  });
});
