# On This Day snapshots are kept fresh by a rolling scheduled refresh, not by readers

Refreshing one Calendar Day costs about 20 Wikimedia requests and 5–15 seconds: the ~1.6 MB feed call plus roughly 19 batched Commons/enwiki image-info lookups. So readers must never wait on one. We backfill all 366 Snapshots once with throttling. After that, a daily scheduled job refreshes the UTC today ±1 plus the ~53 oldest Snapshots, keeping every Calendar Day under 7 days old. Image attribution is reused from the previous Snapshot for unchanged image URLs, so a steady-state refresh is about one feed call plus a few lookups. That's roughly 60–120 upstream requests a day, well within Wikimedia's identified-client limits.

## Considered Options

- **Reader-triggered refresh only**: rejected. Upstream load scales with crawler sweeps across 366 indexed pages, so it's bursty and unpredictable.
- **Refresh only when a day becomes "today"**: rejected. Snapshots could be up to a year stale.
- **Fully lazy (no backfill)**: rejected. The first visitor or crawler on each day would wait 5–15 seconds.

## Consequences

- A reader-triggered background refresh still exists, but only as a safety net for Snapshots older than 14 days (i.e. the scheduled job is failing).
- Don't "simplify" by dropping image-metadata reuse. Without it, steady-state cost rises about 20×.
