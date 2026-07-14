import type { BookmarkEntry, BookmarkStorageMode } from "@/lib/bookmarks";

export type BookmarkControllerValue = {
  entries: BookmarkEntry[];
  isLoaded: boolean;
  storageMode: BookmarkStorageMode;
  isBookmarked: (slug: string) => boolean;
  toggle: (slug: string, title: string) => void;
  remove: (slug: string) => void;
};
