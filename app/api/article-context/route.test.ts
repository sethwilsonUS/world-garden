import { beforeEach, describe, expect, it, vi } from "vitest";

const getPublishedArticleContext = vi.fn();

vi.mock("@/lib/article-context-persistence", () => ({
  getPublishedArticleContext,
}));

describe("POST /api/article-context", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("rejects malformed article identity without contacting Wikipedia", async () => {
    const { POST } = await import("./route");
    const response = await POST(
      new Request("http://localhost/api/article-context", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ wikiPageId: "bad", title: "Test", revisionId: "2" }),
      }) as never,
    );
    expect(response.status).toBe(400);
    expect(response.headers.get("cache-control")).toBe("no-store");
    expect(getPublishedArticleContext).not.toHaveBeenCalled();
  });

  it("returns the stable context response envelope", async () => {
    getPublishedArticleContext.mockResolvedValue({
      context: {
        schemaVersion: 1,
        wikiPageId: "1",
        title: "Test",
        revisionId: "2",
        language: "en",
        sourceHash: "abc",
        extractorVersion: "1.0.0",
        generatedAt: "2026-07-13T12:00:00.000Z",
        blocks: [],
      },
      cacheStatus: "miss",
    });
    const { POST } = await import("./route");
    const response = await POST(
      new Request("http://localhost/api/article-context", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ wikiPageId: "1", title: "Test", revisionId: "2" }),
      }) as never,
    );
    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toMatchObject({
      cacheStatus: "miss",
      context: { wikiPageId: "1", blocks: [] },
    });
  });
});
