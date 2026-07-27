import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import PrivacyPage from "./page";

describe("PrivacyPage", () => {
  it("explains the optional feedback and research information", () => {
    const markup = renderToStaticMarkup(createElement(PrivacyPage));

    expect(markup).toContain("Feedback and research");
    expect(markup).toContain("A message is required when you submit feedback");
    expect(markup).toContain("assistive technology");
    expect(markup).toContain("optional contact email");
    expect(markup).toContain("opt in to invitations for future research");
    expect(markup).toContain(
      "article title, article identifier, and saved Wikipedia revision",
    );
    expect(markup).toContain(
      "Article context also remains with article-specific feedback",
    );
    expect(markup).toContain("an email address is needed");
    expect(markup).toContain(
      "You do not need to share a medical condition or diagnosis",
    );
    expect(markup).toContain(
      "removes the contact email from stored feedback when it reaches 180 days",
    );
    expect(markup).toContain(
      "schedules additional batches until any backlog is drained",
    );
    expect(markup).toContain(
      "does not store the raw network address with your feedback",
    );
    expect(markup).toContain(
      "An hourly cleanup deletes expired quota records in bounded batches of up to 500",
    );
    expect(markup).toContain("until the current backlog is gone");
    expect(markup).toContain('href="/feedback"');
    expect(markup).not.toContain("contact or support method published");
  });

  it("names signed-in listening, playlist, feed, export, and quota data precisely", () => {
    const markup = renderToStaticMarkup(createElement(PrivacyPage));

    expect(markup).toContain(
      "playlist order, episode-generation status, generated episode files, and private RSS feed token",
    );
    expect(markup).toContain(
      "article listening progress, including heard ranges and qualification timestamps",
    );
    expect(markup).toContain("topic-badge credit");
    expect(markup).toContain(
      "article-audio export records and generated files",
    );
    expect(markup).toContain("account-linked generation quota windows");
    expect(markup).toContain("revocable bearer credential");
    expect(markup).toContain(
      "Previously downloaded, cached, or directly accessed copies cannot be recalled",
    );
    expect(markup).toContain(
      "not automatically joined to your signed-in account",
    );
    expect(markup).toContain(
      "Shared article and audio caches and aggregated analytics are not treated as account-owned data",
    );
    expect(markup).toContain(
      "Device-local information is outside Curio Garden’s server-side account data",
    );
  });
});
