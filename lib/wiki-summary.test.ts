import { describe, it, expect, vi } from "vitest";
import { slugToTitle, truncateText, fetchWikiSummary } from "./wiki-summary";

describe("slugToTitle", () => {
  it("replaces underscores with spaces", () => {
    expect(slugToTitle("United_States")).toBe("United States");
  });

  it("handles single-word slugs", () => {
    expect(slugToTitle("Python")).toBe("Python");
  });

  it("handles multiple consecutive underscores", () => {
    expect(slugToTitle("New__York")).toBe("New  York");
  });

  it("returns empty string for empty input", () => {
    expect(slugToTitle("")).toBe("");
  });

  it("decodes percent-encoded characters", () => {
    expect(slugToTitle("S%C3%A3o_Paulo")).toBe("São Paulo");
  });

  it("decodes encoded spaces (%20) and underscores", () => {
    expect(slugToTitle("Hello%20World_Test")).toBe("Hello World Test");
  });
});

describe("truncateText", () => {
  it("returns short text unchanged", () => {
    expect(truncateText("Hello", 10)).toBe("Hello");
  });

  it("returns text exactly at maxLength unchanged", () => {
    expect(truncateText("Hello", 5)).toBe("Hello");
  });

  it("truncates at word boundary when possible", () => {
    const result = truncateText("The quick brown fox jumps", 15);
    expect(result).toBe("The quick\u2026");
    expect(result.length).toBeLessThanOrEqual(16);
  });

  it("truncates at maxLength when no suitable word boundary exists", () => {
    const result = truncateText("Supercalifragilisticexpialidocious rocks", 10);
    expect(result).toBe("Supercalif\u2026");
  });

  it("uses word boundary when it is in the latter half of the text", () => {
    const result = truncateText("Hello wonderful world of testing", 20);
    expect(result).toBe("Hello wonderful\u2026");
  });

  it("handles empty string", () => {
    expect(truncateText("", 10)).toBe("");
  });

  it("handles single-word text exceeding maxLength", () => {
    const result = truncateText("Pneumonoultramicroscopicsilicovolcanoconiosis", 20);
    expect(result).toBe("Pneumonoultramicrosc\u2026");
  });
});

describe("fetchWikiSummary", () => {
  it("returns parsed summary on success", async () => {
    const mockData = {
      title: "Albert Einstein",
      extract: "Albert Einstein was a German-born theoretical physicist.",
      thumbnail: { source: "https://upload.wikimedia.org/thumb.jpg" },
    };

    vi.spyOn(globalThis, "fetch").mockResolvedValueOnce({
      ok: true,
      json: () => Promise.resolve(mockData),
    } as Response);

    const result = await fetchWikiSummary("Albert_Einstein");
    expect(result).toEqual({
      title: "Albert Einstein",
      extract: "Albert Einstein was a German-born theoretical physicist.",
      thumbnailUrl: "https://upload.wikimedia.org/thumb.jpg",
    });
  });

  it("returns null on non-ok response", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValueOnce({
      ok: false,
      status: 404,
    } as Response);

    const result = await fetchWikiSummary("Nonexistent_Page_12345");
    expect(result).toBeNull();
  });

  it("returns null on network error", async () => {
    vi.spyOn(globalThis, "fetch").mockRejectedValueOnce(
      new Error("Network failure"),
    );

    const result = await fetchWikiSummary("Some_Article");
    expect(result).toBeNull();
  });

  it("handles missing thumbnail gracefully", async () => {
    const mockData = {
      title: "Some Topic",
      extract: "A topic without an image.",
    };

    vi.spyOn(globalThis, "fetch").mockResolvedValueOnce({
      ok: true,
      json: () => Promise.resolve(mockData),
    } as Response);

    const result = await fetchWikiSummary("Some_Topic");
    expect(result).toEqual({
      title: "Some Topic",
      extract: "A topic without an image.",
      thumbnailUrl: undefined,
    });
  });

  it("calls the correct Wikipedia REST API endpoint", async () => {
    const fetchSpy = vi.spyOn(globalThis, "fetch").mockResolvedValueOnce({
      ok: true,
      json: () => Promise.resolve({ title: "Test", extract: "" }),
    } as Response);

    await fetchWikiSummary("Albert_Einstein");

    expect(fetchSpy).toHaveBeenCalledWith(
      "https://en.wikipedia.org/api/rest_v1/page/summary/Albert%20Einstein",
      expect.objectContaining({
        headers: expect.objectContaining({ "User-Agent": expect.any(String) }),
      }),
    );
  });
});
