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
            source: "https://upload.wikimedia.org/shire-portrait.jpg",
            width: 330,
            height: 495,
          },
        },
        imageLoading: "eager",
      }),
    );

    expect(markup).toContain("data-adaptive-image-frame");
    expect(markup).toContain('data-adaptive-image-mode="cover"');
    const portraitImages = Array.from(
      markup.matchAll(/<img\b[^>]*>/g),
      ([tag]) => tag,
    ).filter((tag) =>
      tag.includes('src="https://upload.wikimedia.org/shire-portrait.jpg"'),
    );
    expect(portraitImages).toHaveLength(1);
    expect(portraitImages[0]).toMatch(/\bobject-cover\b/);
    expect(portraitImages[0]).toContain("object-[50%_30%]");
    expect(portraitImages[0]).not.toMatch(/\bobject-contain\b/);
    expect(markup).not.toContain('data-adaptive-image-mode="backdrop"');
    expect(markup).not.toContain('loading="lazy"');
  });
});
