import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import type { Article } from "@/lib/data-context";
import {
  ArticleHero,
  MobileArticleSummaryDisclosure,
} from "./ArticleViewPresentation";

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

describe("responsive article summary presentation", () => {
  it.each([
    ["without a lead image", false],
    ["with a lead image", true],
  ] as const)(
    "renders one mobile lead and the unchanged desktop summary %s",
    (_label, withThumbnail) => {
      const markup = renderToStaticMarkup(
        <ArticleHero
          article={article(withThumbnail)}
          imageAnalysis={null}
          lightbox={null}
          onLightboxChange={() => undefined}
        />,
      );

      expect(markup).toContain("data-mobile-article-summary-lead");
      expect(markup).toContain(`${lead}</p>`);
      expect(markup).toContain("data-desktop-article-summary");
      expect(markup).toContain(`${summary}</p>`);
      expect(markup).toContain("sm:hidden");
      expect(markup).toContain("hidden");
      expect(markup).toContain("sm:block");
    },
  );

  it("puts only the nonduplicated remainder in a mobile-only disclosure", () => {
    const markup = renderToStaticMarkup(
      <MobileArticleSummaryDisclosure summary={summary} />,
    );

    expect(markup).toContain("<details");
    expect(markup).toContain("data-mobile-article-summary-disclosure");
    expect(markup).toContain("sm:hidden");
    expect(markup).toContain("min-h-11");
    expect(markup).toContain("focus-visible:ring-2");
    expect(markup).toContain("Show full text summary");
    expect(markup).toContain("Hide full text summary");
    expect(markup).toContain(
      `data-mobile-article-summary-remainder="true">${remainder}</p>`,
    );
    expect(markup).not.toContain(lead);
    expect(markup).not.toContain(`>${summary}</p>`);
  });

  it.each([undefined, "", lead])(
    "omits the disclosure when no remainder exists (%s)",
    (value) => {
      expect(
        renderToStaticMarkup(
          <MobileArticleSummaryDisclosure summary={value} />,
        ),
      ).toBe("");
    },
  );
});
