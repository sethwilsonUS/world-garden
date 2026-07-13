import { afterEach, describe, expect, it, vi } from "vitest";
import {
  fetchWikimediaMediaDetails,
  fetchWikimediaMediaAttributions,
  getWikimediaFileTitleFromUrl,
  getWikimediaMediaRepositoryFromUrl,
  WIKIMEDIA_MEDIA_TIMEOUT_MS,
} from "./wikimedia-media";

describe("Wikimedia media attribution", () => {
  afterEach(() => {
    vi.useRealTimers();
  });

  it("derives file titles from thumbnail and original URLs", () => {
    expect(
      getWikimediaFileTitleFromUrl(
        "https://upload.wikimedia.org/wikipedia/commons/thumb/d/d6/Stonehenge_Lucas_de_Heere.jpg/330px-Stonehenge_Lucas_de_Heere.jpg",
      ),
    ).toBe("File:Stonehenge Lucas de Heere.jpg");
    expect(
      getWikimediaFileTitleFromUrl(
        "https://upload.wikimedia.org/wikipedia/commons/d/d6/Stonehenge_Lucas_de_Heere.jpg",
      ),
    ).toBe("File:Stonehenge Lucas de Heere.jpg");
  });

  it("identifies Commons and English-Wikipedia-local upload paths", () => {
    expect(
      getWikimediaMediaRepositoryFromUrl(
        "https://upload.wikimedia.org/wikipedia/commons/a/ab/Example.jpg",
      ),
    ).toBe("commons");
    expect(
      getWikimediaMediaRepositoryFromUrl(
        "https://upload.wikimedia.org/wikipedia/en/a/ab/Poster.jpg",
      ),
    ).toBe("enwiki");
  });

  it("normalizes imageinfo metadata and keeps a source fallback", async () => {
    const fetchMock = vi.fn<typeof fetch>().mockImplementation(async (input) => {
      const url = new URL(String(input));
      expect(url.hostname).toBe("commons.wikimedia.org");
      expect(url.pathname).toBe("/w/api.php");
      expect(url.searchParams.get("prop")).toBe("imageinfo");
      expect(url.searchParams.get("iiprop")).toBe("url|extmetadata");
      expect(url.searchParams.get("titles")).toBe(
        "File:Example.jpg|File:Missing.jpg",
      );

      return new Response(
        JSON.stringify({
          query: {
            pages: {
              "1": {
                title: "File:Example.jpg",
                imageinfo: [
                  {
                    descriptionurl: "https://commons.wikimedia.org/wiki/File:Example.jpg",
                    extmetadata: {
                      Artist: { value: "<b>Ada Example</b>" },
                      Credit: { value: "Own &amp; collaborative work" },
                      LicenseShortName: { value: "CC BY-SA 4.0" },
                      LicenseUrl: {
                        value: "https://creativecommons.org/licenses/by-sa/4.0/",
                      },
                    },
                  },
                ],
              },
            },
          },
        }),
        { status: 200 },
      );
    });

    const result = await fetchWikimediaMediaAttributions(
      ["File:Example.jpg", "File:Missing.jpg"],
      fetchMock,
    );

    expect(result.get("File:Example.jpg")).toMatchObject({
      creator: "Ada Example",
      credit: "Own & collaborative work",
      licenseName: "CC BY-SA 4.0",
      sourceUrl: "https://commons.wikimedia.org/wiki/File:Example.jpg",
    });
    expect(result.get("File:Missing.jpg")?.sourceUrl).toContain(
      "commons.wikimedia.org/wiki/File%3AMissing.jpg",
    );
  });

  it("keeps Credit separate when Artist metadata is missing", async () => {
    const fetchMock = vi.fn<typeof fetch>().mockResolvedValue(
      new Response(
        JSON.stringify({
          query: {
            pages: {
              "1": {
                title: "File:Credit only.jpg",
                imageinfo: [
                  {
                    extmetadata: {
                      Credit: { value: "Museum archive scan" },
                    },
                  },
                ],
              },
            },
          },
        }),
      ),
    );

    const result = await fetchWikimediaMediaAttributions(
      ["File:Credit only.jpg"],
      fetchMock,
    );

    expect(result.get("File:Credit only.jpg")).toMatchObject({
      credit: "Museum archive scan",
    });
    expect(result.get("File:Credit only.jpg")?.creator).toBeUndefined();
  });

  it("aborts stalled Commons metadata requests and preserves fallbacks", async () => {
    vi.useFakeTimers();
    const fetchMock = vi.fn<typeof fetch>().mockImplementation(
      async (_input, init) =>
        await new Promise<Response>((_resolve, reject) => {
          init?.signal?.addEventListener("abort", () =>
            reject(new DOMException("Aborted", "AbortError")),
          );
        }),
    );

    const pending = fetchWikimediaMediaAttributions(
      ["File:Slow.jpg"],
      fetchMock,
    );
    await vi.advanceTimersByTimeAsync(WIKIMEDIA_MEDIA_TIMEOUT_MS);
    const result = await pending;

    expect(fetchMock).toHaveBeenCalledWith(
      expect.stringContaining("commons.wikimedia.org/w/api.php"),
      expect.objectContaining({ signal: expect.any(AbortSignal) }),
    );
    expect(result.get("File:Slow.jpg")?.sourceUrl).toContain(
      "commons.wikimedia.org/wiki/File%3ASlow.jpg",
    );
  });

  it("uses the API-returned 1600px Commons rendition and canonical original", async () => {
    const imageUrl =
      "https://upload.wikimedia.org/wikipedia/commons/thumb/a/ab/Example.jpg/330px-Example.jpg";
    const fetchMock = vi.fn<typeof fetch>().mockImplementation(async (input) => {
      const url = new URL(String(input));
      expect(url.hostname).toBe("commons.wikimedia.org");
      expect(url.searchParams.get("iiurlwidth")).toBe("1600");
      expect(url.searchParams.get("iiprop")).toBe(
        "url|size|mime|extmetadata",
      );
      expect(url.searchParams.get("titles")).toBe("File:Example.jpg");

      return new Response(
        JSON.stringify({
          query: {
            pages: {
              "1": {
                title: "File:Example.jpg",
                imagerepository: "local",
                imageinfo: [
                  {
                    url: "https://upload.wikimedia.org/wikipedia/commons/a/ab/Example.jpg",
                    width: 4000,
                    height: 3000,
                    thumburl:
                      "https://upload.wikimedia.org/wikipedia/commons/thumb/a/ab/Example.jpg/1600px-Example.jpg",
                    thumbwidth: 1600,
                    thumbheight: 1200,
                    descriptionurl:
                      "https://commons.wikimedia.org/wiki/File:Example.jpg",
                    extmetadata: {
                      LicenseShortName: { value: "CC BY-SA 4.0" },
                    },
                  },
                ],
              },
            },
          },
        }),
      );
    });

    const details = await fetchWikimediaMediaDetails(
      [{ sourceTitle: "File:Example.jpg", imageUrl }],
      fetchMock,
    );

    expect(details.get(imageUrl)).toMatchObject({
      repository: "commons",
      originalSrc:
        "https://upload.wikimedia.org/wikipedia/commons/a/ab/Example.jpg",
      lightboxSrc:
        "https://upload.wikimedia.org/wikipedia/commons/thumb/a/ab/Example.jpg/1600px-Example.jpg",
      lightboxWidth: 1600,
      lightboxHeight: 1200,
      attribution: {
        licenseName: "CC BY-SA 4.0",
        sourceUrl: "https://commons.wikimedia.org/wiki/File:Example.jpg",
      },
    });
  });

  it("queries enwiki for local media and uses the native file, not its derivative", async () => {
    const imageUrl =
      "https://upload.wikimedia.org/wikipedia/en/thumb/a/ab/Poster.jpg/320px-Poster.jpg";
    const fetchMock = vi.fn<typeof fetch>().mockImplementation(async (input) => {
      const url = new URL(String(input));
      expect(url.hostname).toBe("en.wikipedia.org");

      return new Response(
        JSON.stringify({
          query: {
            pages: {
              "2": {
                title: "File:Poster.jpg",
                imagerepository: "local",
                imageinfo: [
                  {
                    url: "https://upload.wikimedia.org/wikipedia/en/a/ab/Poster.jpg",
                    width: 640,
                    height: 480,
                    thumburl:
                      "https://upload.wikimedia.org/wikipedia/en/thumb/a/ab/Poster.jpg/1600px-Poster.jpg",
                    thumbwidth: 1600,
                    thumbheight: 1200,
                    extmetadata: {
                      LicenseShortName: { value: "Fair use" },
                    },
                  },
                ],
              },
            },
          },
        }),
      );
    });

    const details = await fetchWikimediaMediaDetails(
      [{ sourceTitle: "File:Poster.jpg", imageUrl }],
      fetchMock,
    );

    expect(details.get(imageUrl)).toMatchObject({
      repository: "enwiki",
      originalSrc:
        "https://upload.wikimedia.org/wikipedia/en/a/ab/Poster.jpg",
      lightboxSrc:
        "https://upload.wikimedia.org/wikipedia/en/a/ab/Poster.jpg",
      lightboxWidth: 640,
      lightboxHeight: 480,
      attribution: {
        licenseName: "Fair use",
        sourceUrl: expect.stringContaining("en.wikipedia.org/wiki/"),
      },
    });
  });

  it("batches at most 20 titles per repository", async () => {
    const requests = Array.from({ length: 41 }, (_, index) => ({
      sourceTitle: `File:Commons ${index}.jpg`,
      imageUrl: `https://upload.wikimedia.org/wikipedia/commons/a/ab/Commons_${index}.jpg`,
    }));
    requests.push({
      sourceTitle: "File:Local poster.jpg",
      imageUrl:
        "https://upload.wikimedia.org/wikipedia/en/a/ab/Local_poster.jpg",
    });

    const fetchMock = vi.fn<typeof fetch>().mockResolvedValue(
      new Response(JSON.stringify({ query: { pages: {} } })),
    );
    await fetchWikimediaMediaDetails(requests, fetchMock);

    const urls = fetchMock.mock.calls.map(([input]) => new URL(String(input)));
    const commonsBatches = urls.filter(
      (url) => url.hostname === "commons.wikimedia.org",
    );
    expect(commonsBatches).toHaveLength(3);
    expect(
      commonsBatches.map(
        (url) => url.searchParams.get("titles")?.split("|").length,
      ),
    ).toEqual([20, 20, 1]);
    expect(
      urls.filter((url) => url.hostname === "en.wikipedia.org"),
    ).toHaveLength(1);
  });

  it.each([
    ["malformed JSON", async () => new Response("not json")],
    [
      "malformed pages",
      async () =>
        new Response(
          JSON.stringify({ query: { pages: { "-1": null } } }),
        ),
    ],
    [
      "request failure",
      async () => {
        throw new Error("offline");
      },
    ],
  ])("preserves source attribution fallback after %s", async (_name, reply) => {
    const imageUrl =
      "https://upload.wikimedia.org/wikipedia/commons/a/ab/Fallback.jpg";
    const fetchMock = vi.fn<typeof fetch>().mockImplementation(reply);

    const details = await fetchWikimediaMediaDetails(
      [{ sourceTitle: "File:Fallback.jpg", imageUrl }],
      fetchMock,
    );

    expect(details.get(imageUrl)).toEqual({
      repository: "commons",
      attribution: expect.objectContaining({
        sourceTitle: "File:Fallback.jpg",
        sourceUrl: expect.stringContaining("commons.wikimedia.org/wiki/"),
      }),
    });
  });

  it("honors Retry-After once for a throttled imageinfo request", async () => {
    vi.useFakeTimers();
    const imageUrl =
      "https://upload.wikimedia.org/wikipedia/commons/a/ab/Retry.jpg";
    const fetchMock = vi
      .fn<typeof fetch>()
      .mockResolvedValueOnce(
        new Response(null, {
          status: 429,
          headers: { "Retry-After": "1" },
        }),
      )
      .mockResolvedValueOnce(
        new Response(
          JSON.stringify({
            query: {
              pages: {
                "3": {
                  title: "File:Retry.jpg",
                  imageinfo: [
                    {
                      url: imageUrl,
                      width: 800,
                      height: 600,
                    },
                  ],
                },
              },
            },
          }),
        ),
      );

    const pending = fetchWikimediaMediaDetails(
      [{ sourceTitle: "File:Retry.jpg", imageUrl }],
      fetchMock,
    );
    await vi.advanceTimersByTimeAsync(999);
    expect(fetchMock).toHaveBeenCalledTimes(1);
    await vi.advanceTimersByTimeAsync(1);
    const details = await pending;

    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(details.get(imageUrl)).toMatchObject({
      lightboxSrc: imageUrl,
      lightboxWidth: 800,
      lightboxHeight: 600,
    });
  });

  it("falls back instead of retrying before a long Retry-After window", async () => {
    const imageUrl =
      "https://upload.wikimedia.org/wikipedia/commons/a/ab/Wait.jpg";
    const fetchMock = vi.fn<typeof fetch>().mockResolvedValue(
      new Response(null, {
        status: 503,
        headers: { "Retry-After": "60" },
      }),
    );

    const details = await fetchWikimediaMediaDetails(
      [{ sourceTitle: "File:Wait.jpg", imageUrl }],
      fetchMock,
    );

    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(details.get(imageUrl)).toEqual({
      repository: "commons",
      attribution: expect.objectContaining({
        sourceTitle: "File:Wait.jpg",
      }),
    });
  });
});
