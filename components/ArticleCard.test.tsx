import { createElement, type ComponentProps } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";
import { ArticleCard } from "./ArticleCard";

vi.mock("@/components/ArticleLink", () => ({
  ArticleLink: ({
    children,
    articleTitle,
    ...props
  }: ComponentProps<"a"> & { articleTitle: string }) => {
    void articleTitle;
    return createElement("a", props, children);
  },
}));

vi.mock("@/components/PlaylistActionButton", () => ({
  PlaylistActionButton: () => null,
}));

describe("ArticleCard", () => {
  it("uses an adaptive decorative thumbnail and preserves eager priority", () => {
    const markup = renderToStaticMarkup(
      createElement(ArticleCard, {
        article: {
          title: "The Shire",
          extract: "A quiet and well-tended part of Middle-earth.",
          views: 144000,
          thumbnail: {
            source: "https://upload.wikimedia.org/shire.jpg",
            width: 1200,
            height: 900,
          },
        },
        imageLoading: "eager",
      }),
    );

    expect(markup).toContain("data-adaptive-image-frame");
    expect(markup).toContain('data-adaptive-image-mode="cover"');
    expect(markup).toMatch(
      /<img[^>]*(?=[^>]*alt="")(?=[^>]*class="[^"]*\bobject-cover\b[^"]*")(?=[^>]*src="https:\/\/upload\.wikimedia\.org\/shire\.jpg")[^>]*>/,
    );
    expect(markup).not.toContain('loading="lazy"');
  });
});
