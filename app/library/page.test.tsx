import { describe, expect, it, vi } from "vitest";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import LibraryPage from "./page";
import { useBookmarks } from "@/hooks/useBookmarks";

vi.mock("@/hooks/useBookmarks", () => ({
  useBookmarks: vi.fn(),
}));

vi.mock("@/lib/analytics", () => ({
  analytics: {
    libraryPageAccessed: vi.fn(),
  },
}));

const mockedUseBookmarks = vi.mocked(useBookmarks);

const setBookmarkState = (args: {
  entries: Array<{ slug: string; title: string; savedAt: number }>;
  isLoaded: boolean;
}) => {
  mockedUseBookmarks.mockReturnValue({
    entries: args.entries,
    isLoaded: args.isLoaded,
    storageMode: "guest",
    isBookmarked: () => false,
    toggle: () => {},
    remove: () => {},
  });
};

describe("LibraryPage", () => {
  it("shows a loading state instead of the empty state while bookmarks are still loading", () => {
    setBookmarkState({ entries: [], isLoaded: false });

    const markup = renderToStaticMarkup(createElement(LibraryPage));

    expect(markup).toContain("Loading your reading list");
    expect(markup).not.toContain("No saved articles yet");
  });

  it("shows the empty state after loading completes with no bookmarks", () => {
    setBookmarkState({ entries: [], isLoaded: true });

    const markup = renderToStaticMarkup(createElement(LibraryPage));

    expect(markup).toContain("No saved articles yet");
  });

  it("renders saved bookmarks once loading completes", () => {
    setBookmarkState({
      isLoaded: true,
      entries: [{ slug: "mars", title: "Mars", savedAt: 10 }],
    });

    const markup = renderToStaticMarkup(createElement(LibraryPage));

    expect(markup).toContain("Mars");
    expect(markup).not.toContain("No saved articles yet");
  });
});
