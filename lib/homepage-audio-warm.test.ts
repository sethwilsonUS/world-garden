import { beforeEach, describe, expect, it, vi } from "vitest";
import type { TodayWikipediaData } from "./today-snapshot";
import {
  isHomepageAudioWarmEnabled,
  warmHomepageArticleSummaries,
  type HomepageAudioWarmDependencies,
} from "./homepage-audio-warm";
import {
  ARTICLE_SECTION_NARRATION_VERSION,
  buildArticleNarrationTracks,
} from "./section-narration";
import { getTtsMetadata, getTtsProfile } from "./tts-profile";

const snapshot = (titles: string[]): TodayWikipediaData => ({
  tfa: titles[0]
    ? { title: titles[0], extract: "", featuredDate: null, wikiPageId: "1" }
    : null,
  trending: titles.slice(1).map((title) => ({ title, extract: "", views: 1 })),
  didYouKnow: [],
  inTheNews: [],
  pictureOfDay: null,
  onThisDay: [],
  trendingDate: null,
  trendingSource: null,
  trendingSourceType: null,
  trendingIsStale: false,
  feedDate: "2026-07-10",
  snapshotFeedDate: "2026-07-10",
  snapshotGeneratedAt: 1,
  snapshotIsStale: false,
});

const warmArticleFixture = (
  article: { slug: string; title: string },
  summary = `A sufficiently long summary for ${article.title}.`,
) => ({
  _id: article.slug,
  title: article.title,
  revisionId: `revision-${article.slug}`,
  narrationVersion: ARTICLE_SECTION_NARRATION_VERSION,
  summary,
});

const makeDependencies = (
  overrides: Partial<HomepageAudioWarmDependencies> = {},
): HomepageAudioWarmDependencies => {
  const expected = getTtsMetadata(getTtsProfile("edge"));
  return {
    fetchArticle: vi.fn(async (article) => warmArticleFixture(article)),
    getCachedSummary: vi.fn(async () => ({})),
    verifyAudioUrl: vi.fn(async () => undefined),
    recordCacheReadResult: vi.fn(async () => undefined),
    generateAudio: vi.fn(async () => ({
      blob: new Blob(["audio"], { type: "audio/mpeg" }),
      metadata: expected,
    })),
    saveSummary: vi.fn(async () => undefined),
    now: () => 0,
    ...overrides,
  };
};

describe("homepage summary audio warmer", () => {
  beforeEach(() => {
    vi.unstubAllEnvs();
  });

  it("defaults on only in production and honors explicit overrides", () => {
    expect(isHomepageAudioWarmEnabled(undefined, "production")).toBe(true);
    expect(isHomepageAudioWarmEnabled(undefined, "development")).toBe(false);
    expect(isHomepageAudioWarmEnabled("true", "development")).toBe(true);
    expect(isHomepageAudioWarmEnabled("false", "production")).toBe(false);
  });

  it("reuses an exact readable cache entry and regenerates an inaccessible one", async () => {
    const consoleWarn = vi.spyOn(console, "warn").mockImplementation(() => {});
    const expected = getTtsMetadata(getTtsProfile("edge"));
    const getCachedSummary = vi
      .fn<HomepageAudioWarmDependencies["getCachedSummary"]>()
      .mockResolvedValueOnce({
        url: "https://audio.test/good.mp3",
        metadata: expected,
        durationSeconds: 12,
        byteLength: 2_048,
      })
      .mockResolvedValueOnce({
        url: "https://audio.test/stale.mp3",
        metadata: expected,
        durationSeconds: 12,
        byteLength: 2_048,
      });
    const verifyAudioUrl = vi
      .fn<HomepageAudioWarmDependencies["verifyAudioUrl"]>()
      .mockResolvedValueOnce(undefined)
      .mockRejectedValueOnce(new Error("404"));
    const dependencies = makeDependencies({ getCachedSummary, verifyAudioUrl });

    const result = await warmHomepageArticleSummaries({
      baseUrl: "https://curiogarden.org",
      snapshot: snapshot(["Cached", "Stale"]),
      dependencies,
      concurrency: 1,
    });

    expect(result).toMatchObject({
      status: "completed",
      targets: 2,
      reused: 1,
      generated: 1,
      degraded: 0,
      failed: 0,
    });
    expect(dependencies.generateAudio).toHaveBeenCalledTimes(1);
    expect(dependencies.recordCacheReadResult).toHaveBeenNthCalledWith(1, {
      source: "featured_audio_warm",
      provider: "edge",
      hit: true,
      byteLength: 2_048,
      durationSeconds: 12,
    });
    expect(dependencies.recordCacheReadResult).toHaveBeenNthCalledWith(2, {
      source: "featured_audio_warm",
      provider: "edge",
      hit: false,
      byteLength: 0,
      durationSeconds: 0,
    });
    expect(consoleWarn).toHaveBeenCalledWith(
      "[homepage-audio-warm] cached summary unavailable; regenerating",
      expect.objectContaining({ title: "Stale", error: "404" }),
    );
    expect(dependencies.saveSummary).toHaveBeenCalledWith(
      expect.objectContaining({
        articleId: "Stale",
        durationSeconds: expect.any(Number),
        metadata: expected,
      }),
    );
    consoleWarn.mockRestore();
  });

  it("records a legacy cache hit when its byte length is unknown", async () => {
    const expected = getTtsMetadata(getTtsProfile("edge"));
    const dependencies = makeDependencies({
      getCachedSummary: vi.fn(async () => ({
        url: "https://audio.test/legacy.mp3",
        metadata: expected,
        durationSeconds: 12,
      })),
    });

    const result = await warmHomepageArticleSummaries({
      baseUrl: "https://curiogarden.org",
      snapshot: snapshot(["Legacy"]),
      dependencies,
    });

    expect(result).toMatchObject({
      status: "completed",
      reused: 1,
      generated: 0,
      failed: 0,
    });
    expect(dependencies.recordCacheReadResult).toHaveBeenCalledWith({
      source: "featured_audio_warm",
      provider: "edge",
      hit: true,
      byteLength: 0,
      durationSeconds: 12,
    });
    expect(dependencies.generateAudio).not.toHaveBeenCalled();
  });

  it("uses the canonical normalized summary text and hash", async () => {
    const article = warmArticleFixture(
      { slug: "Canonical", title: "Canonical" },
      "  A summary\nwith   uneven spacing.  ",
    );
    const edge = getTtsMetadata(getTtsProfile("edge"));
    const dependencies = makeDependencies({
      fetchArticle: vi.fn(async () => article),
    });

    await warmHomepageArticleSummaries({
      baseUrl: "https://curiogarden.org",
      snapshot: snapshot(["Canonical"]),
      dependencies,
    });

    const text = "A summary with uneven spacing.";
    const sourceHash = buildArticleNarrationTracks(article).find(
      (track) => track.sectionKey === "summary",
    )!.sourceHash;
    expect(dependencies.getCachedSummary).toHaveBeenCalledWith(
      "Canonical",
      sourceHash,
      edge,
    );
    expect(dependencies.generateAudio).toHaveBeenCalledWith(text, edge);
  });

  it("uses the revision-bound summary track identity shared by article playback", async () => {
    const summary = "The same source summary appears in both revisions.";
    const articles = [
      {
        _id: "Revision_one",
        title: "Revision one",
        revisionId: "100",
        narrationVersion: ARTICLE_SECTION_NARRATION_VERSION,
        summary,
      },
      {
        _id: "Revision_two",
        title: "Revision two",
        revisionId: "101",
        narrationVersion: ARTICLE_SECTION_NARRATION_VERSION,
        summary,
      },
    ];
    const dependencies = makeDependencies({
      fetchArticle: vi
        .fn<HomepageAudioWarmDependencies["fetchArticle"]>()
        .mockResolvedValueOnce(articles[0])
        .mockResolvedValueOnce(articles[1]),
    });

    await warmHomepageArticleSummaries({
      baseUrl: "https://curiogarden.org",
      snapshot: snapshot(["Revision one", "Revision two"]),
      dependencies,
      concurrency: 1,
    });

    const requestedHashes = vi
      .mocked(dependencies.getCachedSummary)
      .mock.calls.map(([, sourceHash]) => sourceHash);
    const canonicalHashes = articles.map(
      (article) =>
        buildArticleNarrationTracks(article).find(
          (track) => track.sectionKey === "summary",
        )!.sourceHash,
    );
    expect(requestedHashes).toEqual(canonicalHashes);
    expect(requestedHashes[0]).not.toBe(requestedHashes[1]);
  });

  it("stores unexpected provider audio as degraded so a later run retries Edge", async () => {
    const unexpected = getTtsMetadata(getTtsProfile("openai"));
    const dependencies = makeDependencies({
      generateAudio: vi.fn(async () => ({
        blob: new Blob(["unexpected"], { type: "audio/mpeg" }),
        metadata: unexpected,
      })),
    });

    const result = await warmHomepageArticleSummaries({
      baseUrl: "https://curiogarden.org",
      snapshot: snapshot(["Fallback"]),
      dependencies,
    });

    expect(result.status).toBe("partial");
    expect(result.generated).toBe(1);
    expect(result.degraded).toBe(1);
    expect(dependencies.saveSummary).toHaveBeenCalledWith(
      expect.objectContaining({ metadata: unexpected }),
    );
  });

  it("isolates failures and sanitizes failure details", async () => {
    const dependencies = makeDependencies({
      fetchArticle: vi.fn(async (article) => {
        if (article.title === "Broken") {
          throw new Error("Request https://secret.test/token failed");
        }
        return warmArticleFixture(article, "A healthy article summary.");
      }),
    });

    const result = await warmHomepageArticleSummaries({
      baseUrl: "https://curiogarden.org",
      snapshot: snapshot(["Broken", "Healthy"]),
      dependencies,
      concurrency: 1,
    });

    expect(result).toMatchObject({
      status: "partial",
      failed: 1,
      generated: 1,
    });
    expect(result.failures[0]).toMatchObject({
      title: "Broken",
      error: "Request [url] failed",
    });
  });

  it("respects the concurrency limit", async () => {
    let active = 0;
    let peak = 0;
    const dependencies = makeDependencies({
      fetchArticle: vi.fn(async (article) => {
        active += 1;
        peak = Math.max(peak, active);
        await new Promise((resolve) => setTimeout(resolve, 5));
        active -= 1;
        return warmArticleFixture(article, "A healthy article summary.");
      }),
    });

    await warmHomepageArticleSummaries({
      baseUrl: "https://curiogarden.org",
      snapshot: snapshot(["One", "Two", "Three", "Four", "Five"]),
      dependencies,
      concurrency: 2,
    });

    expect(peak).toBe(2);
  });

  it("stops scheduling work at the deadline and reports skipped targets", async () => {
    let currentTime = 0;
    const dependencies = makeDependencies({
      fetchArticle: vi.fn(async (article) => {
        currentTime = 250;
        return warmArticleFixture(article, "A healthy article summary.");
      }),
      now: () => currentTime,
    });

    const result = await warmHomepageArticleSummaries({
      baseUrl: "https://curiogarden.org",
      snapshot: snapshot(["One", "Two", "Three"]),
      dependencies,
      concurrency: 1,
      deadlineMs: 200,
    });

    expect(result).toMatchObject({
      status: "partial",
      targets: 3,
      generated: 1,
      deadlineSkipped: 2,
    });
  });
});
