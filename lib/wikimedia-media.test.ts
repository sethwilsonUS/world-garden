import { describe, expect, it, vi } from "vitest";
import {
  fetchWikimediaMediaAttributions,
  getWikimediaFileTitleFromUrl,
} from "./wikimedia-media";

describe("Wikimedia media attribution", () => {
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
    const fetchMock = vi.fn<typeof fetch>().mockResolvedValue(
      new Response(
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
      ),
    );

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
      "en.wikipedia.org/wiki/File%3AMissing.jpg",
    );
  });
});
