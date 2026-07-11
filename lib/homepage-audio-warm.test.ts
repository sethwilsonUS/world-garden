import { beforeEach, describe, expect, it, vi } from "vitest";
import type { TodayWikipediaData } from "./today-snapshot";
import {
  isHomepageAudioWarmEnabled,
  warmHomepageArticleSummaries,
  type HomepageAudioWarmDependencies,
} from "./homepage-audio-warm";
import { getActiveTtsProfile, getTtsMetadata, getTtsProfile } from "./tts-profile";

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

const makeDependencies = (
  overrides: Partial<HomepageAudioWarmDependencies> = {},
): HomepageAudioWarmDependencies => {
  const expected = getTtsMetadata(getActiveTtsProfile());
  return {
    fetchArticle: vi.fn(async (article) => ({
      _id: article.slug,
      summary: `A sufficiently long summary for ${article.title}.`,
    })),
    getCachedSummary: vi.fn(async () => ({})),
    verifyAudioUrl: vi.fn(async () => undefined),
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
    const expected = getTtsMetadata(getActiveTtsProfile());
    const getCachedSummary = vi
      .fn<HomepageAudioWarmDependencies["getCachedSummary"]>()
      .mockResolvedValueOnce({ url: "https://audio.test/good.mp3", metadata: expected })
      .mockResolvedValueOnce({ url: "https://audio.test/stale.mp3", metadata: expected });
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

  it("stores fallback audio as degraded so a later run retries the primary key", async () => {
    const fallback = getTtsMetadata(getTtsProfile("edge"));
    const dependencies = makeDependencies({
      generateAudio: vi.fn(async () => ({
        blob: new Blob(["fallback"], { type: "audio/mpeg" }),
        metadata: fallback,
        fallbackReason: "openai_error" as const,
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
      expect.objectContaining({ metadata: fallback }),
    );
  });

  it("isolates failures and sanitizes failure details", async () => {
    const dependencies = makeDependencies({
      fetchArticle: vi.fn(async (article) => {
        if (article.title === "Broken") {
          throw new Error("Request https://secret.test/token failed");
        }
        return { _id: article.slug, summary: "A healthy article summary." };
      }),
    });

    const result = await warmHomepageArticleSummaries({
      baseUrl: "https://curiogarden.org",
      snapshot: snapshot(["Broken", "Healthy"]),
      dependencies,
      concurrency: 1,
    });

    expect(result).toMatchObject({ status: "partial", failed: 1, generated: 1 });
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
        return { _id: article.slug, summary: "A healthy article summary." };
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
        return { _id: article.slug, summary: "A healthy article summary." };
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
