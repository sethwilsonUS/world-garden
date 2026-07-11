import { beforeEach, describe, expect, it, vi } from "vitest";

const getTodayWikipediaData = vi.fn();

vi.mock("./today-snapshot", () => ({ getTodayWikipediaData }));

describe("warmLatestHomepageArticleSummaries", () => {
  beforeEach(() => {
    vi.resetModules();
    vi.clearAllMocks();
    vi.unstubAllEnvs();
  });

  it("returns disabled without reading a snapshot", async () => {
    vi.stubEnv("HOMEPAGE_AUDIO_WARM_ENABLED", "false");
    const { warmLatestHomepageArticleSummaries } = await import(
      "./homepage-audio-warm"
    );

    const result = await warmLatestHomepageArticleSummaries({
      baseUrl: "https://curiogarden.org",
    });

    expect(result.status).toBe("disabled");
    expect(getTodayWikipediaData).not.toHaveBeenCalled();
  });

  it("returns missing_snapshot without generating competing live data", async () => {
    vi.stubEnv("HOMEPAGE_AUDIO_WARM_ENABLED", "true");
    getTodayWikipediaData.mockResolvedValue(null);
    const { warmLatestHomepageArticleSummaries } = await import(
      "./homepage-audio-warm"
    );

    const result = await warmLatestHomepageArticleSummaries({
      baseUrl: "https://curiogarden.org",
    });

    expect(result.status).toBe("missing_snapshot");
    expect(getTodayWikipediaData).toHaveBeenCalledWith({
      allowLiveFallback: false,
    });
  });
});
