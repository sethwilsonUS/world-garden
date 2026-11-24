import { afterEach, describe, expect, it, vi } from "vitest";
import {
  filterSafeTitles,
  isDisambiguationPageProps,
  isUnsuitableForRandom,
  NSFW_FILTER_TIMEOUT_MS,
} from "./nsfw-filter";

describe("isDisambiguationPageProps & PageSafetySignals", () => {
  it("treats pageprops.disambiguation as a definitive disambiguation signal", () => {
    expect(isDisambiguationPageProps(undefined)).toBe(false);
    expect(isDisambiguationPageProps({})).toBe(false);
    expect(isDisambiguationPageProps({ disambiguation: "" })).toBe(true);
    expect(isDisambiguationPageProps({ disambiguation: true })).toBe(true);
    expect(
      isUnsuitableForRandom("Mercury", [], {
        pageprops: { disambiguation: "" },
      }),
    ).toBe(true);
  });

  it("enforces optional minByteLength when provided", () => {
    expect(
      isUnsuitableForRandom("Short stub", [], {
        byteLength: 1_200,
        minByteLength: 4_000,
      }),
    ).toBe(true);
    expect(
      isUnsuitableForRandom("Missing length", [], {
        minByteLength: 4_000,
      }),
    ).toBe(true);
    expect(
      isUnsuitableForRandom("Substantive article", [], {
        byteLength: 4_000,
        minByteLength: 4_000,
      }),
    ).toBe(false);
  });
});

describe("filterSafeTitles", () => {
  afterEach(() => {
    vi.useRealTimers();
    vi.restoreAllMocks();
  });

  it("requests visible categories, disambiguation pageprops, redirects, and formatversion=2", async () => {
    const fetchMock = vi.fn<typeof fetch>().mockImplementation(async (input) => {
      const url = new URL(String(input));
      expect(url.searchParams.get("formatversion")).toBe("2");
      expect(url.searchParams.get("prop")).toBe("categories|pageprops");
      expect(url.searchParams.get("clshow")).toBe("!hidden");
      expect(url.searchParams.get("cllimit")).toBe("max");
      expect(url.searchParams.get("ppprop")).toBe("disambiguation");
      expect(url.searchParams.get("redirects")).toBe("1");

      return new Response(
        JSON.stringify({
          batchcomplete: true,
          query: {
            pages: [
              {
                pageid: 974,
                ns: 0,
                title: "Ada Lovelace",
                categories: [{ title: "Category:English mathematicians" }],
              },
              {
                pageid: 19694,
                ns: 0,
                title: "Mercury",
                categories: [],
                pageprops: { disambiguation: "" },
              },
            ],
          },
        }),
      );
    });

    const safe = await filterSafeTitles(["Ada Lovelace", "Mercury"], {
      fetchImpl: fetchMock,
    });

    expect(safe.has("Ada Lovelace")).toBe(true);
    expect(safe.has("Mercury")).toBe(false);
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it("follows MediaWiki continue tokens so later pages in a batch cannot bypass NSFW filtering", async () => {
    const fetchMock = vi
      .fn<typeof fetch>()
      .mockResolvedValueOnce(
        new Response(
          JSON.stringify({
            continue: {
              clcontinue: "2|Category:Sexual_acts",
              continue: "||pageprops",
            },
            query: {
              pages: [
                {
                  pageid: 1,
                  ns: 0,
                  title: "Safe Article",
                  categories: [{ title: "Category:Physics" }],
                },
                {
                  pageid: 2,
                  ns: 0,
                  title: "Later Article",
                  // Truncated on the first response: zero categories returned yet.
                  categories: [],
                },
              ],
            },
          }),
        ),
      )
      .mockImplementationOnce(async (input) => {
        const url = new URL(String(input));
        expect(url.searchParams.get("clcontinue")).toBe("2|Category:Sexual_acts");
        expect(url.searchParams.get("continue")).toBe("||pageprops");

        return new Response(
          JSON.stringify({
            batchcomplete: true,
            query: {
              pages: [
                {
                  pageid: 1,
                  ns: 0,
                  title: "Safe Article",
                },
                {
                  pageid: 2,
                  ns: 0,
                  title: "Later Article",
                  categories: [{ title: "Category:Sexual acts" }],
                },
              ],
            },
          }),
        );
      });

    const safe = await filterSafeTitles(["Safe Article", "Later Article"], {
      fetchImpl: fetchMock,
    });

    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(safe.has("Safe Article")).toBe(true);
    expect(safe.has("Later Article")).toBe(false);
  });

  it("resolves normalized and redirected titles against their target article's safety metadata", async () => {
    const fetchMock = vi.fn<typeof fetch>().mockResolvedValue(
      new Response(
        JSON.stringify({
          batchcomplete: true,
          query: {
            normalized: [
              { from: "jfk", to: "Jfk" },
              { from: "safe_alias", to: "Safe alias" },
            ],
            redirects: [
              { from: "Jfk", to: "John F. Kennedy" },
              { from: "Safe alias", to: "Explicit Target" },
              { from: "Mercury (disambig)", to: "Mercury" },
            ],
            pages: [
              {
                pageid: 10,
                ns: 0,
                title: "John F. Kennedy",
                categories: [{ title: "Category:Presidents of the United States" }],
              },
              {
                pageid: 11,
                ns: 0,
                title: "Explicit Target",
                categories: [{ title: "Category:BDSM" }],
              },
              {
                pageid: 12,
                ns: 0,
                title: "Mercury",
                categories: [],
                pageprops: { disambiguation: "" },
              },
            ],
          },
        }),
      ),
    );

    const safe = await filterSafeTitles(
      ["jfk", "safe_alias", "Mercury (disambig)"],
      { fetchImpl: fetchMock },
    );

    expect(safe.has("jfk")).toBe(true);
    expect(safe.has("John F. Kennedy")).toBe(true);
    expect(safe.has("safe_alias")).toBe(false);
    expect(safe.has("Explicit Target")).toBe(false);
    expect(safe.has("Mercury (disambig)")).toBe(false);
  });

  it("cancels rejected response bodies and fails open on upstream HTTP errors", async () => {
    let bodyCancelled = false;
    const stream = new ReadableStream<Uint8Array>({
      start(controller) {
        controller.enqueue(new TextEncoder().encode("rate limited"));
      },
      cancel() {
        bodyCancelled = true;
      },
    });
    const fetchMock = vi
      .fn<typeof fetch>()
      .mockResolvedValue(new Response(stream, { status: 429 }));

    const safe = await filterSafeTitles(["Ada Lovelace"], {
      fetchImpl: fetchMock,
    });

    expect(bodyCancelled).toBe(true);
    expect(safe.has("Ada Lovelace")).toBe(true);
  });

  it("fails open when a batch request times out", async () => {
    vi.useFakeTimers();
    const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});
    const fetchMock = vi.fn<typeof fetch>().mockImplementation(
      async (_input, init) =>
        await new Promise<Response>((_resolve, reject) => {
          init?.signal?.addEventListener("abort", () =>
            reject(new DOMException("Aborted", "AbortError")),
          );
        }),
    );

    const pending = filterSafeTitles(["Slow Article"], {
      fetchImpl: fetchMock,
    });
    await vi.advanceTimersByTimeAsync(NSFW_FILTER_TIMEOUT_MS);

    const safe = await pending;
    expect(safe.has("Slow Article")).toBe(true);
    warnSpy.mockRestore();
  });

  it("preserves confirmed rejections and does not admit unverified titles when a continuation fails or times out", async () => {
    const httpErrorMock = vi
      .fn<typeof fetch>()
      .mockResolvedValueOnce(
        new Response(
          JSON.stringify({
            continue: {
              clcontinue: "2|Category:More",
              continue: "||pageprops",
            },
            query: {
              pages: [
                {
                  pageid: 1,
                  ns: 0,
                  title: "Explicit Article",
                  categories: [{ title: "Category:BDSM" }],
                },
                {
                  pageid: 2,
                  ns: 0,
                  title: "Unfinished Article",
                  categories: [{ title: "Category:Science" }],
                },
              ],
            },
          }),
        ),
      )
      .mockResolvedValueOnce(new Response("upstream unavailable", { status: 503 }));

    const afterHttpError = await filterSafeTitles(
      ["Explicit Article", "Unfinished Article"],
      { fetchImpl: httpErrorMock },
    );

    expect(afterHttpError.has("Explicit Article")).toBe(false);
    expect(afterHttpError.has("Unfinished Article")).toBe(false);

    vi.useFakeTimers();
    const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});
    const timeoutMock = vi
      .fn<typeof fetch>()
      .mockResolvedValueOnce(
        new Response(
          JSON.stringify({
            continue: {
              clcontinue: "2|Category:More",
              continue: "||pageprops",
            },
            query: {
              pages: [
                {
                  pageid: 1,
                  ns: 0,
                  title: "Explicit Article",
                  categories: [{ title: "Category:BDSM" }],
                },
                {
                  pageid: 2,
                  ns: 0,
                  title: "Unfinished Article",
                  categories: [],
                },
              ],
            },
          }),
        ),
      )
      .mockImplementationOnce(
        async (_input, init) =>
          await new Promise<Response>((_resolve, reject) => {
            init?.signal?.addEventListener("abort", () =>
              reject(new DOMException("Aborted", "AbortError")),
            );
          }),
      );

    const pendingTimeout = filterSafeTitles(
      ["Explicit Article", "Unfinished Article"],
      { fetchImpl: timeoutMock },
    );
    await vi.advanceTimersByTimeAsync(NSFW_FILTER_TIMEOUT_MS);

    const afterTimeout = await pendingTimeout;
    expect(afterTimeout.has("Explicit Article")).toBe(false);
    expect(afterTimeout.has("Unfinished Article")).toBe(false);
    warnSpy.mockRestore();
  });

  it("retries unverified titles in smaller batches and omits titles whose continuations never complete or repeat", async () => {
    const requestedTitleSets: string[] = [];
    const fetchMock = vi.fn<typeof fetch>().mockImplementation(async (input) => {
      const url = new URL(String(input));
      const titlesParam = url.searchParams.get("titles") ?? "";
      requestedTitleSets.push(titlesParam);

      // The combined batch repeats a clcontinue token after rejecting Explicit Article.
      if (titlesParam.includes("|")) {
        return new Response(
          JSON.stringify({
            continue: {
              clcontinue: "3|Category:Loop",
              continue: "||pageprops",
            },
            query: {
              pages: [
                {
                  pageid: 1,
                  ns: 0,
                  title: "Safe Article",
                  categories: [{ title: "Category:Physics" }],
                },
                {
                  pageid: 2,
                  ns: 0,
                  title: "Explicit Article",
                  categories: [{ title: "Category:BDSM" }],
                },
                {
                  pageid: 3,
                  ns: 0,
                  title: "Truncated Article",
                  categories: [],
                },
              ],
            },
          }),
        );
      }

      if (titlesParam === "Safe Article") {
        return new Response(
          JSON.stringify({
            batchcomplete: true,
            query: {
              pages: [
                {
                  pageid: 1,
                  ns: 0,
                  title: "Safe Article",
                  categories: [{ title: "Category:Physics" }],
                },
              ],
            },
          }),
        );
      }

      // Single-title query for Truncated Article still never finishes (exhausts continuations).
      const step = requestedTitleSets.filter((t) => t === titlesParam).length;
      return new Response(
        JSON.stringify({
          continue: {
            clcontinue: `3|Category:Page_${step}`,
            continue: "||pageprops",
          },
          query: {
            pages: [
              {
                pageid: 3,
                ns: 0,
                title: "Truncated Article",
                categories: [{ title: `Category:Tag ${step}` }],
              },
            ],
          },
        }),
      );
    });

    const safe = await filterSafeTitles(
      ["Safe Article", "Explicit Article", "Truncated Article"],
      { fetchImpl: fetchMock },
    );

    expect(safe.has("Safe Article")).toBe(true);
    expect(safe.has("Explicit Article")).toBe(false);
    expect(safe.has("Truncated Article")).toBe(false);
    // Confirmed unsuitable title is never retried in a smaller batch.
    expect(requestedTitleSets).not.toContain("Explicit Article");
  });
});
