import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";
import { BookmarkButton } from "./BookmarkButton";

vi.mock("@/hooks/useBookmarks", () => ({
  useBookmarks: () => ({
    isBookmarked: () => false,
    toggle: vi.fn(),
  }),
}));

vi.mock("@/lib/analytics", () => ({
  analytics: {
    articleBookmarked: vi.fn(),
  },
}));

describe("BookmarkButton", () => {
  it("names the Library and its purpose in the labeled variant", () => {
    const markup = renderToStaticMarkup(
      createElement(BookmarkButton, {
        slug: "mars",
        title: "Mars",
        variant: "labeled",
      }),
    );

    expect(markup).toContain("Save to Library");
    expect(markup).toContain('aria-label="Save to Library: Mars"');
    expect(markup).toContain(
      'title="Library: save this article to revisit later"',
    );
  });
});
