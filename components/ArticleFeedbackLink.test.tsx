import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import {
  ArticleFeedbackLink,
  buildArticleFeedbackHref,
} from "./ArticleFeedbackLink";
import {
  MAX_PRODUCT_FEEDBACK_ARTICLE_SLUG_BYTES,
  MAX_PRODUCT_FEEDBACK_ARTICLE_TITLE_BYTES,
} from "@/lib/product-feedback";

describe("ArticleFeedbackLink", () => {
  it("carries bounded article context into the feedback route", () => {
    const href = buildArticleFeedbackHref({
      title: "The Fellowship of the Ring",
      slug: "The_Fellowship_of_the_Ring",
      revisionId: "123456789",
    });
    const url = new URL(href, "https://curiogarden.org");

    expect(url.pathname).toBe("/feedback");
    expect(url.searchParams.get("articleTitle")).toBe(
      "The Fellowship of the Ring",
    );
    expect(url.searchParams.get("articleSlug")).toBe(
      "The_Fellowship_of_the_Ring",
    );
    expect(url.searchParams.get("articleRevisionId")).toBe("123456789");
  });

  it("renders a clearly named navigation link", () => {
    const markup = renderToStaticMarkup(
      createElement(ArticleFeedbackLink, {
        title: "Lothlórien",
        slug: "Lothlórien",
        revisionId: "42",
      }),
    );

    expect(markup).toContain("href=\"/feedback?");
    expect(markup).toContain("Give feedback on this article");
  });

  it("omits an unavailable or malformed revision identifier", () => {
    const href = buildArticleFeedbackHref({
      title: "Example",
      slug: "Example",
      revisionId: "not-a-revision",
    });
    const url = new URL(href, "https://curiogarden.org");

    expect(url.searchParams.has("articleRevisionId")).toBe(false);
    expect(url.searchParams.get("articleTitle")).toBe("Example");
    expect(url.searchParams.get("articleSlug")).toBe("Example");
  });

  it("keeps query context inside the API byte limits without splitting Unicode", () => {
    const href = buildArticleFeedbackHref({
      title: `Garden ${"🌿".repeat(200)}`,
      slug: `Garden_${"🌿".repeat(300)}`,
      revisionId: "7",
    });
    const url = new URL(href, "https://curiogarden.org");
    const title = url.searchParams.get("articleTitle") ?? "";
    const slug = url.searchParams.get("articleSlug") ?? "";

    expect(new TextEncoder().encode(title).byteLength).toBeLessThanOrEqual(
      MAX_PRODUCT_FEEDBACK_ARTICLE_TITLE_BYTES,
    );
    expect(new TextEncoder().encode(slug).byteLength).toBeLessThanOrEqual(
      MAX_PRODUCT_FEEDBACK_ARTICLE_SLUG_BYTES,
    );
    expect(title.endsWith("�")).toBe(false);
    expect(slug.endsWith("�")).toBe(false);
  });

  it("normalizes Unicode line separators before building context", () => {
    const url = new URL(
      buildArticleFeedbackHref({
        title: "One\u2028Two",
        slug: "One\u2029Two",
      }),
      "https://curiogarden.org",
    );

    expect(url.searchParams.get("articleTitle")).toBe("One Two");
    expect(url.searchParams.get("articleSlug")).toBe("One Two");
  });

  it("falls back to general feedback unless title and slug are both present", () => {
    expect(
      buildArticleFeedbackHref({
        title: "Example",
        slug: "   ",
        revisionId: "123",
      }),
    ).toBe("/feedback");
  });
});
