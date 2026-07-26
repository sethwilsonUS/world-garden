import { describe, expect, it, vi } from "vitest";
import fc from "fast-check";
import {
  loadMediaWikiDocument,
  MediaWikiSourceError,
  type MediaWikiDocumentRequest,
  type MediaWikiRevisionRequest,
} from "./index";
import { extractArticleContextFromDocument } from "../article-context-document";
import { createSectionNarrationsFromDocument } from "../section-narration-document";

const request: MediaWikiRevisionRequest = {
  wikiPageId: "384816",
  title: "Walter Savage Landor",
  revisionId: "1342291773",
  language: "en",
};

const jsonResponse = (value: unknown, status = 200): Response =>
  new Response(JSON.stringify(value), {
    status,
    headers: { "Content-Type": "application/json" },
  });

const parsoidPayload = (
  html: string,
  sections: readonly Record<string, unknown>[] = [],
) => ({
  parse: {
    pageid: Number(request.wikiPageId),
    title: request.title,
    revid: Number(request.revisionId),
    tocdata: { sections },
    text: html,
  },
});

const escapeAttribute = (value: string): string =>
  value
    .replace(/&/g, "&amp;")
    .replace(/"/g, "&quot;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");

describe("loadMediaWikiDocument", () => {
  it("loads revision-pinned Parsoid HTML into ordered semantic sections", async () => {
    const fetchImpl = vi.fn(async (input: string | URL | Request) => {
      const url = new URL(String(input));
      expect(url.searchParams.get("oldid")).toBe(request.revisionId);
      expect(url.searchParams.get("parser")).toBe("parsoid");
      expect(url.searchParams.get("prop")).toContain("tocdata");
      return jsonResponse({
        parse: {
          pageid: Number(request.wikiPageId),
          title: request.title,
          revid: Number(request.revisionId),
          tocdata: {
            sections: [
              {
                index: "1",
                line: "History",
                anchor: "History",
                level: 1,
              },
            ],
          },
          text: [
            '<div class="mw-parser-output">',
            '<section data-mw-section-id="0"><p>Lead prose.</p>',
            '<section data-mw-section-id="1"><h2 id="History">History</h2>',
            '<p>A paragraph with <a rel="mw:WikiLink" href="./Poetry" title="Poetry">poetry</a>.</p>',
            "<ul><li>First item<ul><li>Nested item</li></ul></li></ul>",
            "</section></section></div>",
          ].join(""),
        },
      });
    });

    const document = await loadMediaWikiDocument(request, { fetchImpl });

    expect(document.schemaVersion).toBe(1);
    expect(document.sourceFormat).toBe("parsoid");
    expect(document.identity).toEqual(request);
    expect(document.sections).toHaveLength(2);
    expect(document.sections[0]).toMatchObject({
      key: "__summary__",
      title: "Summary",
      level: 0,
      role: "body",
      fidelity: "complete",
      fallback: { text: "Lead prose.", source: "dom-text" },
    });
    expect(document.sections[1]).toMatchObject({
      key: "1",
      title: "History",
      level: 1,
      parentKey: "__summary__",
      anchor: "History",
      role: "body",
      fidelity: "complete",
      fallback: {
        text: "A paragraph with poetry. First item Nested item",
        source: "dom-text",
      },
    });
    expect(document.sections[1].blocks).toMatchObject([
      { kind: "prose", role: "paragraph", text: "A paragraph with poetry." },
      {
        kind: "list",
        list: {
          style: "unordered",
          items: [
            {
              parts: [
                { kind: "text", text: "First item" },
                {
                  kind: "list",
                  list: {
                    style: "unordered",
                    items: [
                      {
                        parts: [{ kind: "text", text: "Nested item" }],
                      },
                    ],
                  },
                },
              ],
            },
          ],
        },
      },
    ]);
    expect(document.sections[1].links).toMatchObject([
      { targetTitle: "Poetry", href: "https://en.wikipedia.org/wiki/Poetry" },
    ]);
    expect(JSON.stringify(document)).not.toContain("<p>");
    expect(fetchImpl).toHaveBeenCalledTimes(1);
  });

  it("preserves description-list ordering, nesting, and ordered-list starts", async () => {
    const html = [
      '<section data-mw-section-id="0"><p>Lead.</p>',
      '<section data-mw-section-id="1"><h2>Terms</h2>',
      "<dl><dt>First term</dt><dd>First definition",
      "<ul><li>Nested detail</li></ul></dd>",
      "<dt>Second term</dt><dd>Second definition</dd></dl>",
      '<ol start="4"><li>Fourth</li><li>Fifth</li></ol>',
      "</section></section>",
    ].join("");
    const plaintext =
      "First term First definition Nested detail Second term Second definition Fourth Fifth";
    const document = await loadMediaWikiDocument(
      {
        ...request,
        plaintext: {
          lead: "Lead.",
          sections: [{ index: "1", title: "Terms", level: 1, text: plaintext }],
        },
      },
      {
        fetchImpl: vi.fn(async () =>
          jsonResponse(
            parsoidPayload(html, [{ index: "1", line: "Terms", level: 1 }]),
          ),
        ),
      },
    );

    expect(document.sections[1]).toMatchObject({
      fidelity: "complete",
      plaintextContent: plaintext,
      fallback: { text: plaintext, source: "dom-text" },
      blocks: [
        {
          kind: "list",
          list: {
            style: "description",
            items: [
              { parts: [{ kind: "text", text: "First term" }] },
              {
                parts: [
                  { kind: "text", text: "First definition" },
                  {
                    kind: "list",
                    list: {
                      style: "unordered",
                      items: [
                        {
                          parts: [{ kind: "text", text: "Nested detail" }],
                        },
                      ],
                    },
                  },
                ],
              },
              { parts: [{ kind: "text", text: "Second term" }] },
              { parts: [{ kind: "text", text: "Second definition" }] },
            ],
          },
        },
        {
          kind: "list",
          list: {
            style: "ordered",
            start: 4,
            items: [
              { parts: [{ kind: "text", text: "Fourth" }] },
              { parts: [{ kind: "text", text: "Fifth" }] },
            ],
          },
        },
      ],
    });
  });

  it("preserves text around a nested list in exact source order", async () => {
    const html = [
      '<section data-mw-section-id="0"><p>Lead.</p>',
      '<section data-mw-section-id="1"><h2>Steps</h2>',
      "<ul><li>Before<ul><li>Nested</li></ul>After</li></ul>",
      "</section></section>",
    ].join("");
    const document = await loadMediaWikiDocument(request, {
      fetchImpl: vi.fn(async () =>
        jsonResponse(
          parsoidPayload(html, [{ index: "1", line: "Steps", level: 1 }]),
        ),
      ),
    });
    const list = document.sections[1].blocks.find(
      (block) => block.kind === "list",
    );

    expect(list).toMatchObject({
      kind: "list",
      list: {
        items: [
          {
            parts: [
              { kind: "text", text: "Before" },
              {
                kind: "list",
                list: {
                  items: [{ parts: [{ kind: "text", text: "Nested" }] }],
                },
              },
              { kind: "text", text: "After" },
            ],
          },
        ],
      },
    });
  });

  it("marks structural content nested inside a list item for complete plaintext fallback", async () => {
    const html = [
      '<section data-mw-section-id="0"><p>Lead.</p>',
      '<section data-mw-section-id="1"><h2>Catalogue</h2>',
      "<ul><li>Entry before<table><tr><td>Embedded data</td></tr></table>",
      "Entry after</li></ul></section></section>",
    ].join("");
    const document = await loadMediaWikiDocument(
      {
        ...request,
        plaintext: {
          lead: "Lead.",
          sections: [
            {
              index: "1",
              title: "Catalogue",
              level: 1,
              text: "Entry before Embedded data Entry after",
            },
          ],
        },
      },
      {
        fetchImpl: vi.fn(async () =>
          jsonResponse(
            parsoidPayload(html, [{ index: "1", line: "Catalogue", level: 1 }]),
          ),
        ),
      },
    );

    expect(document.sections[1]).toMatchObject({
      fidelity: "partial",
      fallback: {
        text: "Entry before Embedded data Entry after",
        source: "dom-text",
      },
      blocks: [
        {
          kind: "unsupported",
          sourceKind: "list",
          reason: "unsupported-block",
          affectsNarration: true,
        },
      ],
    });
    expect(document.issues).toContainEqual(
      expect.objectContaining({
        code: "unsupported-block",
        severity: "fallback",
        sectionKey: "1",
      }),
    );
  });

  it("does not turn non-narrative list metadata into a structural fallback", async () => {
    const html = [
      '<section data-mw-section-id="0"><p>Lead.</p>',
      '<section data-mw-section-id="1"><h2>Catalogue</h2>',
      '<ul><li><link typeof="mw:Extension/templatestyles">Source entry</li></ul>',
      "</section></section>",
    ].join("");
    const document = await loadMediaWikiDocument(request, {
      fetchImpl: vi.fn(async () =>
        jsonResponse(
          parsoidPayload(html, [{ index: "1", line: "Catalogue", level: 1 }]),
        ),
      ),
    });

    expect(document.sections[1]).toMatchObject({
      fidelity: "complete",
      blocks: [
        {
          kind: "list",
          list: {
            items: [{ parts: [{ kind: "text", text: "Source entry" }] }],
          },
        },
      ],
    });
  });

  it("marks a known embedded chart inside a list item for complete fallback", async () => {
    const chart = escapeAttribute(
      JSON.stringify({ spec: { data: [{ year: 2020, value: 5 }] } }),
    );
    const html = [
      '<section data-mw-section-id="0"><p>Lead.</p>',
      '<section data-mw-section-id="1"><h2>Catalogue</h2>',
      `<ul><li>Chart entry<wiki-chart data-mw-chart="${chart}"></wiki-chart></li></ul>`,
      "</section></section>",
    ].join("");
    const document = await loadMediaWikiDocument(request, {
      fetchImpl: vi.fn(async () =>
        jsonResponse(
          parsoidPayload(html, [{ index: "1", line: "Catalogue", level: 1 }]),
        ),
      ),
    });

    expect(document.sections[1]).toMatchObject({
      fidelity: "partial",
      blocks: [
        {
          kind: "unsupported",
          sourceKind: "list",
          reason: "unsupported-block",
        },
        {
          kind: "extension",
          extension: {
            kind: "chart",
            spec: { data: [{ year: 2020, value: 5 }] },
          },
        },
      ],
    });
    expect(
      createSectionNarrationsFromDocument(document)[0].narration,
    ).toMatchObject({
      mode: "verbatim",
      usedRawFallback: true,
      text: "Catalogue. Chart entry",
    });
  });

  it("projects inline GeoJSON nested inside an infobox as an ordered sibling visual", async () => {
    const mapDataMw = escapeAttribute(
      JSON.stringify({
        name: "mapframe",
        body: {
          extsrc: JSON.stringify({
            type: "Point",
            coordinates: [-110.5, 44.6],
          }),
        },
      }),
    );
    const html = [
      '<section data-mw-section-id="0"><p>Lead.</p>',
      '<section data-mw-section-id="1"><h2>Geography</h2>',
      '<table class="infobox"><tbody><tr><th scope="row">Location</th><td>',
      `<span typeof="mw:Extension/mapframe" data-mw="${mapDataMw}">Yellowstone map</span>`,
      "</td></tr></tbody></table>",
      "</section></section>",
    ].join("");
    const document = await loadMediaWikiDocument(request, {
      fetchImpl: vi.fn(async () =>
        jsonResponse(
          parsoidPayload(html, [{ index: "1", line: "Geography", level: 1 }]),
        ),
      ),
    });

    expect(document.sections[1].blocks).toMatchObject([
      { kind: "table" },
      {
        kind: "extension",
        extension: {
          kind: "kartographer",
          presentation: "mapframe",
          geoJson: { type: "Point", coordinates: [-110.5, 44.6] },
        },
      },
    ]);
    expect(document.sections[1].blocks[0].sourceOrder).toBeLessThan(
      document.sections[1].blocks[1].sourceOrder,
    );
    expect(
      extractArticleContextFromDocument(document, {
        now: () => new Date("2026-07-25T12:00:00.000Z"),
      }).blocks,
    ).toMatchObject([{ kind: "map" }]);
  });

  it("promotes substantial nested media without turning tiny icons into figure siblings", async () => {
    const html = [
      '<section data-mw-section-id="0"><p>Lead.</p>',
      '<section data-mw-section-id="1"><h2>Symbols</h2>',
      '<table class="infobox"><tbody><tr><th scope="row">Media</th><td>',
      '<span typeof="mw:File/Thumb"><img src="//upload.wikimedia.org/tiny-flag.svg" alt="Tiny flag" width="24" height="16"></span>',
      '<span typeof="mw:File/Thumb"><img src="//upload.wikimedia.org/substantial-map.svg" alt="Substantial map" width="320" height="180"></span>',
      "</td></tr></tbody></table>",
      "</section></section>",
    ].join("");
    const document = await loadMediaWikiDocument(request, {
      fetchImpl: vi.fn(async () =>
        jsonResponse(
          parsoidPayload(html, [{ index: "1", line: "Symbols", level: 1 }]),
        ),
      ),
    });

    expect(document.sections[1].blocks).toMatchObject([
      { kind: "table" },
      {
        kind: "figure",
        media: [
          {
            src: "https://upload.wikimedia.org/substantial-map.svg",
            alt: "Substantial map",
            width: 320,
            height: 180,
          },
        ],
      },
    ]);
    expect(JSON.stringify(document.sections[1].blocks)).not.toContain(
      "tiny-flag.svg",
    );
  });

  it("turns formatted tocdata labels into plain section identity", async () => {
    const html = [
      '<section data-mw-section-id="0"><p>Lead.</p>',
      '<section data-mw-section-id="1"><h2>South Wales and <i>Gebir</i></h2>',
      "<p>Section text.</p></section></section>",
    ].join("");
    const document = await loadMediaWikiDocument(request, {
      fetchImpl: vi.fn(async () =>
        jsonResponse(
          parsoidPayload(html, [
            {
              index: "1",
              line: "South Wales and <i>Gebir</i>",
              level: 1,
            },
          ]),
        ),
      ),
    });

    expect(document.sections[1].title).toBe("South Wales and Gebir");
    expect(JSON.stringify(document.sections[1])).not.toContain("<i>");
  });

  it("retries with legacy parsed HTML when MediaWiki rejects the Parsoid parser", async () => {
    const fetchImpl = vi.fn(async (input: string | URL | Request) => {
      const url = new URL(String(input));
      if (url.searchParams.get("parser") === "parsoid") {
        return jsonResponse(
          { error: { code: "badvalue", info: "Unrecognized parser value" } },
          400,
        );
      }
      expect(url.searchParams.has("parser")).toBe(false);
      expect(url.searchParams.get("prop")).toContain("sections");
      return jsonResponse({
        parse: {
          pageid: Number(request.wikiPageId),
          title: request.title,
          revid: Number(request.revisionId),
          sections: [
            { index: "1", line: "History", anchor: "History", level: "2" },
          ],
          text: '<p>Legacy lead.</p><h2 id="History">History</h2><p>Legacy section.</p>',
        },
      });
    });

    const document = await loadMediaWikiDocument(request, { fetchImpl });

    expect(document.sourceFormat).toBe("legacy");
    expect(document.sections.map((section) => section.key)).toEqual([
      "__summary__",
      "1",
    ]);
    expect(document.sections[1]).toMatchObject({
      title: "History",
      anchor: "History",
      fallback: { text: "Legacy section.", source: "dom-text" },
    });
    expect(fetchImpl).toHaveBeenCalledTimes(2);
  });

  it("retains one nested visual sibling when parsing legacy fallback HTML", async () => {
    const mapDataMw = escapeAttribute(
      JSON.stringify({
        name: "mapframe",
        body: {
          extsrc: JSON.stringify({
            type: "Point",
            coordinates: [-87.6298, 41.8781],
          }),
        },
      }),
    );
    const fetchImpl = vi.fn(async (input: string | URL | Request) => {
      const url = new URL(String(input));
      if (url.searchParams.get("parser") === "parsoid") {
        return jsonResponse(
          { error: { code: "badvalue", info: "Unrecognized parser value" } },
          400,
        );
      }
      return jsonResponse({
        parse: {
          pageid: Number(request.wikiPageId),
          title: request.title,
          revid: Number(request.revisionId),
          sections: [
            { index: "1", line: "Geography", anchor: "Geography", level: "2" },
          ],
          text: [
            "<p>Legacy lead.</p>",
            '<h2 id="Geography">Geography</h2>',
            '<table class="infobox"><tbody><tr><td>',
            `<span typeof="mw:Extension/mapframe" data-mw="${mapDataMw}">Chicago map</span>`,
            "</td></tr></tbody></table>",
          ].join(""),
        },
      });
    });

    const document = await loadMediaWikiDocument(request, { fetchImpl });

    expect(document.sourceFormat).toBe("legacy");
    expect(document.sections[1].blocks).toMatchObject([
      { kind: "unsupported", sourceKind: "table" },
      {
        kind: "extension",
        extension: {
          kind: "kartographer",
          geoJson: { type: "Point", coordinates: [-87.6298, 41.8781] },
        },
      },
    ]);
  });

  it("retries legacy HTML when Parsoid section annotations are incomplete", async () => {
    const fetchImpl = vi.fn(async (input: string | URL | Request) => {
      const url = new URL(String(input));
      if (url.searchParams.get("parser") === "parsoid") {
        return jsonResponse(
          parsoidPayload(
            '<section data-mw-section-id="0"><p>Lead.</p>' +
              '<section data-mw-section-id="1"><h2>First</h2><p>One.</p></section></section>',
            [
              { index: "1", line: "First", level: 1 },
              { index: "2", line: "Second", level: 1 },
            ],
          ),
        );
      }
      return jsonResponse({
        parse: {
          pageid: Number(request.wikiPageId),
          title: request.title,
          revid: Number(request.revisionId),
          sections: [
            { index: "1", line: "First", level: "2" },
            { index: "2", line: "Second", level: "2" },
          ],
          text:
            "<p>Lead.</p><h2>First</h2><p>One.</p>" +
            "<h2>Second</h2><p>Two.</p>",
        },
      });
    });

    const document = await loadMediaWikiDocument(
      {
        ...request,
        plaintext: {
          lead: "Lead.",
          sections: [
            { index: "1", title: "First", level: 2, text: "One." },
            { index: "2", title: "Second", level: 2, text: "Two." },
          ],
        },
      },
      { fetchImpl },
    );

    expect(document.sourceFormat).toBe("legacy");
    expect(document.sections.map((section) => section.key)).toEqual([
      "__summary__",
      "1",
      "2",
    ]);
    expect(fetchImpl).toHaveBeenCalledTimes(2);
  });

  it("uses plaintext if a missing Parsoid contract cannot be recovered by legacy HTML", async () => {
    const fetchImpl = vi.fn(async () => {
      if (fetchImpl.mock.calls.length === 1) {
        return jsonResponse(
          parsoidPayload("<div><p>HTML without semantic sections.</p></div>"),
        );
      }
      throw new TypeError("legacy endpoint unavailable");
    });

    const document = await loadMediaWikiDocument(
      { ...request, plaintext: { lead: "Complete lead.", sections: [] } },
      { fetchImpl },
    );

    expect(fetchImpl).toHaveBeenCalledTimes(2);
    expect(document).toMatchObject({
      sourceFormat: "plaintext",
      fallbackReason: "unsupported-html-contract",
    });
  });

  it("uses the revision-matched plaintext contract when structured HTML is unavailable", async () => {
    const input: MediaWikiDocumentRequest = {
      ...request,
      plaintext: {
        lead: "Complete lead text.",
        sections: [
          { index: "1", title: "History", level: 2, text: "Complete history." },
          {
            index: "2",
            title: "References",
            level: 2,
            text: "A cited source.",
          },
        ],
      },
    };
    const fetchImpl = vi.fn(async () => {
      throw new TypeError("network unavailable");
    });

    const document = await loadMediaWikiDocument(input, { fetchImpl });

    expect(fetchImpl).toHaveBeenCalledTimes(1);
    expect(document).toMatchObject({
      sourceFormat: "plaintext",
      fallbackReason: "html-unavailable",
      identity: request,
      issues: [{ code: "parse-fallback", severity: "fallback" }],
    });
    expect(document.sections).toMatchObject([
      {
        key: "__summary__",
        role: "body",
        fidelity: "plaintext",
        fallback: {
          text: "Complete lead text.",
          source: "mediawiki-plaintext",
        },
        blocks: [{ kind: "prose", text: "Complete lead text." }],
      },
      {
        key: "1",
        parentKey: "__summary__",
        role: "body",
        fidelity: "plaintext",
      },
      {
        key: "2",
        parentKey: "__summary__",
        role: "end-matter",
        fidelity: "plaintext",
      },
    ]);
  });

  it("rejects an oversized response before reading it and uses plaintext", async () => {
    let bodyRead = false;
    const response = new Response("{}", {
      headers: { "Content-Length": "16000000" },
    });
    Object.defineProperty(response, "text", {
      value: async () => {
        bodyRead = true;
        return "{}";
      },
    });
    const document = await loadMediaWikiDocument(
      { ...request, plaintext: { lead: "Safe fallback.", sections: [] } },
      { fetchImpl: vi.fn(async () => response) },
    );

    expect(bodyRead).toBe(false);
    expect(document).toMatchObject({
      sourceFormat: "plaintext",
      fallbackReason: "document-limit",
    });
  });

  it("bounds hostile DOM depth before semantic traversal", async () => {
    const html = [
      '<section data-mw-section-id="0">',
      "<div>".repeat(140),
      "<p>Too deeply nested.</p>",
      "</div>".repeat(140),
      "</section>",
    ].join("");
    const document = await loadMediaWikiDocument(
      { ...request, plaintext: { lead: "Complete lead.", sections: [] } },
      {
        fetchImpl: vi.fn(async () => jsonResponse(parsoidPayload(html))),
      },
    );

    expect(document).toMatchObject({
      sourceFormat: "plaintext",
      fallbackReason: "document-limit",
    });
    expect(document.issues).toContainEqual({
      code: "depth-limit",
      severity: "fallback",
    });
  });

  it("does not hide a revision identity mismatch behind plaintext fallback", async () => {
    const fetchImpl = vi.fn(async () =>
      jsonResponse({
        parse: {
          pageid: Number(request.wikiPageId),
          title: request.title,
          revid: Number(request.revisionId) + 1,
          text: '<section data-mw-section-id="0"><p>Wrong revision.</p></section>',
        },
      }),
    );

    await expect(
      loadMediaWikiDocument(
        { ...request, plaintext: { lead: "Fallback.", sections: [] } },
        { fetchImpl },
      ),
    ).rejects.toMatchObject({
      code: "identity-mismatch",
    } satisfies Partial<MediaWikiSourceError>);
    expect(fetchImpl).toHaveBeenCalledTimes(1);
  });

  it("normalizes semantic table spans and explicit header paths", async () => {
    const html = [
      '<section data-mw-section-id="0"><p>Lead.</p>',
      '<section data-mw-section-id="1"><h2 id="Data">Data</h2>',
      "<table><caption>Population</caption><thead>",
      '<tr><th id="region" rowspan="2" scope="rowgroup">Region</th>',
      '<th id="population" colspan="2" scope="colgroup">Population</th></tr>',
      '<tr><th id="y2020" scope="col">2020</th><th id="y2021" scope="col">2021</th></tr>',
      '</thead><tbody><tr><th id="north" scope="row">North</th>',
      '<td headers="population y2020 north">10</td>',
      '<td headers="population y2021 north">12</td></tr></tbody></table>',
      "</section></section>",
    ].join("");
    const fetchImpl = vi.fn(async () =>
      jsonResponse(
        parsoidPayload(html, [
          { index: "1", line: "Data", anchor: "Data", level: 1 },
        ]),
      ),
    );

    const document = await loadMediaWikiDocument(request, { fetchImpl });
    const block = document.sections[1].blocks.find(
      (candidate) => candidate.kind === "table",
    );

    expect(block?.kind).toBe("table");
    if (!block || block.kind !== "table")
      throw new Error("table not projected");
    expect(block.table).toMatchObject({
      caption: "Population",
      rowCount: 3,
      columnCount: 3,
    });
    expect(block.table.grid).toEqual([
      [
        block.table.cells[0].id,
        block.table.cells[1].id,
        block.table.cells[1].id,
      ],
      [
        block.table.cells[0].id,
        block.table.cells[2].id,
        block.table.cells[3].id,
      ],
      [
        block.table.cells[4].id,
        block.table.cells[5].id,
        block.table.cells[6].id,
      ],
    ]);
    expect(block.table.cells[5]).toMatchObject({
      kind: "data",
      text: "10",
      explicitHeaderIds: [
        block.table.cells[1].id,
        block.table.cells[2].id,
        block.table.cells[4].id,
      ],
      associatedHeaderCellIds: [
        block.table.cells[1].id,
        block.table.cells[2].id,
        block.table.cells[4].id,
      ],
      headerPath: ["Population", "2020", "North"],
    });
    expect(document.sections[1].fidelity).toBe("complete");
    expect(document.issues).toEqual([]);
  });

  it("resolves transitive explicit table-header paths without cycles", async () => {
    const html = [
      '<section data-mw-section-id="0"><p>Lead.</p>',
      '<section data-mw-section-id="1"><h2>Data</h2><table>',
      '<tr><th id="population" colspan="2">Population</th></tr>',
      '<tr><th id="year" headers="population">Year</th>',
      '<th id="value" headers="population">Value</th></tr>',
      '<tr><td headers="year">2020</td><td headers="value">12</td></tr>',
      "</table></section></section>",
    ].join("");
    const document = await loadMediaWikiDocument(request, {
      fetchImpl: vi.fn(async () =>
        jsonResponse(
          parsoidPayload(html, [{ index: "1", line: "Data", level: 1 }]),
        ),
      ),
    });
    const block = document.sections[1].blocks[0];
    expect(block.kind).toBe("table");
    if (block.kind !== "table") throw new Error("table not projected");
    expect(block.table.cells[3].headerPath).toEqual(["Population", "Year"]);
    expect(block.table.cells[4].headerPath).toEqual(["Population", "Value"]);
  });

  it("applies HTML rowspan zero through the end of its row group", async () => {
    const html = [
      '<section data-mw-section-id="0"><p>Lead.</p>',
      '<section data-mw-section-id="1"><h2>Data</h2><table>',
      '<thead><tr><th scope="col">Group</th><th scope="col">Value</th></tr></thead>',
      '<tbody><tr><th scope="rowgroup" rowspan="0">Group A</th><td>A</td></tr>',
      "<tr><td>B</td></tr></tbody></table></section></section>",
    ].join("");
    const document = await loadMediaWikiDocument(request, {
      fetchImpl: vi.fn(async () =>
        jsonResponse(
          parsoidPayload(html, [{ index: "1", line: "Data", level: 1 }]),
        ),
      ),
    });
    const block = document.sections[1].blocks[0];
    expect(block.kind).toBe("table");
    if (block.kind !== "table") throw new Error("table not projected");
    expect(block.table.cells[2]).toMatchObject({ rowSpan: 2 });
    expect(block.table.grid[2][0]).toBe(block.table.cells[2].id);
    expect(block.table.cells[4]).toMatchObject({
      text: "B",
      headerPath: ["Value", "Group A"],
    });
  });

  it("falls back to exact plaintext for an unsupported nested table", async () => {
    const html = [
      '<section data-mw-section-id="0"><p>Lead.</p>',
      '<section data-mw-section-id="1"><h2>Data</h2>',
      "<table><tr><th>Outer</th></tr><tr><td>",
      "<table><tr><td>Nested</td></tr></table>",
      "</td></tr></table></section></section>",
    ].join("");
    const document = await loadMediaWikiDocument(
      {
        ...request,
        plaintext: {
          lead: "Lead.",
          sections: [
            {
              index: "1",
              title: "Data",
              level: 1,
              text: "Outer Nested",
            },
          ],
        },
      },
      {
        fetchImpl: vi.fn(async () =>
          jsonResponse(
            parsoidPayload(html, [{ index: "1", line: "Data", level: 1 }]),
          ),
        ),
      },
    );

    expect(document.sections[1]).toMatchObject({
      fidelity: "partial",
      plaintextContent: "Outer Nested",
      fallback: { text: "Outer Nested", source: "dom-text" },
      blocks: [
        {
          kind: "unsupported",
          sourceKind: "table",
          reason: "nested-table",
          affectsNarration: true,
        },
      ],
    });
    expect(document.issues).toContainEqual(
      expect.objectContaining({
        code: "nested-table",
        severity: "fallback",
        sectionKey: "1",
      }),
    );
  });

  it("keeps DOM table text when TextExtracts leaves a table-only section empty", async () => {
    const html = [
      '<section data-mw-section-id="0"><p>Lead.</p>',
      '<section data-mw-section-id="1"><h2>Data</h2>',
      '<table><tr><th scope="col">Year</th><th scope="col">Value</th></tr>',
      "<tr><td>2020</td><td>5</td></tr></table></section></section>",
    ].join("");
    const document = await loadMediaWikiDocument(
      {
        ...request,
        plaintext: {
          lead: "Lead.",
          sections: [{ index: "1", title: "Data", level: 1, text: "" }],
        },
      },
      {
        fetchImpl: vi.fn(async () =>
          jsonResponse(
            parsoidPayload(html, [{ index: "1", line: "Data", level: 1 }]),
          ),
        ),
      },
    );

    expect(document.sections[1]).toMatchObject({
      plaintextContent: "",
      fallback: {
        text: "Year Value 2020 5",
        source: "dom-text",
      },
      blocks: [{ kind: "table" }],
    });
  });

  it("emits bare wrapper text around structured blocks in source order", async () => {
    const html = [
      '<section data-mw-section-id="0"><p>Lead.</p>',
      '<section data-mw-section-id="1"><h2>Data</h2><div>Before',
      '<table><tr><th scope="col">Year</th><th scope="col">Value</th></tr>',
      "<tr><td>2020</td><td>5</td></tr></table>After</div>",
      "</section></section>",
    ].join("");
    const document = await loadMediaWikiDocument(request, {
      fetchImpl: vi.fn(async () =>
        jsonResponse(
          parsoidPayload(html, [{ index: "1", line: "Data", level: 1 }]),
        ),
      ),
    });

    expect(document.sections[1].blocks).toMatchObject([
      { kind: "prose", text: "Before" },
      { kind: "table" },
      { kind: "prose", text: "After" },
    ]);
  });

  it("uses complete DOM text when malformed table data is absent from plaintext", async () => {
    const html = [
      '<section data-mw-section-id="0"><p>Lead.</p>',
      '<section data-mw-section-id="1"><h2>Data</h2><p>Intro.</p>',
      "<table><tr><th>Outer</th></tr><tr><td>",
      "<table><tr><td>Nested value</td></tr></table>",
      "</td></tr></table></section></section>",
    ].join("");
    const document = await loadMediaWikiDocument(
      {
        ...request,
        plaintext: {
          lead: "Lead.",
          sections: [{ index: "1", title: "Data", level: 1, text: "Intro." }],
        },
      },
      {
        fetchImpl: vi.fn(async () =>
          jsonResponse(
            parsoidPayload(html, [{ index: "1", line: "Data", level: 1 }]),
          ),
        ),
      },
    );

    expect(document.sections[1]).toMatchObject({
      fidelity: "partial",
      plaintextContent: "Intro.",
      fallback: {
        text: "Intro. Outer Nested value",
        source: "dom-text",
      },
    });
  });

  it("retains exact aligned plaintext fallback for complete semantic sections", async () => {
    const html = [
      '<section data-mw-section-id="0"><p>Plain lead. Second line.</p>',
      '<section data-mw-section-id="1"><h2>History</h2>',
      "<p>Plain history. Kept.</p></section></section>",
    ].join("");
    const document = await loadMediaWikiDocument(
      {
        ...request,
        plaintext: {
          lead: "Plain lead.\nSecond line.",
          sections: [
            {
              index: "1",
              title: "History",
              level: 1,
              text: "Plain history.\nKept.",
            },
          ],
        },
      },
      {
        fetchImpl: vi.fn(async () =>
          jsonResponse(
            parsoidPayload(html, [{ index: "1", line: "History", level: 1 }]),
          ),
        ),
      },
    );

    expect(document.sections[0]).toMatchObject({
      fidelity: "complete",
      plaintextContent: "Plain lead.\nSecond line.",
      fallback: {
        text: "Plain lead. Second line.",
        source: "dom-text",
      },
    });
    expect(document.sections[1]).toMatchObject({
      fidelity: "complete",
      plaintextContent: "Plain history.\nKept.",
      fallback: {
        text: "Plain history. Kept.",
        source: "dom-text",
      },
      blocks: [{ kind: "prose", text: "Plain history. Kept." }],
    });
  });

  it("projects figures, image-map regions, and citation relationships", async () => {
    const html = [
      '<section data-mw-section-id="0"><p>Lead.</p>',
      '<section data-mw-section-id="1"><h2 id="Process">Process</h2>',
      '<figure typeof="mw:File/Thumb"><a rel="mw:File/Interwiki" href="./File:Cycle.png">',
      '<img src="//upload.wikimedia.org/wikipedia/commons/a/a1/Cycle.png" ',
      'resource="./File:Cycle.png" alt="A cycle diagram" width="640" height="480"></a>',
      "<figcaption>The cycle.</figcaption><map>",
      '<area alt="North" title="Northern region"><area title="South"></map></figure>',
      '<p>Documented claim.<sup class="reference"><a href="#cite_note-book-1">[1]</a></sup></p>',
      '</section><section data-mw-section-id="2"><h2 id="References">References</h2>',
      '<ol class="references"><li id="cite_note-book-1">',
      '<span class="mw-cite-backlink">↑</span><span class="reference-text">',
      'Source title. <a rel="mw:ExtLink" href="https://example.test/source">Publisher</a>',
      "</span></li></ol></section></section>",
    ].join("");
    const document = await loadMediaWikiDocument(request, {
      fetchImpl: vi.fn(async () =>
        jsonResponse(
          parsoidPayload(html, [
            { index: "1", line: "Process", anchor: "Process", level: 1 },
            {
              index: "2",
              line: "References",
              anchor: "References",
              level: 1,
            },
          ]),
        ),
      ),
    });

    expect(document.sections[1]).toMatchObject({
      role: "body",
      citationIds: ["cite_note-book-1"],
      blocks: [
        {
          kind: "figure",
          caption: "The cycle.",
          media: [
            {
              kind: "image",
              src: "https://upload.wikimedia.org/wikipedia/commons/a/a1/Cycle.png",
              resourceTitle: "File:Cycle.png",
              alt: "A cycle diagram",
              width: 640,
              height: 480,
            },
          ],
          regions: [
            { label: "North", description: "Northern region" },
            { label: "South" },
          ],
        },
        { kind: "prose", text: "Documented claim." },
      ],
    });
    expect(document.sections[2].role).toBe("end-matter");
    expect(document.citations).toEqual([
      {
        id: "cite_note-book-1",
        index: 1,
        text: "Source title. Publisher",
        url: "https://example.test/source",
      },
    ]);
    expect(JSON.stringify(document)).not.toContain("mw-cite-backlink");
  });

  it("projects Parsoid imagemap and gallery extensions as semantic figures", async () => {
    const imagemapDataMw = escapeAttribute(
      JSON.stringify({ name: "imagemap", body: { extsrc: "Example.png" } }),
    );
    const galleryDataMw = escapeAttribute(
      JSON.stringify({ name: "gallery", body: { extsrc: "A.png\nB.png" } }),
    );
    const html = [
      '<section data-mw-section-id="0"><p>Lead.</p>',
      '<section data-mw-section-id="1"><h2>Diagrams</h2>',
      `<figure typeof="mw:Extension/imagemap" data-mw="${imagemapDataMw}">`,
      '<img src="//upload.wikimedia.org/example.png" alt="Map">',
      '<map><area alt="Region one" title="First region"></map></figure>',
      `<div typeof="mw:Extension/gallery" data-mw="${galleryDataMw}">`,
      '<figure><img src="//upload.wikimedia.org/a.png" alt="A"></figure>',
      '<figure><img src="//upload.wikimedia.org/b.png" alt="B"></figure>',
      "</div></section></section>",
    ].join("");
    const document = await loadMediaWikiDocument(request, {
      fetchImpl: vi.fn(async () =>
        jsonResponse(
          parsoidPayload(html, [{ index: "1", line: "Diagrams", level: 1 }]),
        ),
      ),
    });

    expect(document.sections[1].blocks).toMatchObject([
      {
        kind: "figure",
        media: [{ src: "https://upload.wikimedia.org/example.png" }],
        regions: [{ label: "Region one", description: "First region" }],
      },
      {
        kind: "figure",
        media: [
          { src: "https://upload.wikimedia.org/a.png" },
          { src: "https://upload.wikimedia.org/b.png" },
        ],
      },
    ]);
    expect(document.issues).toEqual([]);
  });

  it("decodes a wiki-chart into the inner canonical chart spec", async () => {
    const chartSpec = {
      title: { text: "Population" },
      xAxis: { data: [2020, 2021] },
      series: [{ name: "People", type: "line", data: [10, 12] }],
    };
    const payload = escapeAttribute(JSON.stringify({ spec: chartSpec }));
    const html = [
      '<section data-mw-section-id="0"><p>Lead.</p>',
      '<section data-mw-section-id="1"><h2>Data</h2>',
      `<wiki-chart data-mw-chart="${payload}"></wiki-chart>`,
      "</section></section>",
    ].join("");
    const document = await loadMediaWikiDocument(request, {
      fetchImpl: vi.fn(async () =>
        jsonResponse(
          parsoidPayload(html, [{ index: "1", line: "Data", level: 1 }]),
        ),
      ),
    });

    expect(document.sections[1].blocks).toMatchObject([
      {
        kind: "extension",
        extension: { kind: "chart", spec: chartSpec },
      },
    ]);
    expect(JSON.stringify(document.sections[1].blocks[0])).not.toContain(
      "data-mw-chart",
    );
  });

  it("atomically rejects a data-mw payload above 750 KiB", async () => {
    const payload = escapeAttribute(
      JSON.stringify({ spec: { annotation: "x".repeat(750 * 1024) } }),
    );
    const html = [
      '<section data-mw-section-id="0"><p>Lead.</p>',
      '<section data-mw-section-id="1"><h2>Data</h2>',
      `<wiki-chart data-mw-chart="${payload}"></wiki-chart>`,
      "</section></section>",
    ].join("");
    const document = await loadMediaWikiDocument(request, {
      fetchImpl: vi.fn(async () =>
        jsonResponse(
          parsoidPayload(html, [{ index: "1", line: "Data", level: 1 }]),
        ),
      ),
    });

    expect(document.sections[1].blocks).toMatchObject([
      {
        kind: "unsupported",
        sourceKind: "extension",
        reason: "payload-limit",
      },
    ]);
    expect(document.issues).toContainEqual(
      expect.objectContaining({ code: "payload-limit", sectionKey: "1" }),
    );
  });

  it("projects Parsoid map, timeline, and OSM transclusion metadata", async () => {
    const mapDataMw = escapeAttribute(
      JSON.stringify({
        name: "mapframe",
        attrs: { latitude: "44.6", longitude: "-110.5", zoom: "7" },
        body: {
          extsrc: JSON.stringify({
            type: "Point",
            coordinates: [-110.5, 44.6],
          }),
        },
      }),
    );
    const timelineDataMw = escapeAttribute(
      JSON.stringify({
        name: "timeline",
        body: {
          extsrc: [
            "DateFormat = dd/mm/yyyy",
            'bar:Era from:01/01/1900 till:31/12/1901 color:blue text:"First era"',
            "bar:Era from:01/01/1902 till:31/12/1903 text:Second era",
          ].join("\n"),
        },
      }),
    );
    const osmDataMw = escapeAttribute(
      JSON.stringify({
        parts: [
          {
            template: {
              target: { wt: "Template:OSM Location map" },
              params: {
                zoom: { wt: "8" },
                "mark-coord1": { wt: "{{coord|44.6|-110.5}}" },
                "mark-title1": { wt: "Yellowstone" },
                "mark-description1": { wt: "National park" },
              },
            },
          },
        ],
      }),
    );
    const html = [
      '<section data-mw-section-id="0"><p>Lead.</p>',
      '<section data-mw-section-id="1"><h2>Geography</h2>',
      `<span typeof="mw:Extension/mapframe" data-mw="${mapDataMw}">Yellowstone map</span>`,
      `<div typeof="mw:Extension/timeline" data-mw="${timelineDataMw}"></div>`,
      `<span typeof="mw:Transclusion" data-mw="${osmDataMw}"></span>`,
      "</section></section>",
    ].join("");
    const document = await loadMediaWikiDocument(request, {
      fetchImpl: vi.fn(async () =>
        jsonResponse(
          parsoidPayload(html, [{ index: "1", line: "Geography", level: 1 }]),
        ),
      ),
    });

    expect(document.sections[1].blocks).toMatchObject([
      {
        kind: "extension",
        extension: {
          kind: "kartographer",
          presentation: "mapframe",
          label: "Yellowstone map",
          latitude: 44.6,
          longitude: -110.5,
          zoom: 7,
          geoJson: { type: "Point", coordinates: [-110.5, 44.6] },
        },
      },
      {
        kind: "extension",
        extension: {
          kind: "easy-timeline",
          dateFormat: "dmy",
          entries: [
            {
              from: "01/01/1900",
              to: "31/12/1901",
              label: "First era",
              category: "blue",
            },
            {
              from: "01/01/1902",
              to: "31/12/1903",
              label: "Second era",
            },
          ],
        },
      },
      {
        kind: "extension",
        extension: {
          kind: "osm-location-map",
          zoom: 8,
          markers: [
            {
              latitude: 44.6,
              longitude: -110.5,
              title: "Yellowstone",
              description: "National park",
            },
          ],
        },
      },
    ]);
  });

  it.each([
    {
      label: "at the root",
      geoJson: {
        type: "ExternalData",
        service: "geoshape",
        ids: "Q1214",
      },
    },
    {
      label: "inside an array",
      geoJson: [
        { type: "Point", coordinates: [-110.5, 44.6] },
        { type: "ExternalData", service: "geoshape", ids: "Q1214" },
      ],
    },
    {
      label: "inside a collection",
      geoJson: {
        type: "FeatureCollection",
        features: [
          {
            type: "Feature",
            properties: { name: "Local source" },
            geometry: { type: "Point", coordinates: [-110.5, 44.6] },
          },
          { type: "ExternalData", service: "geoshape", ids: "Q1214" },
        ],
      },
    },
  ])(
    "declines unversioned Kartographer ExternalData $label without using viewport coordinates",
    async ({ geoJson }) => {
      const dataMw = escapeAttribute(
        JSON.stringify({
          name: "mapframe",
          attrs: { latitude: "44.6", longitude: "-110.5", zoom: "7" },
          body: { extsrc: JSON.stringify(geoJson) },
        }),
      );
      const html = [
        '<section data-mw-section-id="0"><p>Lead.</p>',
        '<section data-mw-section-id="1"><h2>Map</h2>',
        `<span typeof="mw:Extension/mapframe" data-mw="${dataMw}">Viewport</span>`,
        "</section></section>",
      ].join("");
      const document = await loadMediaWikiDocument(request, {
        fetchImpl: vi.fn(async () =>
          jsonResponse(
            parsoidPayload(html, [{ index: "1", line: "Map", level: 1 }]),
          ),
        ),
      });

      expect(document.sections[1]).toMatchObject({
        fidelity: "partial",
        blocks: [
          {
            kind: "unsupported",
            sourceKind: "extension",
            reason: "unversioned-external-data",
          },
        ],
      });
      expect(
        document.sections[1].blocks.some(
          (block) =>
            block.kind === "extension" &&
            block.extension.kind === "kartographer",
        ),
      ).toBe(false);
      expect(document.issues).toContainEqual(
        expect.objectContaining({
          code: "unversioned-external-data",
          sectionKey: "1",
        }),
      );
    },
  );

  it("preserves complete rectangular tables across generated colspan partitions", async () => {
    await fc.assert(
      fc.asyncProperty(
        fc.array(fc.integer({ min: 1, max: 3 }), {
          minLength: 1,
          maxLength: 8,
        }),
        async (spans) => {
          const width = spans.reduce((sum, span) => sum + span, 0);
          const headers = Array.from(
            { length: width },
            (_, index) => `<th scope="col">H${index + 1}</th>`,
          ).join("");
          const values = spans
            .map(
              (span, index) =>
                `<td${span > 1 ? ` colspan="${span}"` : ""}>V${index + 1}</td>`,
            )
            .join("");
          const html = [
            '<section data-mw-section-id="0"><p>Lead.</p>',
            '<section data-mw-section-id="1"><h2>Data</h2><table>',
            `<thead><tr>${headers}</tr></thead><tbody><tr>${values}</tr></tbody>`,
            "</table></section></section>",
          ].join("");
          const document = await loadMediaWikiDocument(request, {
            fetchImpl: vi.fn(async () =>
              jsonResponse(
                parsoidPayload(html, [{ index: "1", line: "Data", level: 1 }]),
              ),
            ),
          });
          const block = document.sections[1].blocks[0];
          expect(block.kind).toBe("table");
          if (block.kind !== "table") return;
          expect(block.table.columnCount).toBe(width);
          expect(block.table.grid).toHaveLength(2);
          expect(block.table.grid.every((row) => row.length === width)).toBe(
            true,
          );
          const dataCells = block.table.cells.filter(
            (cell) => cell.kind === "data",
          );
          expect(dataCells.map((cell) => cell.columnSpan)).toEqual(spans);
          expect(
            dataCells.every(
              (cell) => cell.headerPath.length === cell.columnSpan,
            ),
          ).toBe(true);
        },
      ),
      { seed: 0x4d57444f, numRuns: 50 },
    );
  });

  it.each([
    [
      "table-grid-collision",
      "<thead><tr><th>A</th><th>B</th><th>C</th></tr></thead>" +
        '<tbody><tr><td>A1</td><td rowspan="2">B1</td><td>C1</td></tr>' +
        '<tr><td colspan="2">collision</td></tr></tbody>',
    ],
    [
      "table-grid-hole",
      "<thead><tr><th>A</th><th>B</th><th>C</th></tr></thead>" +
        "<tbody><tr><td>A1</td><td>B1</td></tr></tbody>",
    ],
    [
      "invalid-table-span",
      '<tr><th>A</th></tr><tr><td colspan="not-a-number">value</td></tr>',
    ],
    [
      "ambiguous-table-headers",
      '<tr><th id="a" headers="b">A</th><th id="b" headers="a">B</th></tr>' +
        '<tr><td headers="a">value</td><td headers="b">value</td></tr>',
    ],
  ])(
    "rejects a malformed table as %s without partial projection",
    async (reason, rows) => {
      const html = [
        '<section data-mw-section-id="0"><p>Lead.</p>',
        '<section data-mw-section-id="1"><h2>Data</h2>',
        `<table>${rows}</table></section></section>`,
      ].join("");
      const document = await loadMediaWikiDocument(request, {
        fetchImpl: vi.fn(async () =>
          jsonResponse(
            parsoidPayload(html, [{ index: "1", line: "Data", level: 1 }]),
          ),
        ),
      });
      expect(document.sections[1]).toMatchObject({
        fidelity: "partial",
        blocks: [{ kind: "unsupported", sourceKind: "table", reason }],
      });
      expect(
        document.sections[1].blocks.some((block) => block.kind === "table"),
      ).toBe(false);
    },
  );

  it("ignores fake structural markup inside HTML comments", async () => {
    const html = [
      '<section data-mw-section-id="0">',
      "<!-- <table><tr><td>fake</td></tr></table><ul><li>fake</li></ul> -->",
      "<p>Real prose.</p></section>",
    ].join("");
    const document = await loadMediaWikiDocument(request, {
      fetchImpl: vi.fn(async () => jsonResponse(parsoidPayload(html))),
    });
    expect(document.sections[0].blocks).toMatchObject([
      { kind: "prose", text: "Real prose." },
    ]);
    expect(JSON.stringify(document)).not.toContain("fake");
  });

  it("marks unsupported semantic blocks instead of silently dropping them", async () => {
    const dataMw = escapeAttribute(
      JSON.stringify({ name: "score", body: { extsrc: "c d e f" } }),
    );
    const html = [
      '<section data-mw-section-id="0"><p>Lead.</p>',
      '<section data-mw-section-id="1"><h2>Notation</h2>',
      "<pre>let x = 1;</pre>",
      `<span typeof="mw:Extension/score" data-mw="${dataMw}">Musical score</span>`,
      "</section></section>",
    ].join("");
    const document = await loadMediaWikiDocument(
      {
        ...request,
        plaintext: {
          lead: "Lead.",
          sections: [
            {
              index: "1",
              title: "Notation",
              level: 1,
              text: "let x = 1; Musical score",
            },
          ],
        },
      },
      {
        fetchImpl: vi.fn(async () =>
          jsonResponse(
            parsoidPayload(html, [{ index: "1", line: "Notation", level: 1 }]),
          ),
        ),
      },
    );

    expect(document.sections[1]).toMatchObject({
      fidelity: "partial",
      fallback: {
        source: "dom-text",
        text: "let x = 1; Musical score",
      },
      blocks: [
        { kind: "unsupported", sourceKind: "preformatted" },
        {
          kind: "unsupported",
          sourceKind: "extension",
          reason: "unsupported-extension",
        },
      ],
    });
  });

  it("reads poem extensions as prose and ignores non-content Parsoid extensions", async () => {
    const poemDataMw = escapeAttribute(
      JSON.stringify({ name: "poem", body: { extsrc: "Line one\nLine two" } }),
    );
    const styleDataMw = escapeAttribute(
      JSON.stringify({
        name: "templatestyles",
        attrs: { src: "Example/styles.css" },
      }),
    );
    const refDataMw = escapeAttribute(
      JSON.stringify({ name: "ref", body: { extsrc: "Citation" } }),
    );
    const html = [
      '<section data-mw-section-id="0"><p>Lead.</p>',
      '<section data-mw-section-id="1"><h2>Poem</h2>',
      `<style typeof="mw:Extension/templatestyles" data-mw="${styleDataMw}">.x{}</style>`,
      `<span typeof="mw:Extension/poem" data-mw="${poemDataMw}">Line one<br>Line two</span>`,
      `<sup class="reference" typeof="mw:Extension/ref" data-mw="${refDataMw}">[1]</sup>`,
      "</section></section>",
    ].join("");
    const document = await loadMediaWikiDocument(request, {
      fetchImpl: vi.fn(async () =>
        jsonResponse(
          parsoidPayload(html, [{ index: "1", line: "Poem", level: 1 }]),
        ),
      ),
    });

    expect(document.sections[1]).toMatchObject({
      fidelity: "complete",
      blocks: [
        {
          kind: "prose",
          role: "blockquote",
          text: "Line one Line two",
        },
      ],
    });
    expect(document.issues).toEqual([]);
  });

  it("hashes canonical semantic content rather than irrelevant HTML spelling", async () => {
    const firstHtml = [
      '<section data-mw-section-id="0"><p class="lead">Same text.</p>',
      '<section data-mw-section-id="1"><h2>History</h2><ul>',
      '<li title="item">One</li><li>Two</li></ul></section></section>',
    ].join("");
    const secondHtml = [
      '<section data-mw-section-id="0">\n<!-- harmless -->',
      '<p class="lead"> Same   text. </p>',
      '<section data-mw-section-id="1"><h2>History</h2>',
      '<ul><li title="item">One</li>\n<li>Two</li></ul>',
      "</section></section>",
    ].join("");
    const load = (html: string) =>
      loadMediaWikiDocument(request, {
        fetchImpl: vi.fn(async () =>
          jsonResponse(
            parsoidPayload(html, [{ index: "1", line: "History", level: 1 }]),
          ),
        ),
      });

    const [first, second, changed] = await Promise.all([
      load(firstHtml),
      load(secondHtml),
      load(firstHtml.replace("Same text.", "Changed text.")),
    ]);

    expect(second.sourceHash).toBe(first.sourceHash);
    expect(second.documentHash).toBe(first.documentHash);
    expect(changed.sourceHash).not.toBe(first.sourceHash);
  });
});
