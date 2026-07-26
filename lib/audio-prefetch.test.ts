import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  ARTICLE_SECTION_NARRATION_VERSION,
  buildArticleNarrationTracks,
} from "./section-narration";
import { getTtsMetadata, getTtsProfile } from "./tts-profile";

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

const edgeProfile = getTtsProfile("edge");
const openAiProfile = getTtsProfile("openai");
const openAiMetadata = getTtsMetadata(openAiProfile);

beforeEach(async () => {
  vi.resetModules();
  vi.unstubAllEnvs();
  vi.stubGlobal("window", {});
  vi.stubGlobal(
    "fetch",
    vi.fn().mockImplementation(
      async () =>
        new Response(new Blob(["audio-data"], { type: "audio/mpeg" }), {
          status: 200,
        }),
    ),
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
  it("fetches the article and requests its canonical summary from the server-owned route", async () => {
    const article = articleFixture();
    mockFetchArticle.mockResolvedValue(article);

    const result = await warmSummaryAudio(
      "Test_Article",
      mockFetchArticle,
      edgeProfile,
    );

    expect(result?.url).toBe(audioBlobUrl);
    expect(mockFetchArticle).toHaveBeenCalledWith({ slug: "Test_Article" });
    expect(fetch).toHaveBeenCalledWith(
      "/api/article/audio/section",
      expect.objectContaining({
        method: "POST",
        body: JSON.stringify({
          slug: "Test_Article",
          sectionKey: "summary",
          sourceHash: summarySourceHash(article),
          provider: "edge",
        }),
      }),
    );
  });

  it("isolates the same revision-bound summary by requested TTS profile", async () => {
    const [edgeResult, openAiResult] = await Promise.all([
      warmSummaryAudio("Profiled_Article", mockFetchArticle, edgeProfile),
      warmSummaryAudio("Profiled_Article", mockFetchArticle, openAiProfile),
    ]);

    expect(edgeResult?.metadata.provider).toBe("edge");
    expect(openAiResult?.metadata.provider).toBe("openai");
    expect(mockFetchArticle).toHaveBeenCalledTimes(1);
    expect(fetch).toHaveBeenCalledTimes(2);
    const providers = vi
      .mocked(fetch)
      .mock.calls.map(([, init]) => JSON.parse(String(init?.body)).provider);
    expect(providers).toEqual(["edge", "openai"]);
  });

  it("stores link-prefetched audio only under the canonical revision source hash", async () => {
    const article = articleFixture({
      title: "Revisioned Article",
      summary: "A canonical summary for this exact source revision.",
    });
    mockFetchArticle.mockResolvedValue(article);
    const sourceHash = summarySourceHash(article);

    await warmSummaryAudio("Revisioned_Article", mockFetchArticle, edgeProfile);

    expect(
      getCachedSummaryAudio("Revisioned_Article", edgeProfile, sourceHash)?.url,
    ).toBe(audioBlobUrl);
    expect(getCachedSummaryAudio("Revisioned_Article", edgeProfile)).toBeNull();
    expect(
      getCachedSummaryAudio(
        "Revisioned_Article",
        edgeProfile,
        "different-revision-hash",
      ),
    ).toBeNull();
  });

  it("populates getCachedSummaryUrl after completion", async () => {
    const article = articleFixture();
    const sourceHash = summarySourceHash(article);
    mockFetchArticle.mockResolvedValue(article);
    const pending = warmSummaryAudio(
      "Cached_Article",
      mockFetchArticle,
      edgeProfile,
    );

    expect(
      getCachedSummaryUrl("Cached_Article", edgeProfile, sourceHash),
    ).toBeNull();
    await pending;
    expect(getCachedSummaryUrl("Cached_Article", edgeProfile, sourceHash)).toBe(
      audioBlobUrl,
    );
  });

  it("deduplicates concurrent calls for the same profile and revision", async () => {
    await Promise.all([
      warmSummaryAudio("Dedup_Article", mockFetchArticle, edgeProfile),
      warmSummaryAudio("Dedup_Article", mockFetchArticle, edgeProfile),
      warmSummaryAudio("Dedup_Article", mockFetchArticle, edgeProfile),
    ]);

    expect(mockFetchArticle).toHaveBeenCalledTimes(1);
    expect(fetch).toHaveBeenCalledTimes(1);
  });

  it("uses a matching primed summary without calling the TTS endpoint", async () => {
    primeSummaryAudio(
      "Primed_Article",
      { url: primedAudioUrl, metadata: openAiMetadata },
      openAiProfile,
      "source-v1",
    );

    expect(
      await awaitSummaryAudio("Primed_Article", openAiProfile, "source-v1"),
    ).toBe(primedAudioUrl);
    expect(
      getCachedSummaryUrl("Primed_Article", openAiProfile, "source-v1"),
    ).toBe(primedAudioUrl);
    expect(
      getCachedSummaryAudio("Primed_Article", openAiProfile, "source-v1"),
    ).toEqual({ url: primedAudioUrl, metadata: openAiMetadata });
    expect(fetch).not.toHaveBeenCalled();
  });

  it("does not reuse primed audio across source hashes or providers", () => {
    primeSummaryAudio(
      "Revisioned_Article",
      { url: primedAudioUrl, metadata: openAiMetadata },
      openAiProfile,
      "source-v1",
    );

    expect(
      getCachedSummaryAudio("Revisioned_Article", openAiProfile, "source-v1")
        ?.url,
    ).toBe(primedAudioUrl);
    expect(
      getCachedSummaryAudio("Revisioned_Article", openAiProfile, "source-v2"),
    ).toBeNull();
    expect(
      getCachedSummaryAudio("Revisioned_Article", edgeProfile, "source-v1"),
    ).toBeNull();
    expect(
      getCachedSummaryAudio("Revisioned_Article", openAiProfile),
    ).toBeNull();
  });

  it("does not cache fallback metadata under the requested profile", () => {
    primeSummaryAudio(
      "Fallback_Article",
      {
        url: primedAudioUrl,
        metadata: getTtsMetadata(edgeProfile),
        fallbackReason: "openai_error",
      },
      openAiProfile,
      "source-v1",
    );

    expect(
      getCachedSummaryAudio("Fallback_Article", openAiProfile, "source-v1"),
    ).toBeNull();
  });

  it("returns null for whitespace-only summaries", async () => {
    mockFetchArticle.mockResolvedValue(articleFixture({ summary: "  \n  " }));

    await expect(
      warmSummaryAudio("Short_Article", mockFetchArticle, edgeProfile),
    ).resolves.toBeNull();
    expect(fetch).not.toHaveBeenCalled();
  });

  it("warms valid summaries shorter than ten characters", async () => {
    mockFetchArticle.mockResolvedValue(articleFixture({ summary: "Brief." }));

    await expect(
      warmSummaryAudio("Brief_Article", mockFetchArticle, edgeProfile),
    ).resolves.toMatchObject({ url: audioBlobUrl });
  });

  it("returns null when the article fetch fails", async () => {
    mockFetchArticle.mockRejectedValue(new Error("Network error"));

    await expect(
      warmSummaryAudio("Failing_Article", mockFetchArticle, edgeProfile),
    ).resolves.toBeNull();
  });

  it("clears failed warm attempts so the same revision can be retried", async () => {
    vi.mocked(fetch)
      .mockRejectedValueOnce(new Error("TTS unavailable"))
      .mockResolvedValueOnce(
        new Response(new Blob(["audio-data"], { type: "audio/mpeg" }), {
          status: 200,
        }),
      );

    await expect(
      warmSummaryAudio("Retry_Article", mockFetchArticle, edgeProfile),
    ).resolves.toBeNull();
    await expect(
      warmSummaryAudio("Retry_Article", mockFetchArticle, edgeProfile),
    ).resolves.toMatchObject({ url: audioBlobUrl });
    expect(fetch).toHaveBeenCalledTimes(2);
  });
});

describe("unknown summary entries", () => {
  it("return null from synchronous and asynchronous cache lookups", () => {
    expect(
      getCachedSummaryUrl("nonexistent", edgeProfile, "source-v1"),
    ).toBeNull();
    expect(
      awaitSummaryAudio("nonexistent", edgeProfile, "source-v1"),
    ).toBeNull();
  });
});
