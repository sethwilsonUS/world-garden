import { afterEach, describe, expect, it, vi } from "vitest";
import { ARTICLE_SECTION_NARRATION_VERSION } from "../../lib/section-narration";
import { MediaWikiSourceError } from "../../lib/mediawiki-document";
import {
  cleanContentForTts,
  cleanSectionContent,
  createCacheableParsedPageData,
  fetchArticleByTitle,
  fetchParsedPageData,
  fetchSectionLinksByIndex,
  MAX_SECTION_LINK_SOURCE_TITLES,
  parseSections,
  SECTION_LINKS_TIMEOUT_MS,
  slugToTitle,
  stripHtml,
  titleToSlug,
} from "./wikipedia";

afterEach(() => {
  vi.restoreAllMocks();
});

describe("Wikipedia title utilities", () => {
  it("converts titles and slugs without changing repeated spaces", () => {
    expect(titleToSlug("New  York City")).toBe("New__York_City");
    expect(slugToTitle("New__York_City")).toBe("New  York City");
  });

  it("cleans search snippets and plaintext citation noise", () => {
    expect(stripHtml('<span class="x"><em>Tom &amp; Jerry</em></span>')).toBe(
      "Tom & Jerry",
    );
    expect(
      cleanSectionContent(
        "Text[1][citation needed][edit]\n=== Heading ===\nMore",
      ),
    ).toBe("Text\n\nMore");
    expect(cleanContentForTts("Einstein[1] developed relativity.")).toBe(
      "Einstein developed relativity.",
    );
  });
});

describe("plaintext narration fallback", () => {
  it("keeps short and numeric prose and excludes end matter", () => {
    const parsed = parseSections(
      [
        "Lead text.",
        "== Early life ==",
        "Born in 1775; left Oxford in 1794.",
        "== Artistic recognition ==",
        "A bust dated 1828 is held in London.",
        "== References ==",
        "Reference list.",
      ].join("\n\n"),
    );

    expect(parsed.summary).toBe("Lead text.");
    expect(parsed.sections).toHaveLength(2);
    expect(parsed.sections.map((section) => section.narration.mode)).toEqual([
      "verbatim",
      "verbatim",
    ]);
    expect(parsed.sections[1].narration.text).toBe(
      "Artistic recognition. A bust dated 1828 is held in London.",
    );
    expect(parsed.sections[1].narration.usedRawFallback).toBe(true);
  });

  it("keeps all 11 pinned Landor body headings narratable", () => {
    const headings = [
      "Summary of his work",
      "Summary of his life",
      "Early life",
      "South Wales and Gebir",
      "Napoleonic Wars and Count Julian",
      "Llanthony and marriage",
      "Florence and Imaginary Conversations",
      "England, Pericles and journalism",
      "Final tragedies and return to Italy",
      "Review of Landor's work by Swinburne",
      "Artistic recognition",
    ];
    const parsed = parseSections(
      [
        "Walter Savage Landor was an English writer.",
        ...headings.flatMap((heading) => [
          `== ${heading} ==`,
          heading === "Artistic recognition"
            ? "A bust of Landor dated 1828 by John Gibson is held in the National Portrait Gallery, London."
            : `${heading} remains part of revision 1342291773.`,
        ]),
        "== External links ==",
        "Official resources.",
      ].join("\n\n"),
    );

    expect(parsed.sections.map((section) => section.title)).toEqual(headings);
    expect(parsed.sections).toHaveLength(11);
    expect(
      parsed.sections.every(
        (section) =>
          section.narration.mode === "verbatim" &&
          section.narration.text.length > 0,
      ),
    ).toBe(true);
  });
});

describe("fetchArticleByTitle semantic narration", () => {
  it("adapts a revision-matched semantic list without heuristics", async () => {
    const fetchSpy = vi.spyOn(globalThis, "fetch");
    fetchSpy.mockResolvedValueOnce(
      new Response(
        JSON.stringify({
          query: {
            pages: {
              "101": {
                pageid: 101,
                title: "Example",
                extract: [
                  "Lead summary.",
                  "== History ==",
                  "The town rebuilt after a fire.",
                  "== Cast ==",
                  "Ada Lovelace Alan Turing",
                ].join("\n\n"),
                revisions: [{ revid: 456, timestamp: "2026-03-01T12:00:00Z" }],
                thumbnail: {
                  source: "https://upload.wikimedia.org/example.png",
                  width: 320,
                  height: 180,
                },
              },
            },
          },
        }),
      ),
    );
    fetchSpy.mockImplementation(async (input) => {
      const url = new URL(String(input));
      if (url.searchParams.get("action") === "parse") {
        return new Response(
          JSON.stringify({
            parse: {
              pageid: 101,
              revid: 456,
              title: "Example",
              text: [
                '<section data-mw-section-id="0"><p>Lead summary.</p>',
                '<section data-mw-section-id="1"><h2 id="History">History</h2><p>The town rebuilt after a fire.</p></section>',
                '<section data-mw-section-id="2"><h2 id="Cast">Cast</h2><ul><li>Ada Lovelace</li><li>Alan Turing</li></ul></section>',
                "</section>",
              ].join(""),
              tocdata: {
                sections: [
                  { index: "1", line: "History", level: 2 },
                  { index: "2", line: "Cast", level: 2 },
                ],
              },
            },
          }),
        );
      }
      return new Response(JSON.stringify({ query: { pages: {} } }));
    });

    const article = await fetchArticleByTitle("Example");

    expect(article.narrationVersion).toBe(ARTICLE_SECTION_NARRATION_VERSION);
    expect(article.sections).toMatchObject([
      { title: "History", narration: { mode: "verbatim" } },
      {
        title: "Cast",
        narration: { mode: "structured", sourceFormat: "list" },
      },
    ]);
    const parseCall = fetchSpy.mock.calls.find(([input]) => {
      const url = new URL(String(input));
      return url.searchParams.get("action") === "parse";
    });
    expect(parseCall).toBeDefined();
    const parseUrl = new URL(String(parseCall![0]));
    expect(parseUrl.searchParams.get("oldid")).toBe("456");
    expect(parseUrl.searchParams.get("parser")).toBe("parsoid");
  });

  it("keeps a narration parse identity mismatch fatal", async () => {
    const fetchSpy = vi.spyOn(globalThis, "fetch");
    fetchSpy.mockResolvedValueOnce(
      new Response(
        JSON.stringify({
          query: {
            pages: {
              "101": {
                pageid: 101,
                title: "Example",
                extract: "Lead summary.\n\n== History ==\n\nSource prose.",
                revisions: [{ revid: 456, timestamp: "2026-03-01T12:00:00Z" }],
              },
            },
          },
        }),
      ),
    );
    fetchSpy.mockResolvedValueOnce(new Response(JSON.stringify({})));
    fetchSpy.mockResolvedValueOnce(
      new Response(
        JSON.stringify({
          parse: {
            pageid: 101,
            revid: 455,
            title: "Example",
            text: '<section data-mw-section-id="0"><p>Wrong revision.</p></section>',
            tocdata: { sections: [] },
          },
        }),
      ),
    );

    await expect(fetchArticleByTitle("Example")).rejects.toMatchObject({
      code: "identity-mismatch",
    });
  });

  it("keeps a table-only section narratable when TextExtracts omits its rows", async () => {
    const fetchSpy = vi.spyOn(globalThis, "fetch");
    fetchSpy.mockResolvedValueOnce(
      new Response(
        JSON.stringify({
          query: {
            pages: {
              "101": {
                pageid: 101,
                title: "Example",
                extract: "Lead summary.\n\n== Data ==\n\n",
                revisions: [{ revid: 456, timestamp: "2026-03-01T12:00:00Z" }],
              },
            },
          },
        }),
      ),
    );
    fetchSpy.mockImplementation(async (input) => {
      const url = new URL(String(input));
      if (url.searchParams.get("action") === "parse") {
        return new Response(
          JSON.stringify({
            parse: {
              pageid: 101,
              revid: 456,
              title: "Example",
              text:
                '<section data-mw-section-id="0"><p>Lead summary.</p>' +
                '<section data-mw-section-id="1"><h2>Data</h2>' +
                '<table><tr><th scope="col">Year</th><th scope="col">Value</th></tr>' +
                "<tr><td>2020</td><td>5</td></tr></table></section></section>",
              tocdata: {
                sections: [{ index: "1", line: "Data", level: 2 }],
              },
            },
          }),
        );
      }
      return new Response(JSON.stringify({}));
    });

    const article = await fetchArticleByTitle("Example");

    expect(article.sections[0]).toMatchObject({
      content: "Year Value 2020 5",
      narration: {
        mode: "structured",
        usedRawFallback: false,
        text: expect.stringContaining("Row 1: Year: 2020; Value: 5."),
      },
    });
  });
});

describe("fetchParsedPageData semantic metadata", () => {
  const identity = {
    wikiPageId: "42",
    revisionId: "99",
    title: "Test article",
    language: "en",
  };
  const thumbnailUrl =
    "https://upload.wikimedia.org/wikipedia/commons/thumb/a/ab/Gallery.jpg/330px-Gallery.jpg";

  const parsedFigureResponse = () =>
    new Response(
      JSON.stringify({
        parse: {
          pageid: 42,
          revid: 99,
          title: "Test article",
          text:
            '<section data-mw-section-id="0">' +
            '<figure typeof="mw:File/Thumb">' +
            `<a href="./File:Gallery.jpg"><img resource="./File:Gallery.jpg" src="${thumbnailUrl}" width="330" height="220" alt="Gallery image"></a>` +
            "<figcaption>A useful caption</figcaption></figure></section>",
          tocdata: { sections: [] },
        },
      }),
    );

  it("enriches semantic figures with canonical lightbox metadata", async () => {
    const canonicalUrl =
      "https://upload.wikimedia.org/wikipedia/commons/a/ab/Gallery.jpg";
    const lightboxUrl =
      "https://upload.wikimedia.org/wikipedia/commons/thumb/a/ab/Gallery.jpg/1600px-Gallery.jpg";
    const fetchSpy = vi
      .spyOn(globalThis, "fetch")
      .mockImplementation(async (input) => {
        const url = new URL(String(input));
        if (url.searchParams.get("action") === "parse") {
          return parsedFigureResponse();
        }
        return new Response(
          JSON.stringify({
            query: {
              pages: {
                "1": {
                  title: "File:Gallery.jpg",
                  imageinfo: [
                    {
                      url: canonicalUrl,
                      width: 3600,
                      height: 2400,
                      thumburl: lightboxUrl,
                      thumbwidth: 1600,
                      thumbheight: 1067,
                      extmetadata: {
                        LicenseShortName: { value: "CC BY 4.0" },
                      },
                    },
                  ],
                },
              },
            },
          }),
        );
      });

    const parsed = await fetchParsedPageData(identity);

    expect(fetchSpy).toHaveBeenCalledTimes(2);
    expect(parsed.images[0]).toMatchObject({
      src: thumbnailUrl,
      originalSrc: canonicalUrl,
      lightboxSrc: lightboxUrl,
      lightboxWidth: 1600,
      lightboxHeight: 1067,
      attribution: { licenseName: "CC BY 4.0" },
    });
  });

  it("propagates aborts through follow-up media requests", async () => {
    let mediaSignal: AbortSignal | undefined;
    vi.spyOn(globalThis, "fetch").mockImplementation(async (input, init) => {
      const url = new URL(String(input));
      if (url.searchParams.get("action") === "parse") {
        return parsedFigureResponse();
      }
      mediaSignal = init?.signal as AbortSignal;
      return new Promise<Response>((_resolve, reject) => {
        mediaSignal?.addEventListener(
          "abort",
          () => reject(mediaSignal?.reason),
          {
            once: true,
          },
        );
      });
    });
    const controller = new AbortController();
    const pending = fetchParsedPageData(identity, controller.signal);
    await vi.waitFor(() => expect(mediaSignal).toBeDefined());
    controller.abort();

    await expect(pending).rejects.toMatchObject({ name: "AbortError" });
  });

  it("rejects a pre-aborted signal before starting semantic parsing", async () => {
    const fetchSpy = vi.spyOn(globalThis, "fetch");
    const controller = new AbortController();
    controller.abort();

    await expect(
      fetchParsedPageData(identity, controller.signal),
    ).rejects.toMatchObject({ name: "AbortError" });
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it("keeps revision identity mismatches fatal", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValue(
      new Response(
        JSON.stringify({
          parse: {
            pageid: 42,
            revid: 98,
            title: "Test article",
            text: '<section data-mw-section-id="0"><p>Wrong.</p></section>',
            tocdata: { sections: [] },
          },
        }),
      ),
    );

    await expect(fetchParsedPageData(identity)).rejects.toMatchObject({
      name: MediaWikiSourceError.name,
      code: "identity-mismatch",
    });
  });

  it("rejects transient semantic-document failures instead of returning cacheable empty metadata", async () => {
    vi.spyOn(globalThis, "fetch").mockRejectedValue(
      new Error("temporary MediaWiki failure"),
    );

    await expect(fetchParsedPageData(identity)).rejects.toMatchObject({
      name: MediaWikiSourceError.name,
      code: "http-error",
      retryable: true,
    });
  });

  it("accepts a successfully parsed document whose metadata is genuinely empty", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValueOnce(
      new Response(
        JSON.stringify({
          parse: {
            pageid: 42,
            revid: 99,
            title: "Test article",
            text: '<section data-mw-section-id="0"></section>',
            tocdata: { sections: [] },
          },
        }),
      ),
    );

    await expect(fetchParsedPageData(identity)).resolves.toEqual({
      linkCounts: [{ count: 0, index: "__summary__", title: "__summary__" }],
      citations: [],
      sectionCitations: [
        {
          citationIds: [],
          count: 0,
          index: "__summary__",
          title: "__summary__",
        },
      ],
      sectionIndexMap: [],
      images: [],
    });
  });

  it("keeps the deliberate non-English empty projection without fetching", async () => {
    const fetchSpy = vi.spyOn(globalThis, "fetch");

    await expect(
      fetchParsedPageData({ ...identity, language: "fr" }),
    ).resolves.toEqual({
      linkCounts: [],
      citations: [],
      sectionCitations: [],
      sectionIndexMap: [],
      images: [],
    });
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it.each([
    { sourceFormat: "plaintext" },
    { sourceFormat: "parsoid", fallbackReason: "html-unavailable" },
  ])(
    "rejects a silent semantic fallback before it can be cached: %o",
    (fallbackDocument) => {
      expect(() =>
        createCacheableParsedPageData(fallbackDocument as never),
      ).toThrowError(
        expect.objectContaining({
          name: MediaWikiSourceError.name,
          code: "invalid-response",
        }),
      );
    },
  );
});

describe("fetchSectionLinksByIndex", () => {
  const identity = {
    wikiPageId: "42",
    revisionId: "99",
    title: "Test article",
    language: "en",
  };

  const parsedLinksResponse = (titles: readonly string[]) =>
    new Response(
      JSON.stringify({
        parse: {
          pageid: 42,
          revid: 99,
          title: "Test article",
          text:
            '<section data-mw-section-id="0"><p>Lead.</p>' +
            '<section data-mw-section-id="3"><h2>Links</h2><p>' +
            titles
              .map(
                (title) =>
                  `<a rel="mw:WikiLink" href="./${title.replaceAll(" ", "_")}" title="${title}">${title}</a>`,
              )
              .join("") +
            "</p></section></section>",
          tocdata: {
            sections: [{ index: "3", line: "Links", level: 2 }],
          },
        },
      }),
    );

  const linkQueryResponse = (titles: readonly string[]) =>
    new Response(
      JSON.stringify({
        query: {
          pages: Object.fromEntries(
            titles.map((title, index) => [
              String(index + 1),
              {
                pageid: index + 1,
                ns: 0,
                title,
                description: `Description for ${title}`,
              },
            ]),
          ),
        },
      }),
    );

  it("pins the section lookup to oldid and resolves main-namespace links", async () => {
    const fetchSpy = vi
      .spyOn(globalThis, "fetch")
      .mockResolvedValueOnce(
        new Response(
          JSON.stringify({
            parse: {
              pageid: 42,
              revid: 99,
              title: "Test article",
              text:
                '<section data-mw-section-id="0"><p>Lead.</p>' +
                '<section data-mw-section-id="3"><h2>Links</h2>' +
                '<p><a rel="mw:WikiLink" href="./Alpha" title="Alpha">Alpha</a>' +
                '<a rel="mw:WikiLink" href="./Category:Examples" title="Category:Examples">Examples</a></p>' +
                "</section></section>",
              tocdata: {
                sections: [{ index: "3", line: "Links", level: 2 }],
              },
            },
          }),
        ),
      )
      .mockResolvedValueOnce(
        new Response(
          JSON.stringify({
            query: {
              pages: {
                "7": {
                  pageid: 7,
                  ns: 0,
                  title: "Alpha",
                  description: "A linked article",
                },
                "14": {
                  pageid: 14,
                  ns: 14,
                  title: "Category:Examples",
                  description: "A category, not an article",
                },
              },
            },
          }),
        ),
      );

    await expect(fetchSectionLinksByIndex(identity, "3")).resolves.toEqual([
      {
        wikiPageId: "7",
        title: "Alpha",
        description: "A linked article",
      },
    ]);
    const parseUrl = new URL(String(fetchSpy.mock.calls[0][0]));
    expect(parseUrl.searchParams.get("oldid")).toBe("99");
    expect(parseUrl.searchParams.get("parser")).toBe("parsoid");
    expect(parseUrl.searchParams.get("prop")).toContain("tocdata");
  });

  it("declines link data from a different revision", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValue(
      new Response(
        JSON.stringify({
          parse: {
            pageid: 42,
            revid: 98,
            title: "Test article",
            text: '<section data-mw-section-id="0"><p>Wrong.</p></section>',
            tocdata: { sections: [] },
          },
        }),
      ),
    );

    await expect(fetchSectionLinksByIndex(identity, "3")).rejects.toMatchObject(
      {
        code: "identity-mismatch",
      },
    );
  });

  it("rejects transient document failures instead of reporting a successful empty section", async () => {
    vi.spyOn(globalThis, "fetch").mockRejectedValue(
      new Error("temporary MediaWiki failure"),
    );

    await expect(fetchSectionLinksByIndex(identity, "3")).rejects.toMatchObject(
      {
        name: MediaWikiSourceError.name,
        code: "http-error",
        retryable: true,
      },
    );
  });

  it("returns an empty result for a successfully parsed section with no links", async () => {
    const fetchSpy = vi.spyOn(globalThis, "fetch").mockResolvedValueOnce(
      new Response(
        JSON.stringify({
          parse: {
            pageid: 42,
            revid: 99,
            title: "Test article",
            text:
              '<section data-mw-section-id="0"><p>Lead.</p>' +
              '<section data-mw-section-id="3"><h2>Empty</h2>' +
              "<p>This section has no links.</p></section></section>",
            tocdata: {
              sections: [{ index: "3", line: "Empty", level: 2 }],
            },
          },
        }),
      ),
    );

    await expect(fetchSectionLinksByIndex(identity, "3")).resolves.toEqual([]);
    expect(fetchSpy).toHaveBeenCalledOnce();
  });

  it("rejects transient link-enrichment failures instead of returning cacheable partial data", async () => {
    vi.spyOn(globalThis, "fetch")
      .mockResolvedValueOnce(
        new Response(
          JSON.stringify({
            parse: {
              pageid: 42,
              revid: 99,
              title: "Test article",
              text:
                '<section data-mw-section-id="0"><p>Lead.</p>' +
                '<section data-mw-section-id="3"><h2>Links</h2>' +
                '<p><a rel="mw:WikiLink" href="./Alpha" title="Alpha">Alpha</a></p>' +
                "</section></section>",
              tocdata: {
                sections: [{ index: "3", line: "Links", level: 2 }],
              },
            },
          }),
        ),
      )
      .mockResolvedValueOnce(new Response("unavailable", { status: 503 }));

    await expect(fetchSectionLinksByIndex(identity, "3")).rejects.toThrow(
      "Resolving Wikipedia section links failed: 503",
    );
  });

  it("rejects malformed enriched page titles as a typed upstream error", async () => {
    vi.spyOn(globalThis, "fetch")
      .mockResolvedValueOnce(parsedLinksResponse(["Alpha"]))
      .mockResolvedValueOnce(
        new Response(
          JSON.stringify({
            query: {
              pages: {
                "1": { pageid: 1, ns: 0, title: { malformed: true } },
              },
            },
          }),
        ),
      );

    await expect(fetchSectionLinksByIndex(identity, "3")).rejects.toMatchObject(
      {
        name: MediaWikiSourceError.name,
        code: "invalid-response",
        retryable: true,
      },
    );
  });

  it("omits malformed descriptions from otherwise valid enriched pages", async () => {
    vi.spyOn(globalThis, "fetch")
      .mockResolvedValueOnce(parsedLinksResponse(["Alpha"]))
      .mockResolvedValueOnce(
        new Response(
          JSON.stringify({
            query: {
              pages: {
                "1": {
                  pageid: 1,
                  ns: 0,
                  title: "Alpha",
                  description: { malformed: true },
                },
              },
            },
          }),
        ),
      );

    await expect(fetchSectionLinksByIndex(identity, "3")).resolves.toEqual([
      { wikiPageId: "1", title: "Alpha" },
    ]);
  });

  it("accepts complete normalization and redirect mappings", async () => {
    vi.spyOn(globalThis, "fetch")
      .mockResolvedValueOnce(parsedLinksResponse(["alpha_alias"]))
      .mockResolvedValueOnce(
        new Response(
          JSON.stringify({
            query: {
              normalized: [{ from: "alpha_alias", to: "Alpha alias" }],
              redirects: [
                { from: "Alpha alias", to: "Intermediate alias" },
                { from: "Intermediate alias", to: "Alpha" },
              ],
              pages: {
                "1": {
                  pageid: 1,
                  ns: 0,
                  title: "Alpha",
                  description: "The canonical article",
                },
              },
            },
          }),
        ),
      );

    await expect(fetchSectionLinksByIndex(identity, "3")).resolves.toEqual([
      {
        wikiPageId: "1",
        title: "Alpha",
        description: "The canonical article",
      },
    ]);
  });

  it("accepts a complete missing-page record without fabricating a link", async () => {
    vi.spyOn(globalThis, "fetch")
      .mockResolvedValueOnce(parsedLinksResponse(["Missing article"]))
      .mockResolvedValueOnce(
        new Response(
          JSON.stringify({
            query: {
              pages: {
                "-1": {
                  ns: 0,
                  title: "Missing article",
                  missing: "",
                },
              },
            },
          }),
        ),
      );

    await expect(fetchSectionLinksByIndex(identity, "3")).resolves.toEqual([]);
  });

  it("accounts for a complete circular redirect as a missing page", async () => {
    vi.spyOn(globalThis, "fetch")
      .mockResolvedValueOnce(parsedLinksResponse(["Page1"]))
      .mockResolvedValueOnce(
        new Response(
          JSON.stringify({
            query: {
              redirects: [
                { from: "Page1", to: "Page2" },
                { from: "Page2", to: "Page3" },
                { from: "Page3", to: "Page1" },
              ],
              pages: {
                "-1": { ns: 0, title: "Page1", missing: true },
              },
            },
          }),
        ),
      );

    await expect(fetchSectionLinksByIndex(identity, "3")).resolves.toEqual([]);
  });

  it("rejects after true partial progress when a later enrichment batch fails", async () => {
    const titles = Array.from({ length: 51 }, (_, index) => `Article ${index}`);
    const fetchSpy = vi
      .spyOn(globalThis, "fetch")
      .mockResolvedValueOnce(parsedLinksResponse(titles))
      .mockResolvedValueOnce(linkQueryResponse(titles.slice(0, 50)))
      .mockResolvedValueOnce(new Response("unavailable", { status: 503 }));

    await expect(fetchSectionLinksByIndex(identity, "3")).rejects.toMatchObject(
      {
        name: MediaWikiSourceError.name,
        code: "http-error",
        retryable: true,
      },
    );
    expect(fetchSpy).toHaveBeenCalledTimes(3);
  });

  it("rejects after true partial progress when a later 200 batch is empty", async () => {
    const titles = Array.from({ length: 51 }, (_, index) => `Article ${index}`);
    const fetchSpy = vi
      .spyOn(globalThis, "fetch")
      .mockResolvedValueOnce(parsedLinksResponse(titles))
      .mockResolvedValueOnce(linkQueryResponse(titles.slice(0, 50)))
      .mockResolvedValueOnce(
        new Response(JSON.stringify({ query: { pages: {} } })),
      );

    await expect(fetchSectionLinksByIndex(identity, "3")).rejects.toMatchObject(
      {
        name: MediaWikiSourceError.name,
        code: "invalid-response",
        retryable: true,
      },
    );
    expect(fetchSpy).toHaveBeenCalledTimes(3);
  });

  it("rejects an unexpected page even when the response count matches", async () => {
    vi.spyOn(globalThis, "fetch")
      .mockResolvedValueOnce(parsedLinksResponse(["Alpha"]))
      .mockResolvedValueOnce(linkQueryResponse(["Unexpected article"]));

    await expect(fetchSectionLinksByIndex(identity, "3")).rejects.toMatchObject(
      {
        name: MediaWikiSourceError.name,
        code: "invalid-response",
        retryable: true,
      },
    );
  });

  it("rejects enrichment responses containing more pages than requested", async () => {
    vi.spyOn(globalThis, "fetch")
      .mockResolvedValueOnce(parsedLinksResponse(["Alpha"]))
      .mockResolvedValueOnce(linkQueryResponse(["Alpha", "Unexpected"]));

    await expect(fetchSectionLinksByIndex(identity, "3")).rejects.toMatchObject(
      {
        name: MediaWikiSourceError.name,
        code: "invalid-response",
        retryable: true,
      },
    );
  });

  it.each([
    { pageid: "invalid", ns: 0, title: "Alpha" },
    { pageid: 1, ns: "invalid", title: "Alpha" },
  ])("rejects invalid non-missing page identity fields: %o", async (page) => {
    vi.spyOn(globalThis, "fetch")
      .mockResolvedValueOnce(parsedLinksResponse(["Alpha"]))
      .mockResolvedValueOnce(
        new Response(JSON.stringify({ query: { pages: { "1": page } } })),
      );

    await expect(fetchSectionLinksByIndex(identity, "3")).rejects.toMatchObject(
      {
        name: MediaWikiSourceError.name,
        code: "invalid-response",
        retryable: true,
      },
    );
  });

  it("bounds enrichment response bodies before JSON decoding", async () => {
    const oneMiB = new Uint8Array(1024 * 1024);
    const oversizedBody = new ReadableStream<Uint8Array>({
      start(controller) {
        for (let index = 0; index < 16; index += 1) {
          controller.enqueue(oneMiB);
        }
        controller.close();
      },
    });
    vi.spyOn(globalThis, "fetch")
      .mockResolvedValueOnce(parsedLinksResponse(["Alpha"]))
      .mockResolvedValueOnce(new Response(oversizedBody));

    await expect(fetchSectionLinksByIndex(identity, "3")).rejects.toMatchObject(
      {
        name: MediaWikiSourceError.name,
        code: "response-too-large",
      },
    );
  });

  it("enriches only the deterministic first source-link cap", async () => {
    const titles = Array.from(
      { length: MAX_SECTION_LINK_SOURCE_TITLES + 25 },
      (_, index) => `Article ${index}`,
    );
    const requestedTitles: string[] = [];
    const fetchSpy = vi
      .spyOn(globalThis, "fetch")
      .mockResolvedValueOnce(parsedLinksResponse(titles))
      .mockImplementation(async (input) => {
        const batch = new URL(String(input)).searchParams
          .get("titles")!
          .split("|");
        requestedTitles.push(...batch);
        return linkQueryResponse(batch);
      });

    const result = await fetchSectionLinksByIndex(identity, "3");

    expect(result).toHaveLength(MAX_SECTION_LINK_SOURCE_TITLES);
    expect(requestedTitles).toEqual(
      titles.slice(0, MAX_SECTION_LINK_SOURCE_TITLES),
    );
    expect(fetchSpy).toHaveBeenCalledTimes(
      1 + Math.ceil(MAX_SECTION_LINK_SOURCE_TITLES / 50),
    );
  });

  it("applies one overall timeout through link enrichment", async () => {
    vi.useFakeTimers();
    try {
      const parseDelayMs = 10_000;
      let enrichmentSignal: AbortSignal | undefined;
      vi.spyOn(globalThis, "fetch")
        .mockImplementationOnce(
          async () =>
            await new Promise<Response>((resolve) => {
              setTimeout(
                () => resolve(parsedLinksResponse(["Alpha"])),
                parseDelayMs,
              );
            }),
        )
        .mockImplementationOnce(async (_input, init) => {
          const requestSignal = init?.signal;
          if (!requestSignal) throw new Error("Expected an enrichment signal");
          enrichmentSignal = requestSignal;
          return await new Promise<Response>((_resolve, reject) => {
            requestSignal.addEventListener(
              "abort",
              () => reject(requestSignal.reason),
              { once: true },
            );
          });
        });

      const pending = fetchSectionLinksByIndex(identity, "3");
      const observed = pending.catch((error: unknown) => error);
      await vi.advanceTimersByTimeAsync(parseDelayMs);
      expect(enrichmentSignal).toBeDefined();
      await vi.advanceTimersByTimeAsync(
        SECTION_LINKS_TIMEOUT_MS - parseDelayMs,
      );
      await expect(observed).resolves.toMatchObject({
        name: MediaWikiSourceError.name,
        code: "timeout",
        retryable: true,
      });
    } finally {
      vi.useRealTimers();
    }
  });

  it("propagates a caller abort through link enrichment", async () => {
    let enrichmentSignal: AbortSignal | undefined;
    vi.spyOn(globalThis, "fetch")
      .mockResolvedValueOnce(parsedLinksResponse(["Alpha"]))
      .mockImplementationOnce(async (_input, init) => {
        const requestSignal = init?.signal;
        if (!requestSignal) throw new Error("Expected an enrichment signal");
        enrichmentSignal = requestSignal;
        return await new Promise<Response>((_resolve, reject) => {
          requestSignal.addEventListener(
            "abort",
            () => reject(requestSignal.reason),
            { once: true },
          );
        });
      });
    const controller = new AbortController();
    const pending = fetchSectionLinksByIndex(identity, "3", controller.signal);
    await vi.waitFor(() => expect(enrichmentSignal).toBeDefined());
    controller.abort();

    await expect(pending).rejects.toMatchObject({ name: "AbortError" });
    expect(enrichmentSignal?.aborted).toBe(true);
  });

  it("rejects a pre-aborted signal before starting semantic parsing", async () => {
    const fetchSpy = vi.spyOn(globalThis, "fetch");
    const controller = new AbortController();
    controller.abort();

    await expect(
      fetchSectionLinksByIndex(identity, "3", controller.signal),
    ).rejects.toMatchObject({ name: "AbortError" });
    expect(fetchSpy).not.toHaveBeenCalled();
  });
});
