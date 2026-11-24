# Curio Garden

An accessibility-first reader and listener for Wikipedia content, including daily features such as On This Day.

## Language

### On This Day

**Calendar Day**:
A month and day with no year (e.g. March 5), and the unit a reader picks and pages through on On This Day. Wikipedia's On This Day lists belong to a Calendar Day, not to a dated year.
_Avoid_: date, feed date, edition (when you mean what the reader picks)

**Snapshot**:
Our single stored copy of Wikipedia's On This Day lists for one Calendar Day, replaced whenever it's refreshed. There is never more than one Snapshot per Calendar Day.
_Avoid_: edition, archive, cache entry

**Reader's Today**:
The Calendar Day matching the reader's own local date, and where On This Day opens when no day is chosen. It can differ from the UTC date the site's scheduled refresh runs on.
_Avoid_: today (unqualified), current date

**Refresh**:
Re-fetching a Calendar Day's lists from Wikipedia to replace its Snapshot. A failed or suspicious Refresh leaves the existing Snapshot untouched.
_Avoid_: sync, rebuild

**Degraded Snapshot**:
A stopgap Snapshot holding only the highlights from the daily featured feed, used only when a Calendar Day has no Snapshot at all. It's first in line for the next Refresh.
_Avoid_: fallback edition, archived edition

**Share Card**:
The single 1200×630 social-preview image for a Calendar Day (or the evergreen undated On This Day page), showing a curated gallery of historical plates for link shares on Facebook, X, and messaging apps. Unlike a Snapshot, a Calendar Day's Share Card is generated once and stays fixed until manually re-rendered.
_Avoid_: thumbnail, social banner, preview tile, cover art

## Example dialogue

> **Dev:** "If someone picks March 5 in the calendar, which year's list do they get?"
> **Domain expert:** "There's no year. March 5 is a **Calendar Day**, and they always get the freshest list we have for it."
