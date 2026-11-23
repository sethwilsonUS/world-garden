import { afterEach, describe, expect, it, vi } from "vitest";
import {
  fetchSafeRandomArticle,
  MIN_RANDOM_ARTICLE_BYTES,
  RANDOM_ARTICLE_API_USER_AGENT,
  RANDOM_ARTICLE_TIMEOUT_MS,
} from "./random-article";

describe("fetchSafeRandomArticle", () => {
  afterEach(() => {
    vi.useRealTimers();
    vi.restoreAllMocks();
  });

  it("fetches non-redirect random candidates with categories, pageprops, info, and Api-User-Agent in one request", async () => {
    const fetchMock = vi.fn<typeof fetch>().mockImplementation(async (input, init) => {
      const url = new URL(String(input));
      expect(url.searchParams.get("action")).toBe("query");
      expect(url.searchParams.get("formatversion")).toBe("2");
      expect(url.searchParams.get("generator")).toBe("random");
      expect(url.searchParams.get("grnnamespace")).toBe("0");
      expect(url.searchParams.get("grnfilterredir")).toBe("nonredirects");
      expect(url.searchParams.get("prop")).toBe("categories|pageprops|info");
      expect(url.searchParams.get("clshow")).toBe("!hidden");
      expect(url.searchParams.get("cllimit")).toBe("max");
      expect(url.searchParams.get("ppprop")).toBe("disambiguation");
      expect(url.searchParams.get("origin")).toBe("*");
      expect(init?.headers).toEqual(
        expect.objectContaining({
          "Api-User-Agent": RANDOM_ARTICLE_API_USER_AGENT,
        }),
      );

      return new Response(
        JSON.stringify({
          batchcomplete: true,
          // MediaWiki always emits grncontinue with generator=random; we must
          // NOT follow it once batchcomplete is true.
          continue: {
            grncontinue: "0.1|0.2|999|0",
            continue: "grncontinue||",
          },
          query: {
            pages: [
              {
                pageid: 1,
                ns: 0,
                title: "Ada Lovelace",
                length: 12_500,
                categories: [{ title: "Category:English mathematicians" }],
              },
            ],
          },
        }),
      );
    });

    const title = await fetchSafeRandomArticle(2, { fetchImpl: fetchMock });

    expect(title).toBe("Ada Lovelace");
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it("skips stubs, pageprops disambiguations, list pages, and NSFW articles across continuation pages", async () => {
    const fetchMock = vi
      .fn<typeof fetch>()
      .mockResolvedValueOnce(
        new Response(
          JSON.stringify({
            continue: {
              clcontinue: "104|Category:Sexual_acts",
              grncontinue: "0.3|0.3|0|0",
              continue: "grncontinue||pageprops|info",
            },
            query: {
              pages: [
                {
                  pageid: 101,
                  ns: 0,
                  title: "Tiny Village Stub",
                  length: MIN_RANDOM_ARTICLE_BYTES - 1,
                  categories: [{ title: "Category:Villages" }],
                },
                {
                  pageid: 102,
                  ns: 0,
                  title: "Mercury",
                  length: 9_000,
                  categories: [],
                  pageprops: { disambiguation: "" },
                },
                {
                  pageid: 103,
                  ns: 0,
                  title: "List of lighthouses",
                  length: 15_000,
                  categories: [{ title: "Category:Lighthouses" }],
                },
                {
                  pageid: 104,
                  ns: 0,
                  title: "Truncated NSFW Article",
                  length: 10_000,
                  // Zero categories in page 1; NSFW category arrives in page 2.
                  categories: [],
                },
                {
                  pageid: 105,
                  ns: 0,
                  title: "Voyager Golden Record",
                  length: 18_400,
                  categories: [],
                },
              ],
            },
          }),
        ),
      )
      .mockImplementationOnce(async (input) => {
        const url = new URL(String(input));
        expect(url.searchParams.get("clcontinue")).toBe("104|Category:Sexual_acts");
        expect(url.searchParams.get("grncontinue")).toBe("0.3|0.3|0|0");

        return new Response(
          JSON.stringify({
            batchcomplete: true,
            query: {
              pages: [
                {
                  pageid: 104,
                  ns: 0,
                  title: "Truncated NSFW Article",
                  categories: [{ title: "Category:Sexual acts" }],
                },
                {
                  pageid: 105,
                  ns: 0,
                  title: "Voyager Golden Record",
                  categories: [{ title: "Category:Voyager program" }],
                },
              ],
            },
          }),
        );
      });

    const title = await fetchSafeRandomArticle(2, { fetchImpl: fetchMock });

    expect(title).toBe("Voyager Golden Record");
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it("retries when an attempt returns only stubs and throws if all attempts are unsuitable", async () => {
    const stubOnlyResponse = () =>
      new Response(
        JSON.stringify({
          batchcomplete: true,
          query: {
            pages: [
              {
                pageid: 201,
                ns: 0,
                title: "Short Stub",
                length: 1_500,
                categories: [{ title: "Category:Geography" }],
              },
            ],
          },
        }),
      );

    const retryMock = vi
      .fn<typeof fetch>()
      .mockResolvedValueOnce(stubOnlyResponse())
      .mockResolvedValueOnce(
        new Response(
          JSON.stringify({
            batchcomplete: true,
            query: {
              pages: [
                {
                  pageid: 202,
                  ns: 0,
                  title: "Rosetta Stone",
                  length: 25_000,
                  categories: [{ title: "Category:Ancient Egypt" }],
                },
              ],
            },
          }),
        ),
      );

    await expect(
      fetchSafeRandomArticle(2, { fetchImpl: retryMock }),
    ).resolves.toBe("Rosetta Stone");
    expect(retryMock).toHaveBeenCalledTimes(2);

    const allStubsMock = vi
      .fn<typeof fetch>()
      .mockImplementation(async () => stubOnlyResponse());

    await expect(
      fetchSafeRandomArticle(2, { fetchImpl: allStubsMock }),
    ).rejects.toThrow("Could not find a suitable article");
    expect(allStubsMock).toHaveBeenCalledTimes(2);
  });

  it("cancels rejected response bodies on HTTP errors and aborts on timeout", async () => {
    let bodyCancelled = false;
    const stream = new ReadableStream<Uint8Array>({
      start(controller) {
        controller.enqueue(new TextEncoder().encode("error"));
      },
      cancel() {
        bodyCancelled = true;
      },
    });
    const errorMock = vi
      .fn<typeof fetch>()
      .mockResolvedValue(new Response(stream, { status: 503 }));

    await expect(
      fetchSafeRandomArticle(1, { fetchImpl: errorMock }),
    ).rejects.toThrow("Failed to fetch random articles (503)");
    expect(bodyCancelled).toBe(true);

    vi.useFakeTimers();
    const timeoutMock = vi.fn<typeof fetch>().mockImplementation(
      async (_input, init) =>
        await new Promise<Response>((_resolve, reject) => {
          init?.signal?.addEventListener("abort", () =>
            reject(new DOMException("Aborted", "AbortError")),
          );
        }),
    );

    const pending = fetchSafeRandomArticle(1, { fetchImpl: timeoutMock });
    const expectation = expect(pending).rejects.toThrow("Aborted");
    await vi.advanceTimersByTimeAsync(RANDOM_ARTICLE_TIMEOUT_MS);
    await expectation;
  });
});
