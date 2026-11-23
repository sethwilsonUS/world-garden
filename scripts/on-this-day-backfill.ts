/**
 * One-time (or recovery) throttled backfill script for all 366 On This Day
 * Calendar Day snapshots.
 *
 * Calls the authenticated `/api/on-this-day/cron?budgetSeconds=240` endpoint
 * in a loop until `remainingStale === 0`, respecting the route's rate limit
 * (6 calls per 10 minutes) and any Retry-After headers.
 *
 * Usage:
 *   SITE_URL=https://curiogarden.org CRON_SECRET=... npm run on-this-day:backfill
 */

const DEFAULT_BUDGET_SECONDS = 240;
const QUOTA_PAUSE_MS = 105_000; // <= 6 requests per 10 minutes
const MAX_ITERATIONS = 40;

type CronSummary = {
  refreshed?: number;
  unchanged?: number;
  degraded?: number;
  suspicious?: number;
  failed?: number;
  remainingStale?: number;
  oldestCheckedAt?: number | null;
  stoppedEarlyReason?: string;
  error?: string;
};

const sleep = async (ms: number): Promise<void> =>
  await new Promise((resolve) => setTimeout(resolve, ms));

const main = async () => {
  const siteUrl = (
    process.env.SITE_URL ||
    process.env.NEXT_PUBLIC_SITE_URL ||
    ""
  ).replace(/\/+$/u, "");
  const cronSecret = process.env.CRON_SECRET?.trim() || "";
  const budgetSeconds = Number(
    process.env.BUDGET_SECONDS || DEFAULT_BUDGET_SECONDS,
  );

  if (!siteUrl) {
    throw new Error(
      "Set SITE_URL (or NEXT_PUBLIC_SITE_URL) before running on-this-day:backfill.",
    );
  }
  if (!cronSecret) {
    throw new Error("Set CRON_SECRET before running on-this-day:backfill.");
  }

  const endpoint = `${siteUrl}/api/on-this-day/cron?budgetSeconds=${budgetSeconds}`;
  console.log(`Starting On This Day backfill against ${endpoint}`);

  for (let pass = 1; pass <= MAX_ITERATIONS; pass += 1) {
    const startedAt = Date.now();
    const response = await fetch(endpoint, {
      headers: {
        Authorization: `Bearer ${cronSecret}`,
        Accept: "application/json",
      },
    });

    if (response.status === 429) {
      const retryAfter = Number(response.headers.get("retry-after") || "60");
      const waitMs = Math.max(10_000, (retryAfter + 5) * 1000);
      console.warn(
        `Pass ${pass}: received 429, waiting ${Math.ceil(waitMs / 1000)}s before retrying…`,
      );
      await sleep(waitMs);
      continue;
    }

    const body = (await response.json().catch(() => ({}))) as CronSummary;
    if (!response.ok) {
      throw new Error(
        `Pass ${pass} failed (${response.status}): ${body.error ?? "unknown error"}`,
      );
    }

    const elapsedSeconds = ((Date.now() - startedAt) / 1000).toFixed(1);
    console.log(
      `Pass ${pass} (${elapsedSeconds}s): refreshed=${body.refreshed ?? 0}, unchanged=${body.unchanged ?? 0}, suspicious=${body.suspicious ?? 0}, failed=${body.failed ?? 0}, remainingStale=${body.remainingStale ?? "unknown"}${body.stoppedEarlyReason ? ` (${body.stoppedEarlyReason})` : ""}`,
    );

    if ((body.remainingStale ?? 0) === 0) {
      console.log("Backfill complete: all 366 Calendar Days are fresh.");
      return;
    }

    const elapsedMs = Date.now() - startedAt;
    const pauseMs = Math.max(5_000, QUOTA_PAUSE_MS - elapsedMs);
    console.log(
      `Waiting ${Math.ceil(pauseMs / 1000)}s before next pass to stay within route quota…`,
    );
    await sleep(pauseMs);
  }

  throw new Error(
    `Backfill reached max iterations (${MAX_ITERATIONS}) with stale days still remaining.`,
  );
};

main().catch((error) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exit(1);
});
