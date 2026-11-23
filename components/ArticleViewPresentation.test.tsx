import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import type { Article } from "@/lib/data-context";
import { ArticleHero, ArticleSummary } from "./ArticleViewPresentation";

const lead = "Pumpkins are fruits in the squash family.";
const remainder = "They are cultivated worldwide for food and decoration.";
const summary = `${lead} ${remainder}`;

const article = (withThumbnail: boolean): Article => ({
  language: "en",
  narrationVersion: 2,
  revisionId: "1234",
  sections: [],
  summary,
  thumbnailHeight: withThumbnail ? 675 : undefined,
  thumbnailUrl: withThumbnail
    ? "https://upload.wikimedia.org/wikipedia/commons/thumb/5/5c/FrenchMarketPumpkinsB.jpg/800px-FrenchMarketPumpkinsB.jpg"
    : undefined,
  thumbnailWidth: withThumbnail ? 800 : undefined,
  title: "Pumpkin",
  wikiPageId: "18956",
});

describe("article summary presentation", () => {
  it.each([
    ["without a lead image", false],
    ["with a lead image", true],
  ] as const)(
    "shows only the lead at reading size on every breakpoint %s",
    (_label, withThumbnail) => {
      const markup = renderToStaticMarkup(
        <ArticleHero
          article={article(withThumbnail)}
          imageAnalysis={null}
          lightbox={null}
          onLightboxChange={() => undefined}
        />,
      );

      expect(markup).toContain('aria-label="Article summary"');
      expect(markup).toContain(`data-article-summary-lead="true">${lead}</p>`);
      expect(markup).toContain("text-[1.0625rem]");
      expect(markup).toContain("text-foreground-2");
      expect(markup).toContain("max-w-[70ch]");
      expect(markup).not.toContain(`>${summary}</p>`);
      // No breakpoint-specific duplicate summary any more.
      expect(markup).not.toContain("sm:hidden");
      expect(markup).not.toContain("sm:block");
      expect(markup).not.toContain("data-desktop-article-summary");
    },
  );

  it("puts the summary before the capped lead image with its alt text", () => {
    const markup = renderToStaticMarkup(
      <ArticleHero
        article={article(true)}
        imageAnalysis={null}
        lightbox={null}
        onLightboxChange={() => undefined}
      />,
    );

    expect(markup.indexOf("data-article-summary-lead")).toBeLessThan(
      markup.indexOf("<figure"),
    );
    expect(markup).toContain('alt="Pumpkin"');
    expect(markup).toContain("View full image for Pumpkin");
    expect(markup).toContain("lg:grid-cols-[minmax(0,1fr)_16rem]");
    expect(markup).toContain("sm:h-64");
  });

  it("puts only the nonduplicated remainder in one disclosure", () => {
    const markup = renderToStaticMarkup(<ArticleSummary summary={summary} />);

    expect(markup).toContain("<details");
    expect(markup).toContain("data-article-summary-disclosure");
    expect(markup).toContain("btn-tertiary");
    expect(markup).toContain("Read full summary");
    expect(markup).toContain("Hide full summary");
    expect(markup).toContain(`>${remainder}</p>`);
    expect(markup.split(lead).length - 1).toBe(1);
    expect(markup).not.toContain(`>${summary}</p>`);
  });

  it("keeps paragraph breaks in the full summary", () => {
    const markup = renderToStaticMarkup(
      <ArticleSummary summary={`${lead} First more.\n\nSecond paragraph.`} />,
    );

    expect(markup).toContain(">First more.</p>");
    expect(markup).toContain(">Second paragraph.</p>");
  });

  it.each([undefined, "", lead])(
    "omits the disclosure when no remainder exists (%s)",
    (value) => {
      expect(
        renderToStaticMarkup(<ArticleSummary summary={value} />),
      ).not.toContain("<details");
    },
  );
});
