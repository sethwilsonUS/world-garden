import { afterEach, describe, expect, it, vi } from "vitest";
import {
  fetchWikimediaMediaAttributions,
  getWikimediaFileTitleFromUrl,
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
});
