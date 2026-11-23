/**
 * Pre-renders 1200×630 Archival Gallery Wall JPEG Share Cards for On This Day.
 *
 * Local preview mode (NEVER uploads to Convex):
 *   npm run on-this-day:backfill-cards -- --preview-only --evergreen --day 10-18 --preview-out /tmp/previews
 *
 * Production backfill (uploads generated JPEGs to Convex `_storage`):
 *   NEXT_PUBLIC_CONVEX_URL=... TTS_QUOTA_BYPASS_SECRET=... npm run on-this-day:backfill-cards
 *   NEXT_PUBLIC_CONVEX_URL=... TTS_QUOTA_BYPASS_SECRET=... npm run on-this-day:backfill-cards -- --day 10-18 --force
 */

import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import {
  ON_THIS_DAY_OG_SIZE,
  type OnThisDayOgPlate,
} from "@/app/(app)/on-this-day/og-card";
import {
  ALL_CALENDAR_DAYS,
  calendarDayKey,
  formatCalendarDay,
  parseCalendarDaySlug,
  type CalendarDay,
} from "@/lib/calendar-day";
import {
  buildOnThisDaySnapshot,
  OnThisDayUpstreamError,
} from "@/lib/on-this-day";
import type { OnThisDaySnapshot } from "@/lib/on-this-day-contracts";
import {
  EVERGREEN_ON_THIS_DAY_EYEBROW,
  EVERGREEN_ON_THIS_DAY_SUBTITLE,
  loadEvergreenOnThisDayPlates,
} from "@/lib/on-this-day-evergreen-plates";
import {
  fetchNormalizedShareCardPlate,
  ON_THIS_DAY_SHARE_CARD_MIME_TYPE,
  ON_THIS_DAY_SHARE_CARD_VERSION,
  renderOnThisDayShareCardJpeg,
  type NormalizedShareCardPlateImage,
} from "@/lib/on-this-day-share-card";
import {
  assignPlatesToGallerySlots,
  buildShareCardSubtitle,
  DEFAULT_MAX_SHARE_CARD_CANDIDATES,
  DEFAULT_MAX_SHARE_CARD_PLATES,
  selectShareCardPlateCandidates,
  type ShareCardPlateCandidate,
} from "@/lib/on-this-day-share-card-selection";
import {
  listStoredOnThisDayShareCardStatuses,
  uploadAndSaveOnThisDayShareCard,
  type StoredOnThisDayShareCardPlate,
} from "@/lib/on-this-day-share-card-store";
import {
  createConvexOnThisDayStore,
  shouldUseOnThisDaySnapshotCache,
} from "@/lib/on-this-day-snapshot";
import { requireServerAttestationSecret } from "@/lib/server-attestation";

const DEFAULT_PREVIEW_OUT_DIR = path.resolve(
  ".reports",
  "on-this-day-share-cards",
);
const WIKIMEDIA_MIN_REQUEST_INTERVAL_MS = 350;
const WIKIMEDIA_PER_ATTEMPT_TIMEOUT_MS = 10_000;
const WIKIMEDIA_OVERALL_FETCH_TIMEOUT_MS = 90_000;
const WIKIMEDIA_MAX_RETRIES = 3;
const DEFAULT_RETRY_AFTER_MS = 5_000;
const MAX_RETRY_AFTER_MS = 60_000;
const INTER_DAY_PAUSE_MS = 400;

type CliOptions = {
  previewOnly: boolean;
  previewOutDir: string;
  evergreen: boolean;
  day: CalendarDay | null;
  force: boolean;
  help: boolean;
};

type LoadedCandidatePlate = {
  width: number;
  height: number;
  candidate: ShareCardPlateCandidate;
  normalized: NormalizedShareCardPlateImage;
};

type PlateReportEntry = {
  slot: number;
  year: number | null;
  yearLabel: string | null;
  articleTitle: string;
  category: string;
  licenseTier: string;
  licenseName: string | null;
  isPortrait: boolean;
  dimensions: string;
  imageUrl: string;
};

type DayRunReport = {
  monthDay: string;
  dayLabel: string;
  status: "rendered" | "uploaded" | "skipped" | "failed";
  snapshotSource?: "convex" | "live";
  subtitle?: string;
  plateCount?: number;
  byteSize?: number;
  outputPath?: string;
  storageId?: string;
  replaced?: boolean;
  reason?: string;
  plates?: PlateReportEntry[];
};

const sleep = async (ms: number): Promise<void> =>
  await new Promise((resolve) => setTimeout(resolve, ms));

const parseRetryAfterMs = (headerValue: string | null): number => {
  if (!headerValue) return DEFAULT_RETRY_AFTER_MS;
  const trimmed = headerValue.trim();
  if (/^\d+$/u.test(trimmed)) {
    const seconds = Number(trimmed);
    return Math.min(MAX_RETRY_AFTER_MS, Math.max(1_000, seconds * 1_000));
  }
  const parsedDate = Date.parse(trimmed);
  if (!Number.isNaN(parsedDate)) {
    return Math.min(
      MAX_RETRY_AFTER_MS,
      Math.max(1_000, parsedDate - Date.now()),
    );
  }
  return DEFAULT_RETRY_AFTER_MS;
};

const createPoliteWikimediaFetch = (): typeof fetch => {
  let lastRequestAt = 0;

  return async (input, init) => {
    for (let attempt = 0; attempt <= WIKIMEDIA_MAX_RETRIES; attempt += 1) {
      const elapsed = Date.now() - lastRequestAt;
      if (lastRequestAt > 0 && elapsed < WIKIMEDIA_MIN_REQUEST_INTERVAL_MS) {
        await sleep(WIKIMEDIA_MIN_REQUEST_INTERVAL_MS - elapsed);
      }
      lastRequestAt = Date.now();

      const attemptController = new AbortController();
      const attemptSignal = init?.signal
        ? AbortSignal.any([init.signal, attemptController.signal])
        : attemptController.signal;
      const timeout = setTimeout(
        () => attemptController.abort(),
        WIKIMEDIA_PER_ATTEMPT_TIMEOUT_MS,
      );

      let response: Response;
      try {
        response = await fetch(input, {
          ...init,
          signal: attemptSignal,
        });
      } finally {
        clearTimeout(timeout);
      }

      if (
        (response.status === 429 || response.status === 503) &&
        attempt < WIKIMEDIA_MAX_RETRIES
      ) {
        const retryAfterMs = parseRetryAfterMs(
          response.headers.get("retry-after"),
        );
        try {
          await response.body?.cancel();
        } catch (cancelError: unknown) {
          console.warn(
            "[on-this-day:backfill-cards] Failed to cancel rate-limited Wikimedia response:",
            cancelError instanceof Error
              ? cancelError.message
              : String(cancelError),
          );
        }
        const backoffMs = Math.min(
          MAX_RETRY_AFTER_MS,
          retryAfterMs + attempt * 2_000,
        );
        console.warn(
          `[on-this-day:backfill-cards] Wikimedia returned HTTP ${response.status}; waiting ${Math.ceil(backoffMs / 1000)}s before retry ${attempt + 1}/${WIKIMEDIA_MAX_RETRIES}…`,
        );
        await sleep(backoffMs);
        continue;
      }

      return response;
    }

    throw new Error("Exhausted Wikimedia fetch retries");
  };
};

const buildLiveSnapshotWithRetry = async (
  day: CalendarDay,
): Promise<OnThisDaySnapshot> => {
  const monthDay = calendarDayKey(day);

  for (let attempt = 0; attempt <= WIKIMEDIA_MAX_RETRIES; attempt += 1) {
    try {
      return await buildOnThisDaySnapshot({ day });
    } catch (error: unknown) {
      const isRetryable =
        error instanceof OnThisDayUpstreamError &&
        (error.status === 429 || error.status === 503);

      if (isRetryable && attempt < WIKIMEDIA_MAX_RETRIES) {
        const retrySeconds = error.retryAfterSeconds ?? 5 * (attempt + 1);
        const waitMs = Math.min(
          MAX_RETRY_AFTER_MS,
          Math.max(2_000, (retrySeconds + 2) * 1_000),
        );
        console.warn(
          `[on-this-day:backfill-cards] Wikipedia returned HTTP ${error.status} for ${monthDay}; waiting ${Math.ceil(waitMs / 1000)}s before retry ${attempt + 1}/${WIKIMEDIA_MAX_RETRIES}…`,
        );
        await sleep(waitMs);
        continue;
      }

      throw error;
    }
  }

  throw new Error(`Failed to build live snapshot for ${monthDay}`);
};

const loadSnapshotForDay = async (
  day: CalendarDay,
  previewOnly: boolean,
): Promise<{ snapshot: OnThisDaySnapshot; source: "convex" | "live" }> => {
  const monthDay = calendarDayKey(day);

  if (!previewOnly && shouldUseOnThisDaySnapshotCache()) {
    const store = createConvexOnThisDayStore();
    try {
      const stored = await store.getDaySnapshot(monthDay);
      const isEnriched =
        stored?.data &&
        stored.data.provider !== "featured-fallback" &&
        !stored.state?.pendingImageEnrichment &&
        (stored.state?.imagesCheckedAt ?? 0) > 0;

      if (isEnriched && stored?.data) {
        return { snapshot: stored.data, source: "convex" };
      }
    } catch (error: unknown) {
      console.warn(
        `[on-this-day:backfill-cards] Failed to read Convex snapshot for ${monthDay}; falling back to live build:`,
        error instanceof Error ? error.message : String(error),
      );
    }
  }

  const liveSnapshot = await buildLiveSnapshotWithRetry(day);
  return { snapshot: liveSnapshot, source: "live" };
};

const parseCliArgs = (argv: readonly string[]): CliOptions => {
  let previewOnly = false;
  let previewOutRaw: string | null = null;
  let evergreen = false;
  let dayRaw: string | null = null;
  let force = false;
  let help = false;

  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg === "--help" || arg === "-h") {
      help = true;
    } else if (arg === "--preview-only") {
      previewOnly = true;
    } else if (arg === "--evergreen") {
      evergreen = true;
    } else if (arg === "--force") {
      force = true;
    } else if (arg === "--preview-out") {
      const next = argv[index + 1];
      if (!next || next.startsWith("--")) {
        throw new Error("--preview-out requires a directory path");
      }
      previewOutRaw = next;
      index += 1;
    } else if (arg.startsWith("--preview-out=")) {
      const value = arg.slice("--preview-out=".length).trim();
      if (!value) {
        throw new Error("--preview-out requires a non-empty directory path");
      }
      previewOutRaw = value;
    } else if (arg === "--day") {
      const next = argv[index + 1];
      if (!next || next.startsWith("--")) {
        throw new Error("--day requires a calendar day (e.g. 10-18 or october-18)");
      }
      dayRaw = next;
      index += 1;
    } else if (arg.startsWith("--day=")) {
      const value = arg.slice("--day=".length).trim();
      if (!value) {
        throw new Error("--day requires a calendar day (e.g. 10-18 or october-18)");
      }
      dayRaw = value;
    } else {
      throw new Error(`Unknown CLI argument: ${arg}`);
    }
  }

  let day: CalendarDay | null = null;
  if (dayRaw !== null) {
    day = parseCalendarDaySlug(dayRaw);
    if (!day) {
      throw new Error(
        `Invalid --day value "${dayRaw}". Expected MM-DD (e.g. 10-18) or slug (e.g. october-18).`,
      );
    }
  }

  if (previewOutRaw !== null) {
    previewOnly = true;
  }

  return {
    previewOnly,
    previewOutDir: previewOutRaw
      ? path.resolve(previewOutRaw)
      : DEFAULT_PREVIEW_OUT_DIR,
    evergreen,
    day,
    force,
    help,
  };
};

const printUsage = (): void => {
  console.log(`Usage: tsx scripts/on-this-day-backfill-cards.ts [options]

Options:
  --preview-only           Render JPEG(s) locally without uploading to Convex
  --preview-out <dir>      Output directory for local preview JPEGs (implies --preview-only)
  --evergreen              Render the undated evergreen card (on-this-day-evergreen.jpg)
  --day <MM-DD|slug>       Render a single Calendar Day (e.g. 10-18 or october-18)
  --force                  Re-render and replace existing stored card when uploading
  -h, --help               Show this help message`);
};

const printPlateTable = (
  heading: string,
  plates: readonly PlateReportEntry[],
  byteSize: number,
  subtitle: string,
  outputTarget: string,
): void => {
  console.log(`\n=== ${heading} ===`);
  console.log(`Subtitle: ${subtitle}`);
  console.log(
    `Output:   ${outputTarget} (${(byteSize / 1024).toFixed(1)} KB, ${byteSize} bytes)`,
  );
  if (plates.length === 0) {
    console.log("Plates:   0 (fallback timeline layout)");
    return;
  }
  for (const plate of plates) {
    const orientation = plate.isPortrait ? "portrait" : "landscape/square";
    const yearText = plate.yearLabel ?? "undated";
    const licenseText = plate.licenseName ?? plate.licenseTier;
    console.log(
      `  [Slot ${plate.slot}] ${yearText} | ${plate.articleTitle} | ${licenseText} | ${orientation} (${plate.dimensions}) | ${plate.imageUrl}`,
    );
  }
};

const renderEvergreenPreview = async (
  previewOutDir: string,
): Promise<{
  outputPath: string;
  byteSize: number;
  plates: PlateReportEntry[];
}> => {
  const evergreenPlates = await loadEvergreenOnThisDayPlates();
  const orderedPlates = [
    ...evergreenPlates.filter((plate) => plate.isHero),
    ...evergreenPlates.filter((plate) => !plate.isHero),
  ];

  const ogPlates: OnThisDayOgPlate[] = orderedPlates.map((plate) => ({
    imageDataUrl: plate.imageDataUrl,
    alt: plate.title,
    yearLabel: plate.yearLabel,
    isPortrait: plate.isPortrait,
  }));

  const jpegBytes = await renderOnThisDayShareCardJpeg({
    eyebrow: EVERGREEN_ON_THIS_DAY_EYEBROW,
    subtitle: EVERGREEN_ON_THIS_DAY_SUBTITLE,
    plates: ogPlates,
  });

  await mkdir(previewOutDir, { recursive: true });
  const outputPath = path.join(previewOutDir, "on-this-day-evergreen.jpg");
  await writeFile(outputPath, jpegBytes);

  const reportPlates: PlateReportEntry[] = orderedPlates.map((plate, index) => ({
    slot: index,
    year: plate.year,
    yearLabel: plate.yearLabel,
    articleTitle: plate.title,
    category: "evergreen",
    licenseTier: "pd-cc0",
    licenseName: "Public Domain (bundled)",
    isPortrait: plate.isPortrait,
    dimensions: `${plate.width}x${plate.height}`,
    imageUrl: `bundled:${plate.id}`,
  }));

  printPlateTable(
    "Evergreen /on-this-day Share Card",
    reportPlates,
    jpegBytes.byteLength,
    EVERGREEN_ON_THIS_DAY_SUBTITLE,
    outputPath,
  );

  return {
    outputPath,
    byteSize: jpegBytes.byteLength,
    plates: reportPlates,
  };
};

const processCalendarDay = async ({
  day,
  options,
  politeFetch,
}: {
  day: CalendarDay;
  options: CliOptions;
  politeFetch: typeof fetch;
}): Promise<DayRunReport> => {
  const monthDay = calendarDayKey(day);
  const dayLabel = formatCalendarDay(day);

  const { snapshot, source: snapshotSource } = await loadSnapshotForDay(
    day,
    options.previewOnly,
  );

  const candidates = selectShareCardPlateCandidates(snapshot, {
    maxCandidates: DEFAULT_MAX_SHARE_CARD_CANDIDATES,
  });

  const loaded: LoadedCandidatePlate[] = [];
  for (const candidate of candidates) {
    if (loaded.length >= DEFAULT_MAX_SHARE_CARD_PLATES) {
      break;
    }
    const normalized = await fetchNormalizedShareCardPlate(candidate.imageUrl, {
      fetchImpl: politeFetch,
      timeoutMs: WIKIMEDIA_OVERALL_FETCH_TIMEOUT_MS,
    });
    if (!normalized) {
      console.warn(
        `[on-this-day:backfill-cards] ${monthDay}: skipped unavailable/invalid plate "${candidate.articleTitle}" (${candidate.imageUrl})`,
      );
      continue;
    }
    loaded.push({
      width: normalized.width,
      height: normalized.height,
      candidate,
      normalized,
    });
  }

  const slotted = assignPlatesToGallerySlots(
    loaded,
    DEFAULT_MAX_SHARE_CARD_PLATES,
  );
  const subtitle = buildShareCardSubtitle(snapshot, dayLabel);

  if (slotted.length === 0) {
    const reason =
      candidates.length === 0
        ? "No eligible Wikimedia Commons plates found in Snapshot"
        : `All ${candidates.length} candidate plate downloads failed`;

    console.warn(
      `[on-this-day:backfill-cards] ${monthDay} (${dayLabel}): 0 usable plates — ${reason}. Refusing to persist 0-plate fallback.`,
    );
    return {
      monthDay,
      dayLabel,
      status: "failed",
      snapshotSource,
      subtitle,
      plateCount: 0,
      reason,
      plates: [],
    };
  }

  const ogPlates: OnThisDayOgPlate[] = slotted.map((plate) => ({
    imageDataUrl: plate.normalized.imageDataUrl,
    alt: plate.candidate.alt,
    yearLabel: plate.candidate.yearLabel,
    isPortrait: plate.normalized.isPortrait,
  }));

  const jpegBytes = await renderOnThisDayShareCardJpeg({
    dayLabel,
    subtitle,
    plates: ogPlates,
  });

  const reportPlates: PlateReportEntry[] = slotted.map((plate, index) => ({
    slot: index,
    year: plate.candidate.year ?? null,
    yearLabel: plate.candidate.yearLabel ?? null,
    articleTitle: plate.candidate.articleTitle,
    category: plate.candidate.category,
    licenseTier: plate.candidate.licenseTier,
    licenseName: plate.candidate.licenseName ?? null,
    isPortrait: plate.normalized.isPortrait,
    dimensions: `${plate.normalized.width}x${plate.normalized.height}`,
    imageUrl: plate.candidate.imageUrl,
  }));

  if (options.previewOnly) {
    await mkdir(options.previewOutDir, { recursive: true });
    const outputPath = path.join(
      options.previewOutDir,
      `on-this-day-${monthDay}.jpg`,
    );
    await writeFile(outputPath, jpegBytes);

    printPlateTable(
      `${dayLabel} (${monthDay}) Preview Share Card`,
      reportPlates,
      jpegBytes.byteLength,
      subtitle,
      outputPath,
    );

    return {
      monthDay,
      dayLabel,
      status: "rendered",
      snapshotSource,
      subtitle,
      plateCount: slotted.length,
      byteSize: jpegBytes.byteLength,
      outputPath,
      plates: reportPlates,
    };
  }

  const storedPlates: StoredOnThisDayShareCardPlate[] = slotted.map(
    ({ candidate }) => ({
      ...(candidate.year === undefined ? {} : { year: candidate.year }),
      articleTitle: candidate.articleTitle,
      imageUrl: candidate.imageUrl,
      ...(candidate.licenseName ? { licenseName: candidate.licenseName } : {}),
      ...(candidate.creator ? { creator: candidate.creator } : {}),
      ...(candidate.sourceUrl ? { sourceUrl: candidate.sourceUrl } : {}),
    }),
  );

  const saved = await uploadAndSaveOnThisDayShareCard({
    monthDay,
    version: ON_THIS_DAY_SHARE_CARD_VERSION,
    data: jpegBytes,
    mimeType: ON_THIS_DAY_SHARE_CARD_MIME_TYPE,
    width: ON_THIS_DAY_OG_SIZE.width,
    height: ON_THIS_DAY_OG_SIZE.height,
    snapshotCheckedAt: snapshot.checkedAt,
    plates: storedPlates,
  });

  printPlateTable(
    `${dayLabel} (${monthDay}) Uploaded Share Card`,
    reportPlates,
    jpegBytes.byteLength,
    subtitle,
    `convex:${saved.storageId} (${saved.replaced ? "replaced" : "created"})`,
  );

  return {
    monthDay,
    dayLabel,
    status: "uploaded",
    snapshotSource,
    subtitle,
    plateCount: slotted.length,
    byteSize: jpegBytes.byteLength,
    storageId: saved.storageId,
    replaced: saved.replaced,
    plates: reportPlates,
  };
};

const main = async (): Promise<void> => {
  const options = parseCliArgs(process.argv.slice(2));
  if (options.help) {
    printUsage();
    return;
  }

  if (!options.previewOnly) {
    if (!shouldUseOnThisDaySnapshotCache()) {
      throw new Error(
        "Convex upload mode requires NEXT_PUBLIC_CONVEX_URL and NEXT_PUBLIC_LOCAL_MODE !== 'true' (or pass --preview-only for local rendering).",
      );
    }
    requireServerAttestationSecret();
  }

  const summary: {
    mode: "preview-only" | "upload";
    version: number;
    evergreen?: {
      outputPath: string;
      byteSize: number;
      plates: PlateReportEntry[];
    };
    totals: {
      rendered: number;
      uploaded: number;
      skipped: number;
      failed: number;
      belowFivePlates: string[];
    };
    days: DayRunReport[];
  } = {
    mode: options.previewOnly ? "preview-only" : "upload",
    version: ON_THIS_DAY_SHARE_CARD_VERSION,
    totals: {
      rendered: 0,
      uploaded: 0,
      skipped: 0,
      failed: 0,
      belowFivePlates: [],
    },
    days: [],
  };

  if (options.evergreen) {
    if (!options.previewOnly) {
      console.warn(
        "[on-this-day:backfill-cards] --evergreen only writes a local preview file (evergreen cards are served statically from bundled repo assets).",
      );
    }
    summary.evergreen = await renderEvergreenPreview(options.previewOutDir);
  }

  const targetDays: readonly CalendarDay[] = options.day
    ? [options.day]
    : options.previewOnly && options.evergreen
      ? []
      : ALL_CALENDAR_DAYS;

  const existingByMonthDay = new Map<
    string,
    { version: number; plateCount: number }
  >();
  if (!options.previewOnly && !options.force && targetDays.length > 0) {
    const statuses = await listStoredOnThisDayShareCardStatuses();
    for (const status of statuses) {
      existingByMonthDay.set(status.monthDay, {
        version: status.version,
        plateCount: status.plateCount,
      });
    }
  }

  const politeFetch = createPoliteWikimediaFetch();

  for (let index = 0; index < targetDays.length; index += 1) {
    const day = targetDays[index];
    const monthDay = calendarDayKey(day);
    const dayLabel = formatCalendarDay(day);

    if (!options.previewOnly && !options.force) {
      const existing = existingByMonthDay.get(monthDay);
      if (
        existing &&
        existing.version === ON_THIS_DAY_SHARE_CARD_VERSION &&
        existing.plateCount > 0
      ) {
        summary.totals.skipped += 1;
        summary.days.push({
          monthDay,
          dayLabel,
          status: "skipped",
          plateCount: existing.plateCount,
          reason: `Already stored at v${existing.version} with ${existing.plateCount} plates`,
        });
        continue;
      }
    }

    try {
      const report = await processCalendarDay({ day, options, politeFetch });
      summary.days.push(report);

      if (report.status === "rendered") {
        summary.totals.rendered += 1;
      } else if (report.status === "uploaded") {
        summary.totals.uploaded += 1;
      } else if (report.status === "failed") {
        summary.totals.failed += 1;
      }

      if (
        (report.status === "rendered" || report.status === "uploaded") &&
        (report.plateCount ?? 0) < DEFAULT_MAX_SHARE_CARD_PLATES
      ) {
        summary.totals.belowFivePlates.push(
          `${monthDay} (${report.plateCount ?? 0})`,
        );
      }
    } catch (error: unknown) {
      const message = error instanceof Error ? error.message : String(error);
      console.error(
        `[on-this-day:backfill-cards] Failed processing ${monthDay} (${dayLabel}): ${message}`,
      );
      summary.totals.failed += 1;
      summary.days.push({
        monthDay,
        dayLabel,
        status: "failed",
        reason: message,
      });
    }

    if (index + 1 < targetDays.length) {
      await sleep(INTER_DAY_PAUSE_MS);
    }
  }

  console.log("\n=== Share Card Backfill Summary (JSON) ===");
  console.log(JSON.stringify(summary, null, 2));

  if (summary.totals.failed > 0) {
    process.exitCode = 1;
  }
};

main().catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exit(1);
});
