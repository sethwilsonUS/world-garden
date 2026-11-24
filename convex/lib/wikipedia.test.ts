import { afterEach, describe, expect, it, vi } from "vitest";
import { ARTICLE_SECTION_NARRATION_VERSION } from "../../lib/section-narration";
import { MediaWikiSourceError } from "../../lib/mediawiki-document";
import {
  WIKIMEDIA_OAUTH_ACCESS_TOKEN_ENV,
  WIKIMEDIA_USER_AGENT,
} from "../../lib/wikimedia-client";
import {
  WIKIMEDIA_FEED_THUMBNAIL_WIDTH,
  WIKIMEDIA_THUMBNAIL_WIDTH,
} from "../../lib/wikimedia-media";
import {
  ARTICLE_COMBINED_QUERY_TIMEOUT_MS,
  ARTICLE_QUERY_DEADLINE_MS,
  BADGE_TOPIC_FALLBACK_MAX_CONCURRENCY,
  buildMoreLikeSearchQuery,
  cleanContentForTts,
  cleanSectionContent,
  createCacheableParsedPageData,
  fetchArticleBadgeKeys,
  fetchArticleByPageId,
  fetchArticleByTitle,
  fetchArticleWithDocumentByPageId,
  fetchArticleWithDocumentByTitle,
  fetchParsedPageData,
  fetchRelatedArticles,
  fetchSectionLinksByIndex,
  MAX_SECTION_LINK_SOURCE_TITLES,
  parseSections,
  searchWikipedia,
  searchWikipediaWithMeta,
  SECTION_LINKS_TIMEOUT_MS,
  slugToTitle,
  stripHtml,
  suggestWikipediaTitles,
  titleToSlug,
  WIKIMEDIA_OUTLINK_TOPIC_MODEL_URL,
} from "./wikipedia";

afterEach(() => {
  vi.restoreAllMocks();
});

describe("Wikipedia title utilities", () => {
  it("uses formatversion=2 without origin=* across search and pageid fetches", async () => {
    const fetchSpy = vi
      .spyOn(globalThis, "fetch")
      .mockResolvedValueOnce(
        new Response(
          JSON.stringify({
            query: {
              search: [{ pageid: 974, title: "Ada Lovelace", snippet: "Mathematician" }],
            },
          }),
        ),
      )
      .mockResolvedValueOnce(
        new Response(
          JSON.stringify({
            query: {
              pages: [
                {
                  pageid: 974,
                  ns: 0,
                  title: "Ada Lovelace",
                  extract: "Ada Lovelace was an English mathematician.",
                  revisions: [{ revid: 42, timestamp: "2026-11-24T00:00:00Z" }],
                  thumbnail: {
                    source: "https://upload.wikimedia.org/wikipedia/commons/a/ab/Ada.jpg",
                    width: 400,
                    height: 500,
                  },
                },
              ],
            },
          }),
        ),
      )
      .mockResolvedValueOnce(
        new Response(
          JSON.stringify({
            parse: {
              pageid: 974,
              revid: 42,
              title: "Ada Lovelace",
              text: '<section data-mw-section-id="0"><p>Ada Lovelace was an English mathematician.</p></section>',
              tocdata: { sections: [] },
            },
          }),
        ),
      )
      .mockResolvedValueOnce(
        new Response(
          JSON.stringify({
            query: {
              pages: [
                {
                  title: "File:Ada.jpg",
                  imageinfo: [{ descriptionurl: "https://commons.wikimedia.org/wiki/File:Ada.jpg" }],
                },
              ],
            },
          }),
        ),
      );

    const results = await searchWikipedia("Ada");
    expect(results).toHaveLength(1);
    expect(results[0]?.wikiPageId).toBe("974");

    const article = await fetchArticleByPageId("974");
    expect(article.title).toBe("Ada Lovelace");
    expect(article.revisionId).toBe("42");

    for (const [input, init] of fetchSpy.mock.calls) {
      const url = new URL(String(input));
      if (url.pathname.endsWith("/w/api.php")) {
        expect(url.searchParams.get("formatversion")).toBe("2");
        expect(url.searchParams.has("origin")).toBe(false);
      }
      expect(init?.headers).toEqual(
        expect.objectContaining({ "User-Agent": WIKIMEDIA_USER_AGENT }),
      );
    }
  });

  it("converts titles and slugs without changing repeated spaces", () => {
    expect(titleToSlug("New  York City")).toBe("New__York_City");
    expect(slugToTitle("New__York_City")).toBe("New  York City");
  });

  it("cleans search snippets and plaintext citation noise", () => {
    expect(stripHtml('<span class="x"><em>Tom &amp; Jerry</em></span>')).toBe(
      "Tom & Jerry",
    );
    expect(
      stripHtml(
        "Ada&apos;s &ldquo;notes&rdquo; &mdash; 1843&ndash;1844&nbsp;(&#39;quote&#x2019; &amp;lt;tag&amp;gt; &hellip;)",
      ),
    ).toBe("Ada's &ldquo;notes&rdquo; — 1843–1844 ('quote’ &lt;tag&gt; …)");
    expect(
      cleanSectionContent(
        "Text[1][citation needed][edit]\n=== Heading ===\nMore",
      ),
    ).toBe("Text\n\nMore");
    expect(cleanContentForTts("Einstein[1] developed relativity.")).toBe(
      "Einstein developed relativity.",
    );
  });

  it("fetches short descriptions and typo suggestions in one search request", async () => {
    const fetchSpy = vi.spyOn(globalThis, "fetch").mockResolvedValueOnce(
      new Response(
        JSON.stringify({
          query: {
            searchinfo: {
              suggestion: "albert einstein",
            },
            search: [
              {
                pageid: 736,
                title: "Albert Einstein",
                snippet: "German-born <span class=\"searchmatch\">theoretical</span> physicist &amp; author",
              },
              {
                pageid: 999,
                title: "Einstein&#39;s Brain",
                snippet: "Fallback <span>snippet</span> &mdash; preserved when description is absent",
              },
            ],
            pages: [
              {
                pageid: 736,
                title: "Albert Einstein",
                description: "German-born theoretical physicist (1879&ndash;1955)",
              },
              {
                pageid: 999,
                title: "Einstein's Brain",
              },
            ],
          },
        }),
      ),
    );

    const response = await searchWikipediaWithMeta("  Albrt  Einstien ");

    expect(fetchSpy).toHaveBeenCalledTimes(1);
    const requestUrl = new URL(String(fetchSpy.mock.calls[0]?.[0]));
    expect(requestUrl.searchParams.get("list")).toBe("search");
    expect(requestUrl.searchParams.get("srinfo")).toBe("suggestion");
    expect(requestUrl.searchParams.get("generator")).toBe("search");
    expect(requestUrl.searchParams.get("gsrnamespace")).toBe("0");
    expect(requestUrl.searchParams.get("prop")).toBe("description");
    expect(response).toEqual({
      results: [
        {
          wikiPageId: "736",
          title: "Albert Einstein",
          description: "German-born theoretical physicist (1879–1955)",
          url: "https://en.wikipedia.org/wiki/Albert_Einstein",
        },
        {
          wikiPageId: "999",
          title: "Einstein's Brain",
          description: "Fallback snippet — preserved when description is absent",
          url: "https://en.wikipedia.org/wiki/Einstein's_Brain",
        },
      ],
      suggestion: "albert einstein",
    });
  });

  it("omits identical typo suggestions and handles empty or failed searches", async () => {
    expect(await searchWikipediaWithMeta("   ")).toEqual({ results: [] });

    vi.spyOn(globalThis, "fetch")
      .mockResolvedValueOnce(
        new Response(
          JSON.stringify({
            query: {
              searchinfo: { suggestion: "ada lovelace" },
              search: [],
            },
          }),
        ),
      )
      .mockResolvedValueOnce(new Response("bad request", { status: 400 }));

    expect(await searchWikipediaWithMeta("Ada Lovelace")).toEqual({
      results: [],
    });
    await expect(searchWikipediaWithMeta("Broken")).rejects.toThrow(
      "Wikipedia search failed: 400",
    );
  });

  it("fetches Core REST typeahead suggestions with normalized thumbnails and deduplication", async () => {
    expect(await suggestWikipediaTitles("   ")).toEqual([]);

    const fetchSpy = vi
      .spyOn(globalThis, "fetch")
      .mockResolvedValueOnce(
        new Response(
          JSON.stringify({
            pages: [
              {
                id: 974,
                key: "Ada_Lovelace",
                title: "Ada Lovelace",
                description: "English mathematician &amp; writer (1815&ndash;1852)",
                thumbnail: {
                  mimetype: "image/jpeg",
                  width: 60,
                  height: 75,
                  url: "//thumb.wikimedia.org/thumb/ada.jpg/60px-ada.jpg",
                },
              },
              {
                id: 974,
                key: "Ada_Lovelace",
                title: "Ada Lovelace duplicate",
              },
              {
                id: 1271,
                key: "Analytical_engine",
                title: "Analytical engine",
                description: "Proposed mechanical general-purpose computer",
                thumbnail: {
                  mimetype: "image/jpeg",
                  width: 0,
                  height: 60,
                  url: "//thumb.wikimedia.org/invalid.jpg",
                },
              },
            ],
          }),
        ),
      )
      .mockResolvedValueOnce(new Response("bad request", { status: 400 }));

    const suggestions = await suggestWikipediaTitles("  Ada   Lov ", {
      limit: 6,
    });

    expect(fetchSpy).toHaveBeenCalledTimes(1);
    const requestUrl = new URL(String(fetchSpy.mock.calls[0]?.[0]));
    expect(requestUrl.origin + requestUrl.pathname).toBe(
      "https://en.wikipedia.org/w/rest.php/v1/search/title",
    );
    expect(requestUrl.searchParams.get("q")).toBe("Ada Lov");
    expect(requestUrl.searchParams.get("limit")).toBe("6");
    expect(suggestions).toEqual([
      {
        wikiPageId: "974",
        key: "Ada_Lovelace",
        title: "Ada Lovelace",
        description: "English mathematician & writer (1815–1852)",
        thumbnail: {
          source: "https://thumb.wikimedia.org/thumb/ada.jpg/60px-ada.jpg",
          width: 60,
          height: 75,
        },
      },
      {
        wikiPageId: "1271",
        key: "Analytical_engine",
        title: "Analytical engine",
        description: "Proposed mechanical general-purpose computer",
      },
    ]);

    await expect(suggestWikipediaTitles("Broken")).rejects.toThrow(
      "Wikipedia title search failed: 400",
    );

    const fractionalSpy = vi.spyOn(globalThis, "fetch").mockResolvedValueOnce(
      new Response(JSON.stringify({ pages: [] })),
    );
    await suggestWikipediaTitles("Ada", { limit: 0.5 });
    const fractionalUrl = new URL(String(fractionalSpy.mock.calls[0]?.[0]));
    expect(fractionalUrl.searchParams.get("limit")).toBe("6");
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
      .mockImplementation(
        async () =>
          new Response("unavailable", {
            status: 503,
            headers: { "Retry-After": "60" },
          }),
      );

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
      .mockImplementation(
        async () =>
          new Response("unavailable", {
            status: 503,
            headers: { "Retry-After": "60" },
          }),
      );

    await expect(fetchSectionLinksByIndex(identity, "3")).rejects.toMatchObject(
      {
        name: MediaWikiSourceError.name,
        code: "http-error",
        retryable: true,
      },
    );
    expect(fetchSpy).toHaveBeenCalledTimes(3);
  });

  it("sends formatversion=2 without origin=* and parses formatversion=2 page arrays", async () => {
    const fetchSpy = vi
      .spyOn(globalThis, "fetch")
      .mockResolvedValueOnce(parsedLinksResponse(["Alpha", "Missing page"]))
      .mockResolvedValueOnce(
        new Response(
          JSON.stringify({
            query: {
              pages: [
                {
                  pageid: 1,
                  ns: 0,
                  title: "Alpha",
                  description: "First letter",
                },
                {
                  ns: 0,
                  title: "Missing page",
                  missing: true,
                },
              ],
            },
          }),
        ),
      );

    await expect(fetchSectionLinksByIndex(identity, "3")).resolves.toEqual([
      { wikiPageId: "1", title: "Alpha", description: "First letter" },
    ]);

    for (const [input, init] of fetchSpy.mock.calls) {
      const url = new URL(String(input));
      expect(url.searchParams.get("formatversion")).toBe("2");
      expect(url.searchParams.has("origin")).toBe(false);
      expect(init?.headers).toEqual(
        expect.objectContaining({ "User-Agent": WIKIMEDIA_USER_AGENT }),
      );
    }
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

describe("fetchArticleBadgeKeys single-request topic classification", () => {
  it("makes zero Wikimedia requests when piggybacked cirrusdoc weighted_tags are supplied", async () => {
    const fetchSpy = vi.spyOn(globalThis, "fetch");

    const badges = await fetchArticleBadgeKeys("974", {
      title: "Ada Lovelace",
      cirrusTopicPredictions: [
        { topic: "Culture.Biography.Biography*", score: 0.538 },
        { topic: "STEM.Computing", score: 0.91 },
        { topic: "History_and_Society.History", score: 0.42 },
      ],
    });

    expect(badges).toEqual(["biography", "technology"]);
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it("extracts piggybacked cirrusdoc weighted_tags during article ingestion", async () => {
    vi.spyOn(globalThis, "fetch").mockImplementation(async (input) => {
      const url = new URL(String(input));
      if (url.searchParams.get("action") === "query") {
        expect(url.searchParams.get("prop")).toContain("cirrusdoc");
        expect(url.searchParams.get("cdincludes")).toBe("weighted_tags");
        expect(url.searchParams.get("pithumbsize")).toBe(
          String(WIKIMEDIA_THUMBNAIL_WIDTH),
        );
        return new Response(
          JSON.stringify({
            query: {
              pages: [
                {
                  pageid: 974,
                  title: "Ada Lovelace",
                  extract: "Ada Lovelace was an English mathematician.",
                  revisions: [
                    { revid: 42, timestamp: "2026-11-24T00:00:00Z" },
                  ],
                  cirrusdoc: [
                    {
                      source: {
                        weighted_tags: [
                          "classification.prediction.articletopic/Culture.Biography.Biography*|538",
                          "classification.prediction.articletopic/STEM.Mathematics|620",
                        ],
                      },
                    },
                  ],
                },
              ],
            },
          }),
        );
      }
      if (url.searchParams.get("action") === "parse") {
        return new Response(
          JSON.stringify({
            parse: {
              pageid: 974,
              revid: 42,
              title: "Ada Lovelace",
              text: '<section data-mw-section-id="0"><p>Ada Lovelace was an English mathematician.</p></section>',
              tocdata: { sections: [] },
            },
          }),
        );
      }
      return new Response(JSON.stringify({}));
    });

    const fetched = await fetchArticleWithDocumentByTitle("Ada Lovelace");
    expect(fetched.cirrusTopicPredictions).toEqual([
      { topic: "Culture.Biography.Biography*", score: 0.538 },
      { topic: "STEM.Mathematics", score: 0.62 },
    ]);
  });

  it("retries fetchArticleWithDocumentByTitle without cirrusdoc when the combined query fails", async () => {
    const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});
    const queryUrls: URL[] = [];

    vi.spyOn(globalThis, "fetch").mockImplementation(async (input) => {
      const url = new URL(String(input));
      if (url.searchParams.get("action") === "query") {
        queryUrls.push(url);
        if (queryUrls.length === 1) {
          return new Response("cirrus backend unavailable", { status: 503 });
        }
        return new Response(
          JSON.stringify({
            query: {
              pages: [
                {
                  pageid: 974,
                  title: "Ada Lovelace",
                  extract: "Ada Lovelace was an English mathematician.",
                  revisions: [
                    { revid: 42, timestamp: "2026-11-24T00:00:00Z" },
                  ],
                },
              ],
            },
          }),
        );
      }
      if (url.searchParams.get("action") === "parse") {
        return new Response(
          JSON.stringify({
            parse: {
              pageid: 974,
              revid: 42,
              title: "Ada Lovelace",
              text: '<section data-mw-section-id="0"><p>Ada Lovelace was an English mathematician.</p></section>',
              tocdata: { sections: [] },
            },
          }),
        );
      }
      return new Response(JSON.stringify({}));
    });

    const fetched = await fetchArticleWithDocumentByTitle("Ada Lovelace");

    expect(fetched.article.title).toBe("Ada Lovelace");
    expect(fetched.article.wikiPageId).toBe("974");
    expect(fetched.cirrusTopicPredictions).toBeUndefined();
    expect(queryUrls).toHaveLength(2);
    expect(queryUrls[0]?.searchParams.get("prop")).toContain("cirrusdoc");
    expect(queryUrls[0]?.searchParams.get("cdincludes")).toBe("weighted_tags");
    expect(queryUrls[1]?.searchParams.get("prop")).not.toContain("cirrusdoc");
    expect(queryUrls[1]?.searchParams.get("cdincludes")).toBeNull();
    expect(warnSpy).toHaveBeenCalledTimes(1);
  });

  it("retries fetchArticleWithDocumentByPageId without cirrusdoc when the combined query returns an Action API error", async () => {
    const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});
    const queryUrls: URL[] = [];

    vi.spyOn(globalThis, "fetch").mockImplementation(async (input) => {
      const url = new URL(String(input));
      if (url.searchParams.get("action") === "query") {
        queryUrls.push(url);
        if (queryUrls.length === 1) {
          return new Response(
            JSON.stringify({
              error: {
                code: "cirrussearch-backend-error",
                info: "Search backend temporarily unavailable",
              },
            }),
          );
        }
        return new Response(
          JSON.stringify({
            query: {
              pages: [
                {
                  pageid: 974,
                  title: "Ada Lovelace",
                  extract: "Ada Lovelace was an English mathematician.",
                  revisions: [
                    { revid: 42, timestamp: "2026-11-24T00:00:00Z" },
                  ],
                },
              ],
            },
          }),
        );
      }
      if (url.searchParams.get("action") === "parse") {
        return new Response(
          JSON.stringify({
            parse: {
              pageid: 974,
              revid: 42,
              title: "Ada Lovelace",
              text: '<section data-mw-section-id="0"><p>Ada Lovelace was an English mathematician.</p></section>',
              tocdata: { sections: [] },
            },
          }),
        );
      }
      return new Response(JSON.stringify({}));
    });

    const fetched = await fetchArticleWithDocumentByPageId("974");

    expect(fetched.article.title).toBe("Ada Lovelace");
    expect(fetched.article.wikiPageId).toBe("974");
    expect(fetched.cirrusTopicPredictions).toBeUndefined();
    expect(queryUrls).toHaveLength(2);
    expect(queryUrls[0]?.searchParams.get("prop")).toContain("cirrusdoc");
    expect(queryUrls[0]?.searchParams.get("cdincludes")).toBe("weighted_tags");
    expect(queryUrls[1]?.searchParams.get("prop")).not.toContain("cirrusdoc");
    expect(queryUrls[1]?.searchParams.get("cdincludes")).toBeNull();
    expect(warnSpy).toHaveBeenCalledTimes(1);
  });

  it("retries without cirrusdoc within the shared deadline when the combined query stalls", async () => {
    vi.useFakeTimers();
    try {
      vi.spyOn(console, "warn").mockImplementation(() => {});
      const queryUrls: URL[] = [];

      vi.spyOn(globalThis, "fetch").mockImplementation(async (input, init) => {
        const url = new URL(String(input));
        if (url.searchParams.get("action") === "query") {
          queryUrls.push(url);
          if (queryUrls.length === 1) {
            return await new Promise<Response>((_resolve, reject) => {
              init?.signal?.addEventListener(
                "abort",
                () => reject(init.signal?.reason),
                { once: true },
              );
            });
          }
          return new Response(
            JSON.stringify({
              query: {
                pages: [
                  {
                    pageid: 974,
                    title: "Ada Lovelace",
                    extract: "Ada Lovelace was an English mathematician.",
                    revisions: [
                      { revid: 42, timestamp: "2026-11-24T00:00:00Z" },
                    ],
                  },
                ],
              },
            }),
          );
        }
        if (url.searchParams.get("action") === "parse") {
          return new Response(
            JSON.stringify({
              parse: {
                pageid: 974,
                revid: 42,
                title: "Ada Lovelace",
                text: '<section data-mw-section-id="0"><p>Ada Lovelace was an English mathematician.</p></section>',
                tocdata: { sections: [] },
              },
            }),
          );
        }
        return new Response(JSON.stringify({}));
      });

      const pending = fetchArticleWithDocumentByTitle("Ada Lovelace");
      await vi.advanceTimersByTimeAsync(ARTICLE_COMBINED_QUERY_TIMEOUT_MS);
      const fetched = await pending;

      expect(ARTICLE_COMBINED_QUERY_TIMEOUT_MS).toBeLessThan(
        ARTICLE_QUERY_DEADLINE_MS,
      );
      expect(fetched.article.title).toBe("Ada Lovelace");
      expect(fetched.cirrusTopicPredictions).toBeUndefined();
      expect(queryUrls).toHaveLength(2);
      expect(queryUrls[0]?.searchParams.get("prop")).toContain("cirrusdoc");
      expect(queryUrls[1]?.searchParams.get("prop")).not.toContain("cirrusdoc");
      expect(queryUrls[1]?.searchParams.get("cdincludes")).toBeNull();
    } finally {
      vi.useRealTimers();
    }
  });

  it("preserves Wikipedia fetch error status when both combined and article-only queries fail", async () => {
    vi.spyOn(console, "warn").mockImplementation(() => {});
    const queryUrls: URL[] = [];

    vi.spyOn(globalThis, "fetch").mockImplementation(async (input) => {
      const url = new URL(String(input));
      if (url.searchParams.get("action") === "query") {
        queryUrls.push(url);
        return new Response("upstream error", { status: 500 });
      }
      throw new Error(`Unexpected URL: ${url.toString()}`);
    });

    await expect(
      fetchArticleWithDocumentByTitle("Ada Lovelace"),
    ).rejects.toThrow("Wikipedia fetch failed: 500");
    expect(queryUrls).toHaveLength(2);
    expect(queryUrls[0]?.searchParams.get("prop")).toContain("cirrusdoc");
    expect(queryUrls[1]?.searchParams.get("prop")).not.toContain("cirrusdoc");
  });

  it("requests canonical hero pithumbsize and routes /wikipedia/en/ hero attribution to en.wikipedia.org", async () => {
    const heroThumbUrl =
      "https://upload.wikimedia.org/wikipedia/en/f/f6/Fair_Use_Poster.png";
    let heroThumbSize: string | null = null;
    let attributionHost: string | null = null;

    vi.spyOn(globalThis, "fetch").mockImplementation(async (input) => {
      const url = new URL(String(input));

      if (
        url.hostname === "en.wikipedia.org" &&
        url.searchParams.get("action") === "query" &&
        url.searchParams.get("prop") === "imageinfo"
      ) {
        attributionHost = url.hostname;
        expect(url.searchParams.has("iiurlwidth")).toBe(false);
        return new Response(
          JSON.stringify({
            query: {
              pages: [
                {
                  title: "File:Fair Use Poster.png",
                  imageinfo: [
                    {
                      descriptionurl:
                        "https://en.wikipedia.org/wiki/File:Fair_Use_Poster.png",
                      extmetadata: {
                        Credit: { value: "Publisher cover" },
                        LicenseShortName: { value: "Fair use" },
                      },
                    },
                  ],
                },
              ],
            },
          }),
        );
      }

      if (url.searchParams.get("action") === "query") {
        heroThumbSize = url.searchParams.get("pithumbsize");
        return new Response(
          JSON.stringify({
            query: {
              pages: [
                {
                  pageid: 555,
                  title: "Fair Use Film",
                  extract: "Fair Use Film is an example article.",
                  revisions: [
                    { revid: 77, timestamp: "2026-11-24T00:00:00Z" },
                  ],
                  thumbnail: {
                    source: heroThumbUrl,
                    width: 300,
                    height: 450,
                  },
                },
              ],
            },
          }),
        );
      }

      if (url.searchParams.get("action") === "parse") {
        return new Response(
          JSON.stringify({
            parse: {
              pageid: 555,
              revid: 77,
              title: "Fair Use Film",
              text: '<section data-mw-section-id="0"><p>Fair Use Film is an example article.</p></section>',
              tocdata: { sections: [] },
            },
          }),
        );
      }

      throw new Error(`Unexpected URL: ${url.toString()}`);
    });

    const fetched = await fetchArticleWithDocumentByTitle("Fair Use Film");

    expect(heroThumbSize).toBe(String(WIKIMEDIA_THUMBNAIL_WIDTH));
    expect(attributionHost).toBe("en.wikipedia.org");
    expect(fetched.article.thumbnailAttribution).toEqual({
      creator: undefined,
      credit: "Publisher cover",
      licenseName: "Fair use",
      licenseUrl: undefined,
      sourceTitle: "File:Fair Use Poster.png",
      sourceUrl: "https://en.wikipedia.org/wiki/File:Fair_Use_Poster.png",
    });
  });

  it("classifies topics in 1 Lift Wing outlink-topic-model request when cirrusdoc tags are absent", async () => {
    const previousToken = process.env[WIKIMEDIA_OAUTH_ACCESS_TOKEN_ENV];
    process.env[WIKIMEDIA_OAUTH_ACCESS_TOKEN_ENV] = "test-lw-token";
    try {
      const fetchSpy = vi
        .spyOn(globalThis, "fetch")
        .mockResolvedValueOnce(
          new Response(
            JSON.stringify({
              prediction: {
                article: "https://en.wikipedia.org/wiki/Linux_kernel",
                results: [
                  { topic: "STEM.STEM*", score: 0.96 },
                  { topic: "STEM.Computing", score: 0.91 },
                  { topic: "Culture.Media.Software", score: 0.64 },
                  { topic: "History_and_Society.History", score: 0.35 },
                ],
              },
            }),
            { status: 200, headers: { "Content-Type": "application/json" } },
          ),
        );

      const badges = await fetchArticleBadgeKeys("21347315", {
        title: "Linux kernel",
      });

      expect(badges).toEqual(["science", "technology"]);
      expect(fetchSpy).toHaveBeenCalledTimes(1);
      const [calledUrl, calledInit] = fetchSpy.mock.calls[0] ?? [];
      expect(String(calledUrl)).toBe(WIKIMEDIA_OUTLINK_TOPIC_MODEL_URL);
      expect(calledInit?.method).toBe("POST");
      expect(calledInit?.headers).toEqual(
        expect.objectContaining({
          "User-Agent": WIKIMEDIA_USER_AGENT,
          Authorization: "Bearer test-lw-token",
        }),
      );
      expect(JSON.parse(String(calledInit?.body))).toEqual({
        page_title: "Linux kernel",
        lang: "en",
      });
    } finally {
      if (previousToken === undefined) {
        delete process.env[WIKIMEDIA_OAUTH_ACCESS_TOKEN_ENV];
      } else {
        process.env[WIKIMEDIA_OAUTH_ACCESS_TOKEN_ENV] = previousToken;
      }
    }
  });

  it("uses 1 cirrusdoc pageid lookup when called without a title", async () => {
    const fetchSpy = vi.spyOn(globalThis, "fetch").mockResolvedValueOnce(
      new Response(
        JSON.stringify({
          query: {
            pages: [
              {
                pageid: 974,
                title: "Ada Lovelace",
                cirrusdoc: [
                  {
                    source: {
                      weighted_tags: [
                        "classification.prediction.articletopic/Culture.Biography.Biography*|802",
                      ],
                    },
                  },
                ],
              },
            ],
          },
        }),
        { status: 200, headers: { "Content-Type": "application/json" } },
      ),
    );

    const badges = await fetchArticleBadgeKeys("974");

    expect(badges).toEqual(["biography"]);
    expect(fetchSpy).toHaveBeenCalledTimes(1);
    const url = new URL(String(fetchSpy.mock.calls[0]?.[0]));
    expect(url.searchParams.get("prop")).toBe("cirrusdoc");
    expect(url.searchParams.get("cdincludes")).toBe("weighted_tags");
  });

  it("caps fallback CirrusSearch concurrency to at most 2 requests when Lift Wing fails", async () => {
    const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});
    let inFlightFallback = 0;
    let maxConcurrentFallback = 0;
    let fallbackCallCount = 0;

    vi.spyOn(globalThis, "fetch").mockImplementation(async (input) => {
      const url = new URL(String(input));
      if (url.toString() === WIKIMEDIA_OUTLINK_TOPIC_MODEL_URL) {
        return new Response("service unavailable", {
          status: 503,
          headers: { "Retry-After": "60" },
        });
      }

      if (url.searchParams.get("list") === "search") {
        fallbackCallCount += 1;
        inFlightFallback += 1;
        maxConcurrentFallback = Math.max(
          maxConcurrentFallback,
          inFlightFallback,
        );
        await new Promise((resolve) => setTimeout(resolve, 5));
        inFlightFallback -= 1;

        const srsearch = url.searchParams.get("srsearch") ?? "";
        const matched =
          srsearch.includes("articletopic:history") ||
          srsearch.includes("articletopic:biology");
        return new Response(
          JSON.stringify({
            query: {
              search: matched ? [{ pageid: 974, title: "Ada Lovelace" }] : [],
            },
          }),
          { status: 200, headers: { "Content-Type": "application/json" } },
        );
      }

      throw new Error(`Unexpected URL: ${url.toString()}`);
    });

    const badges = await fetchArticleBadgeKeys("974", {
      title: "Ada Lovelace",
    });

    expect(badges).toEqual(["history", "nature"]);
    expect(fallbackCallCount).toBe(8);
    expect(maxConcurrentFallback).toBeGreaterThan(0);
    expect(maxConcurrentFallback).toBeLessThanOrEqual(
      BADGE_TOPIC_FALLBACK_MAX_CONCURRENCY,
    );
    expect(warnSpy).toHaveBeenCalledTimes(1);
  });

  it("stops queuing remaining fallback searches when CirrusSearch is rate limited", async () => {
    vi.spyOn(console, "warn").mockImplementation(() => {});
    let fallbackCalls = 0;

    vi.spyOn(globalThis, "fetch").mockImplementation(async (input) => {
      const url = new URL(String(input));
      if (url.toString() === WIKIMEDIA_OUTLINK_TOPIC_MODEL_URL) {
        return new Response("rate limited", {
          status: 429,
          headers: { "Retry-After": "60" },
        });
      }
      fallbackCalls += 1;
      await new Promise((resolve) => setTimeout(resolve, 5));
      return new Response("rate limited", {
        status: 429,
        headers: { "Retry-After": "60" },
      });
    });

    await expect(
      fetchArticleBadgeKeys("974", { title: "Ada Lovelace" }),
    ).rejects.toThrow("Wikipedia articletopic search failed: 429");
    expect(fallbackCalls).toBeLessThanOrEqual(
      BADGE_TOPIC_FALLBACK_MAX_CONCURRENCY,
    );
  });
});

describe("fetchRelatedArticles CirrusSearch morelike:", () => {
  it("builds unquoted morelike queries preserving colons and quotes", () => {
    expect(buildMoreLikeSearchQuery("Ada_Lovelace")).toBe(
      "morelike:Ada Lovelace",
    );
    expect(buildMoreLikeSearchQuery('Spider-Man: No Way Home')).toBe(
      "morelike:Spider-Man: No Way Home",
    );
    expect(buildMoreLikeSearchQuery('"Weird Al"  Yankovic')).toBe(
      'morelike:"Weird Al" Yankovic',
    );
  });

  it("fetches related mainspace articles in 1 request, preserves relevance order, and filters self, disambiguation, and NSFW pages", async () => {
    const fetchSpy = vi.spyOn(globalThis, "fetch").mockResolvedValueOnce(
      new Response(
        JSON.stringify({
          continue: { gsroffset: 12, continue: "gsroffset||" },
          query: {
            pages: [
              // Deliberately out of relevance order and alphabetically inverted
              {
                pageid: 5698,
                ns: 0,
                title: "Charles Babbage",
                index: 5,
                description: "English mathematician and inventor",
                categories: [{ title: "Category:English mathematicians" }],
              },
              {
                pageid: 70923477,
                ns: 0,
                title: "Note G",
                index: 1,
                description: "Computer algorithm",
                thumbnail: {
                  source:
                    "https://upload.wikimedia.org/wikipedia/commons/thumb/a/ab/Note_G.jpg/500px-Note_G.jpg",
                  width: 500,
                  height: 350,
                },
                categories: [{ title: "Category:Algorithms" }],
              },
              {
                pageid: 974,
                ns: 0,
                title: "Ada Lovelace",
                index: 2,
                description: "Self article should be excluded",
                categories: [{ title: "Category:English mathematicians" }],
              },
              {
                pageid: 3001,
                ns: 0,
                title: "Lovelace (disambiguation)",
                index: 3,
                description: "Topics referred to by the same term",
                pageprops: { disambiguation: "" },
                categories: [{ title: "Category:Disambiguation pages" }],
              },
              {
                pageid: 3002,
                ns: 0,
                title: "Explicit Topic",
                index: 4,
                description: "Should be filtered out by NSFW category",
                categories: [{ title: "Category:Pornography terminology" }],
              },
              {
                pageid: 1271,
                ns: 0,
                title: "Analytical engine",
                index: 6,
                description: "19th century proposed mechanical computer",
                categories: [{ title: "Category:Mechanical calculators" }],
              },
              {
                pageid: 3003,
                ns: 4,
                title: "Wikipedia:Ada Lovelace Day",
                index: 7,
                description: "Project namespace page should be excluded",
              },
            ],
          },
        }),
        { status: 200, headers: { "Content-Type": "application/json" } },
      ),
    );

    const results = await fetchRelatedArticles({
      wikiPageId: "974",
      title: "Ada Lovelace",
      language: "en",
    });

    expect(fetchSpy).toHaveBeenCalledTimes(1);
    const url = new URL(String(fetchSpy.mock.calls[0]?.[0]));
    expect(url.hostname).toBe("en.wikipedia.org");
    expect(url.searchParams.get("action")).toBe("query");
    expect(url.searchParams.get("generator")).toBe("search");
    expect(url.searchParams.get("gsrsearch")).toBe("morelike:Ada Lovelace");
    expect(url.searchParams.get("gsrnamespace")).toBe("0");
    expect(url.searchParams.get("prop")).toBe(
      "description|pageimages|pageprops|categories",
    );
    expect(url.searchParams.get("ppprop")).toBe("disambiguation");
    expect(url.searchParams.get("clshow")).toBe("!hidden");
    expect(url.searchParams.get("cllimit")).toBe("max");
    expect(url.searchParams.get("pithumbsize")).toBe(
      String(WIKIMEDIA_FEED_THUMBNAIL_WIDTH),
    );

    // Relevance order preserved: index 1 ("Note G"), index 5 ("Charles Babbage"), index 6 ("Analytical engine")
    expect(results).toEqual([
      {
        wikiPageId: "70923477",
        title: "Note G",
        description: "Computer algorithm",
        thumbnail: {
          source:
            "https://upload.wikimedia.org/wikipedia/commons/thumb/a/ab/Note_G.jpg/500px-Note_G.jpg",
          width: 500,
          height: 350,
        },
      },
      {
        wikiPageId: "5698",
        title: "Charles Babbage",
        description: "English mathematician and inventor",
      },
      {
        wikiPageId: "1271",
        title: "Analytical engine",
        description: "19th century proposed mechanical computer",
      },
    ]);
  });

  it("fails closed on pages whose categories were truncated by clcontinue", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValueOnce(
      new Response(
        JSON.stringify({
          continue: {
            clcontinue: "5000|Category:Some_category",
            continue: "||",
          },
          query: {
            pages: [
              {
                pageid: 1271,
                ns: 0,
                title: "Analytical engine",
                index: 1,
                categories: [{ title: "Category:Mechanical calculators" }],
              },
              {
                pageid: 5000,
                ns: 0,
                title: "Truncated Categories Page",
                index: 2,
                categories: [{ title: "Category:Safe so far" }],
              },
            ],
          },
        }),
        { status: 200, headers: { "Content-Type": "application/json" } },
      ),
    );

    const results = await fetchRelatedArticles({
      wikiPageId: "974",
      title: "Ada Lovelace",
      language: "en",
    });

    expect(results).toEqual([
      {
        wikiPageId: "1271",
        title: "Analytical engine",
      },
    ]);
  });

  it("returns an empty array when morelike yields no matches and throws on upstream errors", async () => {
    const fetchSpy = vi
      .spyOn(globalThis, "fetch")
      .mockResolvedValueOnce(
        new Response(JSON.stringify({ batchcomplete: true }), { status: 200 }),
      )
      .mockResolvedValueOnce(
        new Response("service unavailable", {
          status: 503,
          headers: { "Retry-After": "60" },
        }),
      );

    await expect(
      fetchRelatedArticles({
        wikiPageId: "974",
        title: "Obscure Stub",
        language: "en",
      }),
    ).resolves.toEqual([]);

    await expect(
      fetchRelatedArticles({
        wikiPageId: "974",
        title: "Ada Lovelace",
        language: "en",
      }),
    ).rejects.toThrow("Wikipedia related articles search failed: 503");

    expect(fetchSpy).toHaveBeenCalledTimes(2);
  });
});
