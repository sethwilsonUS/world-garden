import { describe, expect, it } from "vitest";
import type { MediaWikiDocument } from "./mediawiki-document";
import { createSectionNarrationsFromDocument } from "./section-narration-document";

const baseDocument = (): MediaWikiDocument => ({
  schemaVersion: 1,
  identity: {
    wikiPageId: "384816",
    title: "Walter Savage Landor",
    revisionId: "1342291773",
    language: "en",
  },
  sourceFormat: "parsoid",
  sourceHash: "source",
  documentHash: "document",
  citations: [],
  issues: [],
  sections: [
    {
      key: "__summary__",
      title: "Summary",
      level: 0,
      sourceOrder: 0,
      role: "body",
      fidelity: "complete",
      plaintextContent: "An English writer.",
      fallback: { text: "An English writer.", source: "dom-text" },
      links: [],
      citationIds: [],
      blocks: [],
    },
    {
      key: "1",
      title: "Artistic recognition",
      level: 1,
      sourceOrder: 1,
      parentKey: "__summary__",
      role: "body",
      fidelity: "complete",
      plaintextContent:
        "A bust dated 1828 is held in the National Portrait Gallery, London.",
      fallback: {
        text: "A bust dated 1828 is held in the National Portrait Gallery, London.",
        source: "mediawiki-plaintext",
      },
      links: [],
      citationIds: [],
      blocks: [
        {
          kind: "prose",
          id: "p1",
          sourceOrder: 2,
          contentHash: "p1",
          role: "paragraph",
          text: "A bust dated 1828 is held in the National Portrait Gallery, London.",
        },
      ],
    },
    {
      key: "2",
      title: "Works",
      level: 1,
      sourceOrder: 3,
      parentKey: "__summary__",
      role: "body",
      fidelity: "complete",
      plaintextContent: "Poetry Early poems Prose",
      fallback: { text: "Poetry Early poems Prose", source: "dom-text" },
      links: [],
      citationIds: [],
      blocks: [
        {
          kind: "list",
          id: "l1",
          sourceOrder: 4,
          contentHash: "l1",
          list: {
            style: "unordered",
            items: [
              {
                sourceOrdinal: 0,
                parts: [
                  { kind: "text", text: "Poetry", sourceOrder: 4 },
                  {
                    kind: "list",
                    sourceOrder: 5,
                    list: {
                      style: "unordered",
                      items: [
                        {
                          sourceOrdinal: 0,
                          parts: [
                            {
                              kind: "text",
                              text: "Early poems",
                              sourceOrder: 6,
                            },
                          ],
                        },
                      ],
                    },
                  },
                ],
              },
              {
                sourceOrdinal: 1,
                parts: [{ kind: "text", text: "Prose", sourceOrder: 7 }],
              },
            ],
          },
        },
      ],
    },
  ],
});

describe("createSectionNarrationsFromDocument", () => {
  it("keeps short prose verbatim and verbalizes recursive semantic lists", () => {
    const sections = createSectionNarrationsFromDocument(baseDocument());

    expect(sections).toHaveLength(2);
    expect(sections[0].narration).toMatchObject({
      mode: "verbatim",
      sourceFormat: "prose",
      adapted: false,
      usedRawFallback: false,
      text: "Artistic recognition. A bust dated 1828 is held in the National Portrait Gallery, London.",
    });
    expect(sections[1].narration).toMatchObject({
      mode: "structured",
      sourceFormat: "list",
      adapted: true,
      usedRawFallback: false,
      text: "Works. List with 3 items. Item 1: Poetry. Item 2, nested under item 1: Early poems. Item 3: Prose.",
    });
    expect(sections[0].narration.sourceHash).toContain("section-narration:2");
  });

  it("honors an ordered list's source start value", () => {
    const document = baseDocument();
    const sections = document.sections.map((section) =>
      section.key === "2"
        ? {
            ...section,
            blocks: section.blocks.map((block) =>
              block.kind === "list"
                ? {
                    ...block,
                    list: {
                      style: "ordered" as const,
                      start: 5,
                      items: [
                        {
                          sourceOrdinal: 0,
                          parts: [
                            {
                              kind: "text" as const,
                              text: "Fifth",
                              sourceOrder: 1,
                            },
                          ],
                        },
                        {
                          sourceOrdinal: 1,
                          parts: [
                            {
                              kind: "text" as const,
                              text: "Sixth",
                              sourceOrder: 2,
                            },
                          ],
                        },
                      ],
                    },
                  }
                : block,
            ),
          }
        : section,
    );

    expect(
      createSectionNarrationsFromDocument({ ...document, sections })[1]
        .narration.text,
    ).toBe("Works. List with 2 items. Item 5: Fifth. Item 6: Sixth.");
  });

  it("narrates text before and after a nested list in source order", () => {
    const document = baseDocument();
    const sections = document.sections.map((section) =>
      section.key === "2"
        ? {
            ...section,
            blocks: [
              {
                kind: "list" as const,
                id: "mixed-list",
                sourceOrder: 4,
                contentHash: "mixed-list",
                list: {
                  style: "unordered" as const,
                  items: [
                    {
                      sourceOrdinal: 0,
                      parts: [
                        {
                          kind: "text" as const,
                          text: "Before",
                          sourceOrder: 5,
                        },
                        {
                          kind: "list" as const,
                          sourceOrder: 6,
                          list: {
                            style: "unordered" as const,
                            items: [
                              {
                                sourceOrdinal: 0,
                                parts: [
                                  {
                                    kind: "text" as const,
                                    text: "Nested",
                                    sourceOrder: 7,
                                  },
                                ],
                              },
                            ],
                          },
                        },
                        {
                          kind: "text" as const,
                          text: "After",
                          sourceOrder: 8,
                        },
                      ],
                    },
                  ],
                },
              },
            ],
          }
        : section,
    );

    expect(
      createSectionNarrationsFromDocument({ ...document, sections })[1]
        .narration.text,
    ).toBe(
      "Works. List with 2 items. Item 1: Before. Item 2, nested under item 1: Nested. Continuing item 1: After.",
    );
  });

  it("falls back to complete plaintext when any source block is unsupported", () => {
    const document = baseDocument();
    const sections = document.sections.map((section) =>
      section.key === "2"
        ? {
            ...section,
            fidelity: "partial" as const,
            blocks: [
              ...section.blocks,
              {
                kind: "unsupported" as const,
                id: "u1",
                sourceOrder: 5,
                contentHash: "u1",
                sourceKind: "table" as const,
                reason: "malformed-table" as const,
                affectsNarration: true,
              },
            ],
          }
        : section,
    );
    const narration = createSectionNarrationsFromDocument({
      ...document,
      sections,
    })[1].narration;

    expect(narration).toMatchObject({
      mode: "verbatim",
      sourceFormat: "mixed",
      adapted: false,
      usedRawFallback: true,
      text: "Works. Poetry Early poems Prose",
    });
  });

  it("verbalizes normalized table headers and complete rows in block order", () => {
    const document = baseDocument();
    const sections = document.sections.map((section) =>
      section.key === "2"
        ? {
            ...section,
            fallback: {
              text: "Awards follow. Year Work 2020 Example 2021 Another",
              source: "dom-text" as const,
            },
            blocks: [
              {
                kind: "prose" as const,
                id: "p2",
                sourceOrder: 4,
                contentHash: "p2",
                role: "paragraph" as const,
                text: "Awards follow.",
              },
              {
                kind: "table" as const,
                id: "t1",
                sourceOrder: 5,
                contentHash: "t1",
                table: {
                  caption: "Awards",
                  rowCount: 3,
                  columnCount: 2,
                  cells: [
                    {
                      id: "h-year",
                      kind: "header" as const,
                      text: "Year",
                      originRow: 0,
                      originColumn: 0,
                      rowSpan: 1,
                      columnSpan: 1,
                      rowGroup: 0,
                      scope: "column" as const,
                      explicitHeaderIds: [],
                      associatedHeaderCellIds: [],
                      headerPath: [],
                    },
                    {
                      id: "h-work",
                      kind: "header" as const,
                      text: "Work",
                      originRow: 0,
                      originColumn: 1,
                      rowSpan: 1,
                      columnSpan: 1,
                      rowGroup: 0,
                      scope: "column" as const,
                      explicitHeaderIds: [],
                      associatedHeaderCellIds: [],
                      headerPath: [],
                    },
                    ...[
                      ["y1", "2020", 1, 0, "h-year", "Year"],
                      ["w1", "Example", 1, 1, "h-work", "Work"],
                      ["y2", "2021", 2, 0, "h-year", "Year"],
                      ["w2", "Another", 2, 1, "h-work", "Work"],
                    ].map(
                      ([
                        id,
                        text,
                        originRow,
                        originColumn,
                        headerId,
                        header,
                      ]) => ({
                        id: String(id),
                        kind: "data" as const,
                        text: String(text),
                        originRow: Number(originRow),
                        originColumn: Number(originColumn),
                        rowSpan: 1,
                        columnSpan: 1,
                        rowGroup: 1,
                        explicitHeaderIds: [],
                        associatedHeaderCellIds: [String(headerId)],
                        headerPath: [String(header)],
                      }),
                    ),
                  ],
                  grid: [
                    ["h-year", "h-work"],
                    ["y1", "w1"],
                    ["y2", "w2"],
                  ],
                },
              },
            ],
          }
        : section,
    );
    const narration = createSectionNarrationsFromDocument({
      ...document,
      sections,
    })[1].narration;

    expect(narration).toMatchObject({
      mode: "structured",
      sourceFormat: "mixed",
      adapted: true,
      text: "Works. Awards follow. Table: Awards. Columns: Year; Work. Row 1: Year: 2020; Work: Example. Row 2: Year: 2021; Work: Another.",
    });
  });

  it("announces row headers once and keeps them out of data header paths", () => {
    const document = baseDocument();
    const cells = [
      {
        id: "country",
        kind: "header" as const,
        text: "Country",
        originRow: 0,
        originColumn: 0,
        rowSpan: 1,
        columnSpan: 1,
        rowGroup: 0,
        scope: "column" as const,
        explicitHeaderIds: [],
        associatedHeaderCellIds: [],
        headerPath: [],
      },
      {
        id: "population",
        kind: "header" as const,
        text: "Population",
        originRow: 0,
        originColumn: 1,
        rowSpan: 1,
        columnSpan: 1,
        rowGroup: 0,
        scope: "column" as const,
        explicitHeaderIds: [],
        associatedHeaderCellIds: [],
        headerPath: [],
      },
      {
        id: "france",
        kind: "header" as const,
        text: "France",
        originRow: 1,
        originColumn: 0,
        rowSpan: 1,
        columnSpan: 1,
        rowGroup: 1,
        scope: "row" as const,
        explicitHeaderIds: [],
        associatedHeaderCellIds: [],
        headerPath: [],
      },
      {
        id: "france-population",
        kind: "data" as const,
        text: "67 million",
        originRow: 1,
        originColumn: 1,
        rowSpan: 1,
        columnSpan: 1,
        rowGroup: 1,
        explicitHeaderIds: [],
        associatedHeaderCellIds: ["population", "france"],
        headerPath: ["Population", "France"],
      },
    ];
    const sections = document.sections.map((section) =>
      section.key === "2"
        ? {
            ...section,
            blocks: [
              {
                kind: "table" as const,
                id: "row-headers",
                sourceOrder: 4,
                contentHash: "row-headers",
                table: {
                  caption: "Population",
                  rowCount: 2,
                  columnCount: 2,
                  cells,
                  grid: [
                    ["country", "population"],
                    ["france", "france-population"],
                  ],
                },
              },
            ],
          }
        : section,
    );
    const text = createSectionNarrationsFromDocument({
      ...document,
      sections,
    })[1].narration.text;

    expect(text).toContain("Columns: Country; Population.");
    expect(text).toContain("Row 1, France: Population: 67 million.");
    expect(text.match(/France/g)).toHaveLength(1);
  });

  it("falls back instead of reducing a header-only table to its title", () => {
    const document = baseDocument();
    const sections = document.sections.map((section) =>
      section.key === "2"
        ? {
            ...section,
            plaintextContent: "",
            fallback: {
              text: "Legend Alpha Beta",
              source: "dom-text" as const,
            },
            blocks: [
              {
                kind: "table" as const,
                id: "headers-only",
                sourceOrder: 4,
                contentHash: "headers-only",
                table: {
                  caption: "Legend",
                  rowCount: 1,
                  columnCount: 2,
                  cells: [
                    {
                      id: "alpha",
                      kind: "header" as const,
                      text: "Alpha",
                      originRow: 0,
                      originColumn: 0,
                      rowSpan: 1,
                      columnSpan: 1,
                      rowGroup: 0,
                      explicitHeaderIds: [],
                      associatedHeaderCellIds: [],
                      headerPath: [],
                    },
                    {
                      id: "beta",
                      kind: "header" as const,
                      text: "Beta",
                      originRow: 0,
                      originColumn: 1,
                      rowSpan: 1,
                      columnSpan: 1,
                      rowGroup: 0,
                      explicitHeaderIds: [],
                      associatedHeaderCellIds: [],
                      headerPath: [],
                    },
                  ],
                  grid: [["alpha", "beta"]],
                },
              },
            ],
          }
        : section,
    );
    const narration = createSectionNarrationsFromDocument({
      ...document,
      sections,
    })[1].narration;

    expect(narration).toMatchObject({
      mode: "verbatim",
      usedRawFallback: true,
      text: "Works. Legend Alpha Beta",
    });
  });

  it("caps only adapted items while preserving prose around them verbatim", () => {
    const document = baseDocument();
    const closingProse = Array.from(
      { length: 850 },
      (_, index) => `closing-${index + 1}`,
    ).join(" ");
    const sections = document.sections.map((section) =>
      section.key === "2"
        ? {
            ...section,
            fallback: {
              text: `Introduction. ${closingProse}`,
              source: "mediawiki-plaintext" as const,
            },
            blocks: [
              {
                kind: "prose" as const,
                id: "opening",
                sourceOrder: 4,
                contentHash: "opening",
                role: "paragraph" as const,
                text: "Introduction.",
              },
              {
                kind: "list" as const,
                id: "catalogue",
                sourceOrder: 5,
                contentHash: "catalogue",
                list: {
                  style: "unordered" as const,
                  items: Array.from({ length: 500 }, (_, index) => ({
                    sourceOrdinal: index,
                    parts: [
                      {
                        kind: "text" as const,
                        text: `Source item ${index + 1}`,
                        sourceOrder: index,
                      },
                    ],
                  })),
                },
              },
              {
                kind: "prose" as const,
                id: "closing",
                sourceOrder: 6,
                contentHash: "closing",
                role: "paragraph" as const,
                text: closingProse,
              },
            ],
          }
        : section,
    );

    const narration = createSectionNarrationsFromDocument({
      ...document,
      sections,
    })[1].narration;

    expect(narration.mode).toBe("structured");
    expect(narration.remainingSourceItems).toBeGreaterThan(0);
    expect(narration.text).toContain("Introduction.");
    expect(narration.text).toContain("closing-850");
    expect(narration.text).toContain(
      "the complete data is available in the Wikipedia article",
    );
  });

  it("caps nested lists between individual items instead of dropping a whole subtree", () => {
    const document = baseDocument();
    const nestedItems = Array.from({ length: 400 }, (_, index) => ({
      sourceOrdinal: index,
      parts: [
        {
          kind: "text" as const,
          text: `Nested catalogue entry ${index + 1}`,
          sourceOrder: index + 10,
        },
      ],
    }));
    const sections = document.sections.map((section) =>
      section.key === "2"
        ? {
            ...section,
            blocks: [
              {
                kind: "list" as const,
                id: "nested-catalogue",
                sourceOrder: 4,
                contentHash: "nested-catalogue",
                list: {
                  style: "unordered" as const,
                  items: [
                    {
                      sourceOrdinal: 0,
                      parts: [
                        {
                          kind: "text" as const,
                          text: "Catalogue",
                          sourceOrder: 5,
                        },
                        {
                          kind: "list" as const,
                          sourceOrder: 6,
                          list: {
                            style: "unordered" as const,
                            items: nestedItems,
                          },
                        },
                      ],
                    },
                  ],
                },
              },
            ],
          }
        : section,
    );

    const narration = createSectionNarrationsFromDocument({
      ...document,
      sections,
    })[1].narration;

    expect(narration.mode).toBe("structured");
    expect(narration.text).toContain("Item 1: Catalogue.");
    expect(narration.text).toContain("nested under item 1");
    expect(narration.remainingSourceItems).toBeGreaterThan(0);
    expect(narration.remainingSourceItems).toBeLessThan(401);
  });
});
