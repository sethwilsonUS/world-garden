import { describe, it, expect, vi, beforeEach } from "vitest";

let warmSummaryAudio: typeof import("./audio-prefetch").warmSummaryAudio;
let getCachedSummaryUrl: typeof import("./audio-prefetch").getCachedSummaryUrl;
let getCachedSummaryAudio: typeof import("./audio-prefetch").getCachedSummaryAudio;
let awaitSummaryAudio: typeof import("./audio-prefetch").awaitSummaryAudio;
let primeSummaryAudio: typeof import("./audio-prefetch").primeSummaryAudio;

const mockFetchArticle = vi.fn();
const audioBlobUrl = "blob:http://localhost/fake-audio-url";
const primedAudioUrl = "https://storage.example/summary.mp3";
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

  vi.stubGlobal("window", {});

  const storage: Record<string, string> = {};
  vi.stubGlobal("localStorage", {
    getItem: (key: string) => storage[key] ?? null,
    setItem: (key: string, value: string) => { storage[key] = value; },
    removeItem: (key: string) => { delete storage[key]; },
  });

  vi.stubGlobal("fetch", vi.fn().mockResolvedValue({
    ok: true,
    blob: () => Promise.resolve(new Blob(["audio-data"], { type: "audio/mpeg" })),
  }));

  vi.spyOn(URL, "createObjectURL").mockReturnValue(audioBlobUrl);
  vi.spyOn(URL, "revokeObjectURL").mockImplementation(() => {});

  mockFetchArticle.mockReset();
  mockFetchArticle.mockResolvedValue({ summary: "This is a long enough summary for TTS generation." });

  const mod = await import("./audio-prefetch");
  warmSummaryAudio = mod.warmSummaryAudio;
  getCachedSummaryUrl = mod.getCachedSummaryUrl;
  getCachedSummaryAudio = mod.getCachedSummaryAudio;
  awaitSummaryAudio = mod.awaitSummaryAudio;
  primeSummaryAudio = mod.primeSummaryAudio;
});

describe("warmSummaryAudio", () => {
  it("fetches article and generates TTS audio", async () => {
    warmSummaryAudio("Test_Article", mockFetchArticle);

    const url = await awaitSummaryAudio("Test_Article");
    expect(url).toBe(audioBlobUrl);
    expect(mockFetchArticle).toHaveBeenCalledWith({ slug: "Test_Article" });
    expect(fetch).toHaveBeenCalledWith("/api/tts", expect.objectContaining({ method: "POST" }));
  });

  it("populates getCachedSummaryUrl after completion", async () => {
    warmSummaryAudio("Cached_Article", mockFetchArticle);
    expect(getCachedSummaryUrl("Cached_Article")).toBeNull();

    await awaitSummaryAudio("Cached_Article");
    expect(getCachedSummaryUrl("Cached_Article")).toBe(audioBlobUrl);
  });

  it("deduplicates concurrent calls for the same slug", async () => {
    warmSummaryAudio("Dedup_Article", mockFetchArticle);
    warmSummaryAudio("Dedup_Article", mockFetchArticle);
    warmSummaryAudio("Dedup_Article", mockFetchArticle);

    await awaitSummaryAudio("Dedup_Article");
    expect(mockFetchArticle).toHaveBeenCalledTimes(1);
  });

  it("uses a primed summary result without calling the TTS endpoint", async () => {
    primeSummaryAudio("Primed_Article", {
      url: primedAudioUrl,
      metadata,
    });

    const url = await awaitSummaryAudio("Primed_Article");

    expect(url).toBe(primedAudioUrl);
    expect(getCachedSummaryUrl("Primed_Article")).toBe(primedAudioUrl);
    expect(getCachedSummaryAudio("Primed_Article")).toEqual({
      url: primedAudioUrl,
      metadata,
    });
    expect(fetch).not.toHaveBeenCalled();
  });

  it("returns null for summaries that are too short", async () => {
    mockFetchArticle.mockResolvedValue({ summary: "Short" });

    warmSummaryAudio("Short_Article", mockFetchArticle);
    const url = await awaitSummaryAudio("Short_Article");
    expect(url).toBeNull();
  });

  it("returns null when fetch fails", async () => {
    mockFetchArticle.mockRejectedValue(new Error("Network error"));

    warmSummaryAudio("Failing_Article", mockFetchArticle);
    const url = await awaitSummaryAudio("Failing_Article");
    expect(url).toBeNull();
  });

  it("clears failed warm attempts so the same slug can be retried", async () => {
    vi.mocked(fetch)
      .mockRejectedValueOnce(new Error("TTS unavailable"))
      .mockResolvedValueOnce({
        ok: true,
        blob: () =>
          Promise.resolve(new Blob(["audio-data"], { type: "audio/mpeg" })),
      } as Response);

    warmSummaryAudio("Retry_Article", mockFetchArticle);
    expect(await awaitSummaryAudio("Retry_Article")).toBeNull();

    warmSummaryAudio("Retry_Article", mockFetchArticle);
    expect(await awaitSummaryAudio("Retry_Article")).toBe(audioBlobUrl);
    expect(fetch).toHaveBeenCalledTimes(2);
  });
});

describe("getCachedSummaryUrl", () => {
  it("returns null for unknown slugs", () => {
    expect(getCachedSummaryUrl("nonexistent")).toBeNull();
  });
});

describe("awaitSummaryAudio", () => {
  it("returns null for unknown slugs", () => {
    expect(awaitSummaryAudio("nonexistent")).toBeNull();
  });
});
