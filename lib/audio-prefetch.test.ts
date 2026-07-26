import { describe, it, expect, vi, beforeEach } from "vitest";
import {
  ARTICLE_SECTION_NARRATION_VERSION,
  buildArticleNarrationTracks,
} from "./section-narration";
import { getActiveTtsCacheKey } from "./tts-profile";

let warmSummaryAudio: typeof import("./audio-prefetch").warmSummaryAudio;
let getCachedSummaryUrl: typeof import("./audio-prefetch").getCachedSummaryUrl;
let getCachedSummaryAudio: typeof import("./audio-prefetch").getCachedSummaryAudio;
let awaitSummaryAudio: typeof import("./audio-prefetch").awaitSummaryAudio;
let primeSummaryAudio: typeof import("./audio-prefetch").primeSummaryAudio;

const mockFetchArticle = vi.fn();
const audioBlobUrl = "blob:http://localhost/fake-audio-url";
const primedAudioUrl = "https://storage.example/summary.mp3";
const articleFixture = (
  overrides: Partial<{
    wikiPageId: string;
    revisionId: string;
    title: string;
    language: string;
    narrationVersion: number;
    summary: string;
    thumbnailUrl: string;
  }> = {},
) => ({
  wikiPageId: "42",
  revisionId: "100",
  title: "Test Article",
  language: "en",
  narrationVersion: ARTICLE_SECTION_NARRATION_VERSION,
  summary: "This is a long enough summary for TTS generation.",
  ...overrides,
});
const summarySourceHash = (
  article: ReturnType<typeof articleFixture>,
): string =>
  buildArticleNarrationTracks(article).find(
    (track) => track.sectionKey === "summary",
  )!.sourceHash;
const metadata = {
  provider: "openai" as const,
  model: "gpt-4o-mini-tts",
  voiceId: "marin",
  promptVersion: "curio-warm-narrator-v1",
  ttsNormVersion: "ttsNorm:2",
  ttsCacheKey:
    "tts:openai:gpt-4o-mini-tts:marin:curio-warm-narrator-v1:ttsNorm:2",
};

beforeEach(async () => {
  vi.resetModules();
  vi.unstubAllEnvs();

  vi.stubGlobal("window", {});

  const storage: Record<string, string> = {};
  vi.stubGlobal("localStorage", {
    getItem: (key: string) => storage[key] ?? null,
    setItem: (key: string, value: string) => {
      storage[key] = value;
    },
    removeItem: (key: string) => {
      delete storage[key];
    },
  });

  vi.stubGlobal(
    "fetch",
    vi.fn().mockResolvedValue({
      ok: true,
      blob: () =>
        Promise.resolve(new Blob(["audio-data"], { type: "audio/mpeg" })),
    }),
  );

  vi.spyOn(URL, "createObjectURL").mockReturnValue(audioBlobUrl);
  vi.spyOn(URL, "revokeObjectURL").mockImplementation(() => {});

  mockFetchArticle.mockReset();
  mockFetchArticle.mockResolvedValue(articleFixture());

  const mod = await import("./audio-prefetch");
  warmSummaryAudio = mod.warmSummaryAudio;
  getCachedSummaryUrl = mod.getCachedSummaryUrl;
  getCachedSummaryAudio = mod.getCachedSummaryAudio;
  awaitSummaryAudio = mod.awaitSummaryAudio;
  primeSummaryAudio = mod.primeSummaryAudio;
});

describe("warmSummaryAudio", () => {
  it("fetches article and generates TTS audio", async () => {
    const result = await warmSummaryAudio("Test_Article", mockFetchArticle);

    expect(result?.url).toBe(audioBlobUrl);
    expect(mockFetchArticle).toHaveBeenCalledWith({ slug: "Test_Article" });
    expect(fetch).toHaveBeenCalledWith(
      "/api/tts",
      expect.objectContaining({ method: "POST" }),
    );
  });

  it("stores link-prefetched audio only under the canonical revision-bound source hash", async () => {
    const article = {
      wikiPageId: "42",
      revisionId: "100",
      title: "Revisioned Article",
      language: "en",
      narrationVersion: ARTICLE_SECTION_NARRATION_VERSION,
      summary: "A canonical summary for this exact source revision.",
    };
    mockFetchArticle.mockResolvedValue(article);
    const summaryTrack = buildArticleNarrationTracks(article).find(
      (track) => track.sectionKey === "summary",
    )!;

    await warmSummaryAudio("Revisioned_Article", mockFetchArticle);
    await vi.waitFor(() => expect(fetch).toHaveBeenCalled());

    expect(
      getCachedSummaryAudio(
        "Revisioned_Article",
        summaryTrack.sourceHash,
        getActiveTtsCacheKey(),
      )?.url,
    ).toBe(audioBlobUrl);
    expect(
      getCachedSummaryAudio(
        "Revisioned_Article",
        undefined,
        getActiveTtsCacheKey(),
      ),
    ).toBeNull();
  });

  it("does not reuse a prefetched summary after the active TTS profile changes", async () => {
    const article = articleFixture();
    const sourceHash = summarySourceHash(article);
    mockFetchArticle.mockResolvedValue(article);
    vi.stubEnv("NEXT_PUBLIC_OPENAI_TTS_VOICE", "marin");

    const first = await warmSummaryAudio("Profiled_Article", mockFetchArticle);
    const firstCacheKey = getActiveTtsCacheKey();

    vi.stubEnv("NEXT_PUBLIC_OPENAI_TTS_VOICE", "cedar");
    const secondCacheKey = getActiveTtsCacheKey();
    const second = await warmSummaryAudio("Profiled_Article", mockFetchArticle);

    expect(firstCacheKey).not.toBe(secondCacheKey);
    expect(first?.metadata.ttsCacheKey).toBe(firstCacheKey);
    expect(second?.metadata.ttsCacheKey).toBe(secondCacheKey);
    expect(fetch).toHaveBeenCalledTimes(2);
    expect(
      getCachedSummaryAudio("Profiled_Article", sourceHash, firstCacheKey)
        ?.metadata.ttsCacheKey,
    ).toBe(firstCacheKey);
    expect(
      getCachedSummaryAudio("Profiled_Article", sourceHash, secondCacheKey)
        ?.metadata.ttsCacheKey,
    ).toBe(secondCacheKey);
  });

  it("populates getCachedSummaryUrl after completion", async () => {
    const article = articleFixture();
    const sourceHash = summarySourceHash(article);
    mockFetchArticle.mockResolvedValue(article);
    const pending = warmSummaryAudio("Cached_Article", mockFetchArticle);
    expect(
      getCachedSummaryUrl("Cached_Article", sourceHash, getActiveTtsCacheKey()),
    ).toBeNull();

    await pending;
    expect(
      getCachedSummaryUrl("Cached_Article", sourceHash, getActiveTtsCacheKey()),
    ).toBe(audioBlobUrl);
  });

  it("deduplicates concurrent calls for the same slug", async () => {
    await Promise.all([
      warmSummaryAudio("Dedup_Article", mockFetchArticle),
      warmSummaryAudio("Dedup_Article", mockFetchArticle),
      warmSummaryAudio("Dedup_Article", mockFetchArticle),
    ]);
    expect(mockFetchArticle).toHaveBeenCalledTimes(1);
    expect(fetch).toHaveBeenCalledTimes(1);
  });

  it("uses a primed summary result without calling the TTS endpoint", async () => {
    primeSummaryAudio(
      "Primed_Article",
      {
        url: primedAudioUrl,
        metadata,
      },
      "source-v1",
      metadata.ttsCacheKey,
    );

    const url = await awaitSummaryAudio(
      "Primed_Article",
      "source-v1",
      metadata.ttsCacheKey,
    );

    expect(url).toBe(primedAudioUrl);
    expect(
      getCachedSummaryUrl("Primed_Article", "source-v1", metadata.ttsCacheKey),
    ).toBe(primedAudioUrl);
    expect(
      getCachedSummaryAudio(
        "Primed_Article",
        "source-v1",
        metadata.ttsCacheKey,
      ),
    ).toEqual({ url: primedAudioUrl, metadata });
    expect(fetch).not.toHaveBeenCalled();
  });

  it("does not reuse a primed summary across narration source hashes", () => {
    primeSummaryAudio(
      "Revisioned_Article",
      { url: primedAudioUrl, metadata },
      "source-v1",
      metadata.ttsCacheKey,
    );

    expect(
      getCachedSummaryAudio(
        "Revisioned_Article",
        "source-v1",
        metadata.ttsCacheKey,
      )?.url,
    ).toBe(primedAudioUrl);
    expect(
      getCachedSummaryAudio(
        "Revisioned_Article",
        "source-v2",
        metadata.ttsCacheKey,
      ),
    ).toBeNull();
    expect(
      getCachedSummaryAudio(
        "Revisioned_Article",
        undefined,
        metadata.ttsCacheKey,
      ),
    ).toBeNull();
  });

  it("returns null for whitespace-only summaries", async () => {
    mockFetchArticle.mockResolvedValue(articleFixture({ summary: "  \n  " }));

    const result = await warmSummaryAudio("Short_Article", mockFetchArticle);
    expect(result).toBeNull();
  });

  it("warms valid summaries shorter than ten characters", async () => {
    mockFetchArticle.mockResolvedValue(articleFixture({ summary: "Brief." }));

    const result = await warmSummaryAudio("Brief_Article", mockFetchArticle);
    expect(result?.url).toBe(audioBlobUrl);
  });

  it("returns null when fetch fails", async () => {
    mockFetchArticle.mockRejectedValue(new Error("Network error"));

    const result = await warmSummaryAudio("Failing_Article", mockFetchArticle);
    expect(result).toBeNull();
  });

  it("clears failed warm attempts so the same slug can be retried", async () => {
    vi.mocked(fetch)
      .mockRejectedValueOnce(new Error("TTS unavailable"))
      .mockResolvedValueOnce({
        ok: true,
        blob: () =>
          Promise.resolve(new Blob(["audio-data"], { type: "audio/mpeg" })),
      } as Response);

    expect(
      await warmSummaryAudio("Retry_Article", mockFetchArticle),
    ).toBeNull();

    expect(
      (await warmSummaryAudio("Retry_Article", mockFetchArticle))?.url,
    ).toBe(audioBlobUrl);
    expect(fetch).toHaveBeenCalledTimes(2);
  });
});

describe("getCachedSummaryUrl", () => {
  it("returns null for unknown slugs", () => {
    expect(
      getCachedSummaryUrl("nonexistent", "source-v1", metadata.ttsCacheKey),
    ).toBeNull();
  });
});

describe("awaitSummaryAudio", () => {
  it("returns null for unknown slugs", () => {
    expect(
      awaitSummaryAudio("nonexistent", "source-v1", metadata.ttsCacheKey),
    ).toBeNull();
  });
});
