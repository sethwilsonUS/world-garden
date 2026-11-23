# On This Day is keyed by Calendar Day, with one living snapshot each

Wikipedia's On This Day lists belong to a month and day, not a year, so the On This Day page lets readers pick a Calendar Day (e.g. `03-05`) and always shows the freshest list we have for it. We store exactly one living snapshot per Calendar Day (at most 366), overwritten on each refresh, and dropped the year-stamped history. Nothing ever read the old copies, and keeping them invited stale records to resurface.

## Considered Options

- **Dated editions (YYYY-MM-DD)**: browse the page as it looked on a past date. Rejected: only captured dates would be pickable, and future dates would be impossible.
- **Keep dated history, read newest**: rejected as unbounded growth with no reader.
- **Living snapshot plus capped history**: rejected for now. A rollback copy isn't worth the complexity when a refresh can always re-fetch from Wikipedia.

## Consequences

- Readers can no longer see a historical "as of" version of a Calendar Day.
- Existing year-stamped rows need a one-time migration or cleanup.
