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
    expect(markup).toContain('href="/account"');
    expect(markup).toContain(
      "download a portable JSON copy of your server-side account data",
    );
    expect(markup).toContain(
      "bookmarks, Personal Playlist order and episode status, listening progress, topic-badge credit",
    );
    expect(markup).toContain(
      "active private RSS feed token is included and remains a bearer credential",
    );
    expect(markup).toContain("Revoked feed tokens are not included");
    expect(markup).toContain(
      "metadata about article-audio exports, not the generated audio files themselves",
    );
    expect(markup).toContain(
      "Device-local history and preferences, anonymous feedback, shared caches, and aggregated analytics are excluded",
    );
    expect(markup).toContain(
      "you can permanently delete your Curio Garden account",
    );
    expect(markup).toContain(
      "Personal Playlist records and account-linked generated episode files",
    );
    expect(markup).toContain("Private RSS access is turned off");
    expect(markup).toContain(
      "Some removal may finish in the background after sign-in ends",
    );
    expect(markup).toContain(
      "A limited technical deletion record is retained while account-owned cleanup or Clerk deletion is pending",
    );
    expect(markup).toContain("including while a failed step is being retried");
    expect(markup).toContain(
      "The final 24-hour grace period begins only after account-owned cleanup and Clerk deletion both succeed",
    );
    expect(markup).toContain(
      "the record is deleted if a final safety check confirms no account-linked data remains",
    );
    expect(markup).toContain("otherwise cleanup and the grace period restart");
    expect(markup).toContain(
      "Browser-only history and preferences are not removed automatically",
    );
    expect(markup).toContain(
      "Anonymous feedback, shared article and audio caches, and aggregated analytics remain",
    );
  });

  it("discloses cross-device resume position throughout its account-data lifecycle", () => {
    const markup = renderToStaticMarkup(createElement(PrivacyPage));

    expect(markup).toContain(
      "latest listening section and position so playback can resume across signed-in devices",
    );
    expect(markup).toContain(
      "The exported listening progress includes the latest saved section and position",
    );
    expect(markup).toContain(
      "Deletion also removes the latest saved listening section and position",
    );
  });

  it("describes the privacy-minimized AI cost ledger without overstating listening coverage", () => {
    const markup = renderToStaticMarkup(createElement(PrivacyPage));

    expect(markup).toContain("AI and audio operational records");
    expect(markup).toContain(
      "provider attempts, measured usage and response sizes, cache reuse, and aggregate signed-in listening progress",
    );
    expect(markup).toContain(
      "does not store article or narration text, page titles, full URLs, account identifiers, network addresses, or raw provider error messages",
    );
    expect(markup).toContain(
      "Raw provider-attempt, cache, generation-observation, and listening-contribution records are scheduled for deletion after 90 days using bounded cleanup batches",
    );
    expect(markup).toContain("a cleanup backlog can retain a record longer");
    expect(markup).toContain(
      "does not observe guest listening or listening in external podcast and download clients",
    );
    expect(markup).toContain(
      "temporarily keeps the current signed-in listening session’s exact heard ranges and start time",
    );
    expect(markup).toContain(
      "expires after about two hours without activity in that session",
    );
    expect(markup).toContain(
      "hourly bounded cleanup clears expired session accumulators",
    );
    expect(markup).toContain(
      "A live session accumulator and its expiry are included in your account data export",
    );
  });
});
