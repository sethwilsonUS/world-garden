import { afterEach, describe, expect, it, vi } from "vitest";
import { requestLocalWikipedia } from "./local-wikipedia-client";

afterEach(() => {
  vi.restoreAllMocks();
});

describe("requestLocalWikipedia", () => {
  it("posts the complete revision identity to the server handler", async () => {
    const fetchSpy = vi.spyOn(globalThis, "fetch").mockResolvedValue(
      new Response(JSON.stringify({ data: { images: [] } }), {
        status: 200,
        headers: { "Content-Type": "application/json" },
      }),
    );
    const controller = new AbortController();
    const request = {
      operation: "metadata" as const,
      identity: {
        wikiPageId: "42",
        revisionId: "99",
        title: "Test article",
        language: "en",
      },
    };

    await requestLocalWikipedia(request, controller.signal);

    expect(fetchSpy).toHaveBeenCalledWith("/api/local-wikipedia", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(request),
      signal: controller.signal,
    });
  });

  it("surfaces the server's safe error message", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValue(
      new Response(JSON.stringify({ error: "Wikipedia is unavailable" }), {
        status: 502,
        headers: { "Content-Type": "application/json" },
      }),
    );

    await expect(
      requestLocalWikipedia({ operation: "search", term: "Landor" }),
    ).rejects.toThrow("Wikipedia is unavailable");
  });
});
