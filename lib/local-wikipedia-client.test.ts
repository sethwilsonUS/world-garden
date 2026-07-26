import { afterEach, describe, expect, it, vi } from "vitest";
import {
  requestLocalWikipedia,
  requestLocalWikipediaMetadata,
  resetLocalWikipediaClientCachesForTests,
} from "./local-wikipedia-client";

afterEach(() => {
  resetLocalWikipediaClientCachesForTests();
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

  it("rejects a non-JSON response with a safe client error", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValue(
      new Response("<html>Upstream proxy error</html>", {
        status: 502,
        headers: { "Content-Type": "text/html" },
      }),
    );

    await expect(
      requestLocalWikipedia({ operation: "search", term: "Landor" }),
    ).rejects.toThrow("Local Wikipedia request failed");
  });

  it("deduplicates metadata work without one caller's abort poisoning another", async () => {
    let finishRequest: ((response: Response) => void) | undefined;
    const fetchSpy = vi.spyOn(globalThis, "fetch").mockImplementation(
      () =>
        new Promise<Response>((resolve) => {
          finishRequest = resolve;
        }),
    );
    const identity = {
      wikiPageId: "8842",
      revisionId: "7711",
      title: "Shared metadata",
      language: "en",
    } as const;
    const firstController = new AbortController();
    const secondController = new AbortController();

    const first = requestLocalWikipediaMetadata(
      identity,
      firstController.signal,
    );
    const second = requestLocalWikipediaMetadata(
      identity,
      secondController.signal,
    );
    firstController.abort();

    await expect(first).rejects.toMatchObject({ name: "AbortError" });
    finishRequest?.(
      new Response(
        JSON.stringify({
          data: {
            linkCounts: [],
            citations: [],
            sectionCitations: [],
            sectionIndexMap: [],
            images: [],
          },
        }),
        {
          status: 200,
          headers: { "Content-Type": "application/json" },
        },
      ),
    );

    await expect(second).resolves.toMatchObject({ images: [] });
    await expect(
      requestLocalWikipediaMetadata(identity),
    ).resolves.toMatchObject({ images: [] });
    expect(fetchSpy).toHaveBeenCalledTimes(1);
    expect(fetchSpy.mock.calls[0]?.[1]).not.toHaveProperty("signal");
  });

  it("allows tests to clear completed metadata cache entries deterministically", async () => {
    const fetchSpy = vi.spyOn(globalThis, "fetch").mockImplementation(
      async () =>
        new Response(
          JSON.stringify({
            data: {
              linkCounts: [],
              citations: [],
              sectionCitations: [],
              sectionIndexMap: [],
              images: [],
            },
          }),
          { status: 200, headers: { "Content-Type": "application/json" } },
        ),
    );
    const identity = {
      wikiPageId: "701",
      revisionId: "702",
      title: "Cache reset",
      language: "en",
    } as const;

    await requestLocalWikipediaMetadata(identity);
    await requestLocalWikipediaMetadata(identity);
    expect(fetchSpy).toHaveBeenCalledTimes(1);

    resetLocalWikipediaClientCachesForTests();
    await requestLocalWikipediaMetadata(identity);
    expect(fetchSpy).toHaveBeenCalledTimes(2);
  });

  it("does not let a pre-reset request repopulate the cleared metadata cache", async () => {
    let finishFirstRequest: ((response: Response) => void) | undefined;
    const metadata = {
      linkCounts: [],
      citations: [],
      sectionCitations: [],
      sectionIndexMap: [],
      images: [],
    };
    const response = () =>
      new Response(JSON.stringify({ data: metadata }), {
        status: 200,
        headers: { "Content-Type": "application/json" },
      });
    const fetchSpy = vi
      .spyOn(globalThis, "fetch")
      .mockImplementationOnce(
        () =>
          new Promise<Response>((resolve) => {
            finishFirstRequest = resolve;
          }),
      )
      .mockImplementationOnce(async () => response());
    const identity = {
      wikiPageId: "7701",
      revisionId: "7702",
      title: "In-flight cache reset",
      language: "en",
    } as const;

    const preResetRequest = requestLocalWikipediaMetadata(identity);
    resetLocalWikipediaClientCachesForTests();
    finishFirstRequest?.(response());
    await expect(preResetRequest).resolves.toEqual(metadata);

    await expect(requestLocalWikipediaMetadata(identity)).resolves.toEqual(
      metadata,
    );
    expect(fetchSpy).toHaveBeenCalledTimes(2);
  });

  it("deduplicates only canonical, complete metadata identities", async () => {
    const fetchSpy = vi.spyOn(globalThis, "fetch").mockImplementation(
      async () =>
        new Response(
          JSON.stringify({
            data: {
              linkCounts: [],
              citations: [],
              sectionCitations: [],
              sectionIndexMap: [],
              images: [],
            },
          }),
          { status: 200, headers: { "Content-Type": "application/json" } },
        ),
    );
    const identity = {
      wikiPageId: "9911",
      revisionId: "8811",
      title: "Canonical title",
      language: "en",
    } as const;

    await requestLocalWikipediaMetadata({
      ...identity,
      wikiPageId: "0009911",
      revisionId: "0008811",
      title: "Canonical_title",
      language: "EN",
    });
    await requestLocalWikipediaMetadata(identity);
    await requestLocalWikipediaMetadata({
      ...identity,
      title: "Different title",
    });

    expect(fetchSpy).toHaveBeenCalledTimes(2);
  });
});
