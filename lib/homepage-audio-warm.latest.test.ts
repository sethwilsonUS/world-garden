import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const getTodayWikipediaData = vi.fn();

vi.mock("./today-snapshot", () => ({ getTodayWikipediaData }));

describe("warmLatestHomepageArticleSummaries", () => {
  beforeEach(() => {
    vi.resetModules();
    vi.clearAllMocks();
    vi.unstubAllEnvs();
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.unstubAllGlobals();
    vi.unstubAllEnvs();
  });

  it("returns disabled without reading a snapshot", async () => {
    vi.stubEnv("HOMEPAGE_AUDIO_WARM_ENABLED", "false");
    const { warmLatestHomepageArticleSummaries } =
      await import("./homepage-audio-warm");

    const result = await warmLatestHomepageArticleSummaries({
      baseUrl: "https://curiogarden.org",
    });

    expect(result.status).toBe("disabled");
    expect(getTodayWikipediaData).not.toHaveBeenCalled();
  });

  it("returns missing_snapshot without generating competing live data", async () => {
    vi.stubEnv("HOMEPAGE_AUDIO_WARM_ENABLED", "true");
    getTodayWikipediaData.mockResolvedValue(null);
    const { warmLatestHomepageArticleSummaries } =
      await import("./homepage-audio-warm");

    const result = await warmLatestHomepageArticleSummaries({
      baseUrl: "https://curiogarden.org",
    });

    expect(result.status).toBe("missing_snapshot");
    expect(getTodayWikipediaData).toHaveBeenCalledWith({
      allowLiveFallback: false,
      signal: expect.any(AbortSignal),
    });
  });

  it("includes a stalled snapshot lookup in the deadline", async () => {
    vi.useFakeTimers();
    vi.stubEnv("HOMEPAGE_AUDIO_WARM_ENABLED", "true");
    getTodayWikipediaData.mockImplementationOnce(() => new Promise(() => {}));
    const { warmLatestHomepageArticleSummaries } =
      await import("./homepage-audio-warm");
    const pending = warmLatestHomepageArticleSummaries({
      baseUrl: "https://curiogarden.org",
      deadlineMs: 100,
    });
    await vi.advanceTimersByTimeAsync(100);
    expect(await pending).toMatchObject({
      status: "partial",
      deadlineExceeded: true,
      generated: 0,
    });
    expect(getTodayWikipediaData.mock.calls[0][0].signal.aborted).toBe(true);
    expect(vi.getTimerCount()).toBe(0);
  });

  it("uses only the remaining budget after the snapshot arrives", async () => {
    vi.useFakeTimers();
    vi.stubEnv("HOMEPAGE_AUDIO_WARM_ENABLED", "true");
    vi.stubEnv("NEXT_PUBLIC_CONVEX_URL", "https://test.convex.cloud");
    getTodayWikipediaData.mockImplementationOnce(
      () =>
        new Promise((resolve) =>
          setTimeout(
            () =>
              resolve({
                tfa: { title: "One", wikiPageId: "1" },
                trending: [],
                didYouKnow: [],
                inTheNews: [],
                onThisDay: [],
              }),
            75,
          ),
        ),
    );
    let requestSignal: AbortSignal | undefined;
    vi.stubGlobal(
      "fetch",
      vi.fn((_url, init) => {
        requestSignal = init.signal;
        return new Promise<Response>(() => {});
      }),
    );
    const { warmLatestHomepageArticleSummaries } =
      await import("./homepage-audio-warm");
    const pending = warmLatestHomepageArticleSummaries({
      baseUrl: "https://curiogarden.org",
      deadlineMs: 100,
    });
    await vi.advanceTimersByTimeAsync(100);
    expect(await pending).toMatchObject({
      status: "partial",
      targets: 1,
      deadlineSkipped: 1,
      deadlineExceeded: true,
    });
    expect(requestSignal?.aborted).toBe(true);
    expect(vi.getTimerCount()).toBe(0);
  });
});
