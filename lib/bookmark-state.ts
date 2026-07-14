import {
  isBookmarkSaved,
  mergeBookmarkEntries,
  type BookmarkEntry,
} from "./bookmarks";

export type HybridBookmarkState = {
  entries: BookmarkEntry[];
  isLoaded: boolean;
  pendingImportedEntries: BookmarkEntry[];
};

export type HybridBookmarkAction =
  | { type: "reset" }
  | { type: "guest"; entries: BookmarkEntry[] }
  | { type: "accountMirror"; entries: BookmarkEntry[] }
  | { type: "convexUnavailable" }
  | { type: "syncRemote"; remoteEntries: BookmarkEntry[] }
  | { type: "startImport" }
  | {
      type: "importSuccess";
      importedEntries: BookmarkEntry[];
      remoteEntries: BookmarkEntry[];
    }
  | { type: "importFailure"; remoteEntries: BookmarkEntry[] }
  | { type: "saveAccount"; entry: BookmarkEntry }
  | { type: "removeAccount"; slug: string };

export const initialHybridBookmarkState: HybridBookmarkState = {
  entries: [],
  isLoaded: false,
  pendingImportedEntries: [],
};

export const buildBookmarkEntry = (
  slug: string,
  title: string,
  savedAt = Date.now(),
): BookmarkEntry => ({ slug, title, savedAt });

export const buildBookmarkImportSignature = (
  userKey: string,
  entries: BookmarkEntry[],
): string | null => {
  if (entries.length === 0) {
    return null;
  }

  return `${userKey}:${entries.map((entry) => entry.slug).sort().join("|")}`;
};

export const toggleGuestBookmarkEntries = (
  entries: BookmarkEntry[],
  slug: string,
  title: string,
): BookmarkEntry[] => {
  return isBookmarkSaved(entries, slug)
    ? entries.filter((entry) => entry.slug !== slug)
    : mergeBookmarkEntries([buildBookmarkEntry(slug, title)], entries);
};

export const removeGuestBookmarkEntry = (
  entries: BookmarkEntry[],
  slug: string,
): BookmarkEntry[] => entries.filter((entry) => entry.slug !== slug);

export const hybridBookmarkReducer = (
  state: HybridBookmarkState,
  action: HybridBookmarkAction,
): HybridBookmarkState => {
  switch (action.type) {
    case "reset":
      return initialHybridBookmarkState;
    case "guest":
      return {
        entries: action.entries,
        isLoaded: true,
        pendingImportedEntries: [],
      };
    case "accountMirror":
      return {
        entries: action.entries,
        isLoaded: false,
        pendingImportedEntries: [],
      };
    case "convexUnavailable":
      return {
        ...state,
        isLoaded: true,
        pendingImportedEntries: [],
      };
    case "syncRemote": {
      const remoteHasPendingEntries =
        state.pendingImportedEntries.length > 0 &&
        state.pendingImportedEntries.every((entry) =>
          action.remoteEntries.some((remoteEntry) => remoteEntry.slug === entry.slug),
        );

      if (remoteHasPendingEntries) {
        return {
          entries: action.remoteEntries,
          isLoaded: true,
          pendingImportedEntries: [],
        };
      }

      return {
        entries:
          state.pendingImportedEntries.length > 0
            ? mergeBookmarkEntries(
                state.pendingImportedEntries,
                action.remoteEntries,
              )
            : action.remoteEntries,
        isLoaded: true,
        pendingImportedEntries: state.pendingImportedEntries,
      };
    }
    case "startImport":
      return {
        ...state,
        isLoaded: false,
      };
    case "importSuccess":
      return {
        entries: mergeBookmarkEntries(
          action.importedEntries,
          action.remoteEntries,
        ),
        isLoaded: true,
        pendingImportedEntries: action.importedEntries,
      };
    case "importFailure":
      return {
        entries: action.remoteEntries,
        isLoaded: true,
        pendingImportedEntries: [],
      };
    case "saveAccount":
      return {
        ...state,
        entries: mergeBookmarkEntries([action.entry], state.entries),
      };
    case "removeAccount":
      return {
        ...state,
        entries: state.entries.filter((entry) => entry.slug !== action.slug),
        pendingImportedEntries: state.pendingImportedEntries.filter(
          (entry) => entry.slug !== action.slug,
        ),
      };
  }
};
