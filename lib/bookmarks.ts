export type BookmarkEntry = {
  slug: string;
  title: string;
  savedAt: number;
};

export type BookmarkStorageMode = "guest" | "account";

export type BookmarkListViewState = "loading" | "empty" | "list";

const isValidBookmarkEntry = (entry: BookmarkEntry): boolean => {
  return entry.slug.trim().length > 0 && entry.title.trim().length > 0;
};

export const normalizeBookmarkEntries = (
  entries: BookmarkEntry[],
): BookmarkEntry[] => {
  const deduped = new Map<string, BookmarkEntry>();

  for (const entry of [...entries].sort((a, b) => b.savedAt - a.savedAt)) {
    if (!isValidBookmarkEntry(entry) || deduped.has(entry.slug)) {
      continue;
    }
    deduped.set(entry.slug, entry);
  }

  return [...deduped.values()];
};

export const mergeBookmarkEntries = (
  preferredEntries: BookmarkEntry[],
  fallbackEntries: BookmarkEntry[],
): BookmarkEntry[] => {
  return normalizeBookmarkEntries([...preferredEntries, ...fallbackEntries]);
};

export const getUnclaimedGuestBookmarks = (
  guestEntries: BookmarkEntry[],
  claimedSlugs: Set<string>,
): BookmarkEntry[] => {
  return normalizeBookmarkEntries(
    guestEntries.filter((entry) => !claimedSlugs.has(entry.slug)),
  );
};

export const isBookmarkSaved = (
  entries: BookmarkEntry[],
  slug: string,
): boolean => {
  return entries.some((entry) => entry.slug === slug);
};

export const getBookmarkListViewState = (args: {
  isLoaded: boolean;
  entriesCount: number;
}): BookmarkListViewState => {
  if (!args.isLoaded) {
    return "loading";
  }

  return args.entriesCount === 0 ? "empty" : "list";
};
