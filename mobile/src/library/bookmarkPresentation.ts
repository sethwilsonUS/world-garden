import type { BookmarkEntry } from "@curio-garden/domain";

export const SAFE_LIBRARY_UPDATE_ERROR =
  "We couldn’t update your Library. Please try again.";

export function bookmarkEntriesRevision(
  entries: readonly BookmarkEntry[],
): string {
  return JSON.stringify(
    entries.map(({ savedAt, slug, title }) => [slug, title, savedAt]),
  );
}
