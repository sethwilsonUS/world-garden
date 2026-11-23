# On This Day Share Cards are pre-rendered in Convex storage and decoupled from rolling Refreshes

Each Calendar Day's Share Card is generated once into Convex file storage (`onThisDayShareCards`) via a throttled backfill script and served strictly read-only by `/on-this-day/[day]/opengraph-image` and `twitter-image`, falling back to the decorative timeline card if ungenerated. The undated `/on-this-day` route bundles five verified Public Domain Wikimedia Commons plates locally so its Share Card is static and immune to Facebook's aggressive per-URL image caching. Rolling Snapshot Refreshes intentionally do not overwrite stored Share Cards; a Calendar Day's card changes only when manually re-rendered.

## Considered Options

- **Render day collages on demand during social-crawler requests**: rejected. Fetching 5+ Wikimedia thumbnails inside a request risks hitting Facebook/iMessage's ~4–5 second crawler timeout and exposes crawler traffic to Wikimedia 429 throttling.
- **Lazy cache-on-miss in the image route**: rejected. For a low-volume site, a one-time backfill covers all 366 days cleanly while keeping the public image route strictly read-only with zero write path or crawler-triggered upstream fetches.
- **Auto-regenerate Share Cards during every rolling Snapshot Refresh**: rejected. Historic highlights for a Calendar Day rarely change meaningfully year to year, so keeping Share Cards fixed avoids running Satori and re-uploading images on every cron cycle.
- **Show today's changing Snapshot on bare `/on-this-day`**: rejected. Facebook caches `og:image` per URL, so a dated collage on `/on-this-day` would show stale dates on shared links.

## Consequences

- Social crawlers always get a fast, deterministic image response with zero Wikimedia calls at request time.
- A new Calendar Day Snapshot update will not change that day's Share Card automatically; updating a day's card requires an explicit manual re-render (`--day MM-DD --force`).
- All 366 Share Cards must be generated once via the backfill script (after visual sign-off on the evergreen card and October 18 sample); any ungenerated day falls back cleanly to the decorative timeline panel rather than displaying photos from another day.
