import { describe, expect, it } from "vitest";
import { extractArticleContextFromDocument } from "./article-context-document";
import type {
  MediaWikiDocument,
  MediaWikiTableCell,
} from "./mediawiki-document";

const tableCell = (
  value: Partial<MediaWikiTableCell> & Pick<MediaWikiTableCell, "id" | "text">,
): MediaWikiTableCell => ({
  kind: "data",
  originRow: 0,
  originColumn: 0,
  rowSpan: 1,
  columnSpan: 1,
  rowGroup: 1,
  explicitHeaderIds: [],
  associatedHeaderCellIds: [],
  headerPath: [],
  ...value,
});

const documentWithTable = (): MediaWikiDocument => {
  const cells: MediaWikiTableCell[] = [
    tableCell({
      id: "year",
      text: "Year",
      kind: "header",
      originRow: 0,
      originColumn: 0,
      rowGroup: 0,
      scope: "column",
    }),
    tableCell({
      id: "population",
      text: "Population",
      kind: "header",
      originRow: 0,
      originColumn: 1,
      rowGroup: 0,
      scope: "column",
    }),
    ...[
      ["y-2020", "2020", 1, 0, ["Year"]],
      ["p-2020", "100", 1, 1, ["Population"]],
      ["y-2021", "2021", 2, 0, ["Year"]],
      ["p-2021", "125", 2, 1, ["Population"]],
      ["y-2022", "2022", 3, 0, ["Year"]],
      ["p-2022", "150", 3, 1, ["Population"]],
    ].map(([id, text, originRow, originColumn, headerPath]) =>
      tableCell({
        id: String(id),
        text: String(text),
        originRow: Number(originRow),
        originColumn: Number(originColumn),
        headerPath: headerPath as string[],
        associatedHeaderCellIds: [
          Number(originColumn) === 0 ? "year" : "population",
        ],
      }),
    ),
  ];

  return {
    schemaVersion: 1,
    identity: {
      wikiPageId: "1",
      title: "Example",
      revisionId: "10",
      language: "en",
    },
    sourceFormat: "parsoid",
    sourceHash: "source-hash",
    documentHash: "document-hash",
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
        plaintextContent: "A population example.",
        fallback: { text: "A population example.", source: "dom-text" },
        links: [],
        citationIds: [],
        blocks: [],
      },
      {
        key: "1",
        title: "Population",
        level: 1,
        sourceOrder: 10,
        parentKey: "__summary__",
        anchor: "Population",
        role: "body",
        fidelity: "complete",
        plaintextContent:
          "Population rose from 100 to 150 between 2020 and 2022.",
        fallback: {
          text: "Population rose from 100 to 150 between 2020 and 2022.",
          source: "dom-text",
        },
        links: [],
        citationIds: [],
        blocks: [
          {
            kind: "prose",
            id: "prose-1",
            sourceOrder: 11,
            contentHash: "prose-hash",
            role: "paragraph",
            text: "Population rose over the period.",
          },
          {
            kind: "table",
            id: "table-1",
            sourceOrder: 12,
            contentHash: "table-hash",
            table: {
              caption: "Population by year",
              rowCount: 4,
              columnCount: 2,
              cells,
              grid: [
                ["year", "population"],
                ["y-2020", "p-2020"],
                ["y-2021", "p-2021"],
                ["y-2022", "p-2022"],
              ],
            },
          },
        ],
      },
    ],
  };
};

describe("extractArticleContextFromDocument", () => {
  it("projects a semantically normalized table without reparsing HTML", () => {
    const manifest = extractArticleContextFromDocument(documentWithTable(), {
      now: () => new Date("2026-07-25T12:00:00.000Z"),
    });

    expect(manifest).toMatchObject({
      wikiPageId: "1",
      revisionId: "10",
      sourceHash: "document-hash",
      generatedAt: "2026-07-25T12:00:00.000Z",
    });
    expect(manifest.blocks).toHaveLength(1);
    expect(manifest.blocks[0]).toMatchObject({
      kind: "chart",
      section: { index: "1", title: "Population", anchor: "Population" },
      title: "Population by year",
      order: 0,
      chart: {
        columns: [
          { label: "Year", headerPath: ["Year"] },
          { label: "Population", headerPath: ["Population"] },
        ],
        rows: [
          { year: 2020, population: 100 },
          { year: 2021, population: 125 },
          { year: 2022, population: 150 },
        ],
      },
    });
  });

  it("projects scope-row headers as a categorical chart column", () => {
    const document = documentWithTable();
    const header = (
      id: string,
      text: string,
      originRow: number,
      originColumn: number,
      scope: "column" | "row",
    ): MediaWikiTableCell =>
      tableCell({
        id,
        text,
        kind: "header",
        originRow,
        originColumn,
        rowGroup: originRow === 0 ? 0 : 1,
        scope,
      });
    const cells: MediaWikiTableCell[] = [
      header("country", "Country", 0, 0, "column"),
      header("population", "Population", 0, 1, "column"),
    ];
    const grid = [["country", "population"]];
    [
      ["France", "67"],
      ["Germany", "84"],
      ["Italy", "59"],
    ].forEach(([country, population], index) => {
      const row = index + 1;
      const rowHeaderId = `country-${row}`;
      const valueId = `population-${row}`;
      cells.push(
        header(rowHeaderId, country, row, 0, "row"),
        tableCell({
          id: valueId,
          text: population,
          originRow: row,
          originColumn: 1,
          rowGroup: 1,
          associatedHeaderCellIds: ["population", rowHeaderId],
          headerPath: ["Population", country],
        }),
      );
      grid.push([rowHeaderId, valueId]);
    });
    const sections = document.sections.map((section) =>
      section.key === "1"
        ? {
            ...section,
            blocks: [
              {
                kind: "table" as const,
                id: "country-table",
                sourceOrder: 12,
                contentHash: "country-table",
                table: {
                  caption: "Population by country",
                  rowCount: 4,
                  columnCount: 2,
                  cells,
                  grid,
                },
              },
            ],
          }
        : section,
    );
    const [chart] = extractArticleContextFromDocument({
      ...document,
      sections,
    }).blocks;

    expect(chart).toMatchObject({
      kind: "chart",
      chart: {
        columns: [
          { label: "Country", headerPath: ["Country"] },
          { label: "Population", headerPath: ["Population"] },
        ],
        rows: [
          { country: "France", population: 67 },
          { country: "Germany", population: 84 },
          { country: "Italy", population: 59 },
        ],
      },
    });
  });

  it("keeps a ranking table when an aggregate row header spans rank and entity", () => {
    const document = documentWithTable();
    const header = (
      id: string,
      text: string,
      originRow: number,
      originColumn: number,
      scope: "column" | "row",
      columnSpan = 1,
    ): MediaWikiTableCell =>
      tableCell({
        id,
        text,
        kind: "header",
        originRow,
        originColumn,
        rowGroup: originRow === 0 ? 0 : 1,
        scope,
        columnSpan,
      });
    const cells: MediaWikiTableCell[] = [
      tableCell({
        id: "medal-group",
        text: "Medal standings",
        kind: "header",
        originRow: 0,
        originColumn: 0,
        rowSpan: 1,
        columnSpan: 3,
        rowGroup: 0,
        scope: "column-group",
      }),
      header("rank", "Rank", 1, 0, "column"),
      header("noc", "NOC", 1, 1, "column"),
      header("gold", "Gold", 1, 2, "column"),
    ];
    const grid = [
      ["medal-group", "medal-group", "medal-group"],
      ["rank", "noc", "gold"],
    ];
    [
      ["1", "Rohan", "12"],
      ["2", "Gondor", "9"],
      ["3", "Dale", "4"],
    ].forEach(([rank, noc, gold], index) => {
      const row = index + 2;
      const rankId = `rank-${row}`;
      const nocId = `noc-${row}`;
      const goldId = `gold-${row}`;
      cells.push(
        tableCell({
          id: rankId,
          text: rank,
          originRow: row,
          originColumn: 0,
          associatedHeaderCellIds: ["medal-group", "rank"],
          headerPath: ["Medal standings", "Rank"],
        }),
        header(nocId, noc, row, 1, "row"),
        tableCell({
          id: goldId,
          text: gold,
          originRow: row,
          originColumn: 2,
          associatedHeaderCellIds: ["medal-group", "gold", nocId],
          headerPath: ["Medal standings", "Gold", noc],
        }),
      );
      grid.push([rankId, nocId, goldId]);
    });
    const aggregateId = "aggregate-label";
    cells.push(
      header(aggregateId, "Totals (3 entries)", 5, 0, "row", 2),
      tableCell({
        id: "aggregate-gold",
        text: "25",
        originRow: 5,
        originColumn: 2,
        associatedHeaderCellIds: ["medal-group", "gold", aggregateId],
        headerPath: ["Medal standings", "Gold", "Totals (3 entries)"],
      }),
    );
    grid.push([aggregateId, aggregateId, "aggregate-gold"]);
    const sections = document.sections.map((section) =>
      section.key === "1"
        ? {
            ...section,
            blocks: [
              {
                kind: "table" as const,
                id: "ranking-table",
                sourceOrder: 12,
                contentHash: "ranking-table",
                table: {
                  caption: "Medal table",
                  rowCount: grid.length,
                  columnCount: 3,
                  cells,
                  grid,
                },
              },
            ],
          }
        : section,
    );

    const [chart] = extractArticleContextFromDocument({
      ...document,
      sections,
    }).blocks;

    expect(chart).toMatchObject({
      kind: "chart",
      chart: {
        columns: [
          { label: "Rank", headerPath: ["Medal standings", "Rank"] },
          { label: "NOC", headerPath: ["Medal standings", "NOC"] },
          { label: "Gold", headerPath: ["Medal standings", "Gold"] },
        ],
        rows: [
          { rank: 1, noc: "Rohan", gold: 12 },
          { rank: 2, noc: "Gondor", gold: 9 },
          { rank: 3, noc: "Dale", gold: 4 },
        ],
      },
    });
  });

  it("ignores end matter even when it contains chartable data", () => {
    const document = documentWithTable();
    const sections = document.sections.map((section) =>
      section.key === "1"
        ? { ...section, role: "end-matter" as const }
        : section,
    );
    expect(
      extractArticleContextFromDocument({ ...document, sections }).blocks,
    ).toEqual([]);
  });

  it("projects a decoded MediaWiki chart extension", () => {
    const document = documentWithTable();
    const sections = document.sections.map((section) =>
      section.key === "1"
        ? {
            ...section,
            blocks: [
              {
                kind: "extension" as const,
                id: "chart-extension",
                sourceOrder: 12,
                contentHash: "chart-extension-hash",
                extension: {
                  kind: "chart" as const,
                  spec: {
                    title: { text: "Visitors" },
                    xAxis: { data: ["A", "B", "C"] },
                    yAxis: { name: "People" },
                    series: [
                      { name: "Visitors", type: "bar", data: [10, 20, 30] },
                    ],
                  },
                },
              },
            ],
          }
        : section,
    );
    const manifest = extractArticleContextFromDocument({
      ...document,
      sections,
    });

    expect(manifest.blocks).toHaveLength(1);
    expect(manifest.blocks[0]).toMatchObject({
      kind: "chart",
      title: "Visitors",
      chart: {
        sourceChartType: "chart-extension",
        rows: [
          { category: "A", visitors: 10 },
          { category: "B", visitors: 20 },
          { category: "C", visitors: 30 },
        ],
      },
    });
  });

  it("projects complete multi-geometry Kartographer data", () => {
    const document = documentWithTable();
    const sections = document.sections.map((section) =>
      section.key === "1"
        ? {
            ...section,
            blocks: [
              {
                kind: "extension" as const,
                id: "map-extension",
                sourceOrder: 12,
                contentHash: "map-extension-hash",
                extension: {
                  kind: "kartographer" as const,
                  presentation: "mapframe" as const,
                  zoom: 4,
                  geoJson: {
                    type: "FeatureCollection",
                    features: [
                      {
                        type: "Feature",
                        properties: { name: "Island cities" },
                        geometry: {
                          type: "MultiPoint",
                          coordinates: [
                            [170, 10],
                            [-170, 12],
                          ],
                        },
                      },
                      {
                        type: "Feature",
                        properties: { name: "Shipping lanes" },
                        geometry: {
                          type: "MultiLineString",
                          coordinates: [
                            [
                              [170, 10],
                              [179, 11],
                            ],
                            [
                              [-179, 11],
                              [-170, 12],
                            ],
                          ],
                        },
                      },
                      {
                        type: "Feature",
                        properties: { name: "Archipelago" },
                        geometry: {
                          type: "MultiPolygon",
                          coordinates: [
                            [
                              [
                                [170, 9],
                                [171, 9],
                                [171, 10],
                                [170, 9],
                              ],
                            ],
                          ],
                        },
                      },
                    ],
                  },
                },
              },
            ],
          }
        : section,
    );
    const [map] = extractArticleContextFromDocument({
      ...document,
      sections,
    }).blocks;

    expect(map).toMatchObject({
      kind: "map",
      map: {
        suggestedZoom: 4,
        features: [
          { name: "Island cities", geometry: { type: "MultiPoint" } },
          { name: "Shipping lanes", geometry: { type: "MultiLineString" } },
          { name: "Archipelago", geometry: { type: "MultiPolygon" } },
        ],
        places: expect.arrayContaining([
          expect.objectContaining({ latitude: 10, longitude: 170 }),
          expect.objectContaining({ latitude: 12, longitude: -170 }),
        ]),
      },
    });
    expect(
      map.kind === "map" ? Math.abs(map.map.center.longitude) : 0,
    ).toBeGreaterThan(170);
  });

  it("declines mapframe viewport coordinates but keeps a labeled maplink point", () => {
    const withPresentation = (presentation: "mapframe" | "maplink") => {
      const document = documentWithTable();
      const sections = document.sections.map((section) =>
        section.key === "1"
          ? {
              ...section,
              blocks: [
                {
                  kind: "extension" as const,
                  id: `map-${presentation}`,
                  sourceOrder: 12,
                  contentHash: `map-${presentation}`,
                  extension: {
                    kind: "kartographer" as const,
                    presentation,
                    label: "Source location",
                    latitude: 41.9,
                    longitude: 12.5,
                    zoom: 8,
                  },
                },
              ],
            }
          : section,
      );
      return extractArticleContextFromDocument({ ...document, sections });
    };

    expect(withPresentation("mapframe").blocks).toEqual([]);
    expect(withPresentation("maplink").blocks[0]).toMatchObject({
      kind: "map",
      map: {
        features: [
          {
            name: "Source location",
            geometry: {
              type: "Point",
              coordinates: { latitude: 41.9, longitude: 12.5 },
            },
          },
        ],
      },
    });
  });

  it("keeps a valid visual beside an unrelated unsupported block", () => {
    const document = documentWithTable();
    const sections = document.sections.map((section) =>
      section.key === "1"
        ? {
            ...section,
            fidelity: "partial" as const,
            blocks: [
              {
                kind: "unsupported" as const,
                id: "bad-table",
                sourceOrder: 11,
                contentHash: "bad-table",
                sourceKind: "table" as const,
                reason: "malformed-table" as const,
                affectsNarration: true,
              },
              {
                kind: "extension" as const,
                id: "valid-map",
                sourceOrder: 12,
                contentHash: "valid-map",
                extension: {
                  kind: "kartographer" as const,
                  presentation: "mapframe" as const,
                  geoJson: {
                    type: "Point",
                    coordinates: [12.5, 41.9],
                  },
                },
              },
            ],
          }
        : section,
    );

    expect(
      extractArticleContextFromDocument({ ...document, sections }).blocks[0],
    ).toMatchObject({ kind: "map" });
  });

  it("projects isolated EasyTimeline entries without scanning wikitext", () => {
    const document = documentWithTable();
    const sections = document.sections.map((section) =>
      section.key === "1"
        ? {
            ...section,
            blocks: [
              {
                kind: "extension" as const,
                id: "timeline-extension",
                sourceOrder: 12,
                contentHash: "timeline-extension-hash",
                extension: {
                  kind: "easy-timeline" as const,
                  dateFormat: "year" as const,
                  entries: [
                    { from: "2022", to: "", label: "Third event" },
                    { from: "2020", to: "", label: "First event" },
                    {
                      from: "2021",
                      to: "",
                      label: "Second event",
                      category: "Milestone",
                    },
                  ],
                },
              },
            ],
          }
        : section,
    );
    const [timeline] = extractArticleContextFromDocument({
      ...document,
      sections,
    }).blocks;

    expect(timeline).toMatchObject({
      kind: "timeline",
      timeline: {
        chronological: true,
        events: [
          { label: "First event", start: { display: "2020" } },
          {
            label: "Second event",
            start: { display: "2021" },
            category: "Milestone",
          },
          { label: "Third event", start: { display: "2022" } },
        ],
      },
    });
  });

  it("projects a semantic figure and imagemap regions as a diagram", () => {
    const document = documentWithTable();
    const sections = document.sections.map((section) =>
      section.key === "1"
        ? {
            ...section,
            blocks: [
              {
                kind: "figure" as const,
                id: "figure-1",
                sourceOrder: 12,
                contentHash: "figure-hash",
                caption:
                  "A process diagram showing intake water flowing through the turbine and onward to the outlet.",
                media: [
                  {
                    kind: "image" as const,
                    src: "https://upload.wikimedia.org/wikipedia/commons/a/ab/Process.png",
                    resourceTitle: "File:Process.png",
                    alt: "Process diagram",
                    width: 640,
                    height: 480,
                  },
                ],
                regions: [
                  { label: "Intake", description: "Water enters here" },
                  { label: "Turbine" },
                ],
              },
            ],
          }
        : section,
    );
    const [diagram] = extractArticleContextFromDocument({
      ...document,
      sections,
    }).blocks;

    expect(diagram).toMatchObject({
      kind: "diagram",
      diagram: {
        image: {
          src: "https://upload.wikimedia.org/wikipedia/commons/a/ab/Process.png",
          width: 640,
          height: 480,
        },
        parts: [
          { label: "Intake", description: "Water enters here" },
          { label: "Turbine" },
        ],
      },
    });
  });

  it("keeps a semantic imagemap with named regions despite a terse caption", () => {
    const document = documentWithTable();
    const sections = document.sections.map((section) =>
      section.key === "1"
        ? {
            ...section,
            blocks: [
              {
                kind: "figure" as const,
                id: "solar-system-imagemap",
                sourceOrder: 12,
                contentHash: "solar-system-imagemap",
                caption: "Solar System",
                media: [
                  {
                    kind: "image" as const,
                    src: "https://upload.wikimedia.org/wikipedia/commons/a/ab/Solar_System.png",
                    resourceTitle: "File:Solar System.png",
                    alt: "Solar System",
                    width: 900,
                    height: 600,
                  },
                ],
                regions: [{ label: "Sun" }, { label: "Earth" }],
              },
            ],
          }
        : section,
    );

    const [diagram] = extractArticleContextFromDocument({
      ...document,
      sections,
    }).blocks;

    expect(diagram).toMatchObject({
      kind: "diagram",
      caption: "Solar System",
      diagram: {
        parts: [{ label: "Sun" }, { label: "Earth" }],
      },
    });
  });

  it("uses parsed map and chart semantics from captions, alt text, and file titles", () => {
    const document = documentWithTable();
    const makeFigure = (
      id: string,
      sourceOrder: number,
      caption: string,
      alt: string,
      resourceTitle: string,
    ) => ({
      kind: "figure" as const,
      id,
      sourceOrder,
      contentHash: `${id}-hash`,
      caption,
      media: [
        {
          kind: "image" as const,
          src: `https://upload.wikimedia.org/wikipedia/commons/a/ab/${id}.png`,
          resourceTitle,
          alt,
          width: 640,
          height: 480,
        },
      ],
      regions: [],
    });
    const baseSections = document.sections.map((section) =>
      section.key === "1"
        ? {
            ...section,
            blocks: [
              makeFigure(
                "subway-map",
                12,
                "Current official map",
                "",
                "File:Transit map.png",
              ),
            ],
          }
        : section,
    );
    const sectionTemplate = document.sections.find(
      (section) => section.key === "1",
    )!;
    const sections = [
      ...baseSections,
      {
        ...sectionTemplate,
        key: "2",
        title: "Government system",
        sourceOrder: 20,
        blocks: [
          makeFigure(
            "government-chart",
            21,
            "The legislature within the political system",
            "",
            "File:Chart Basic Law.png",
          ),
        ],
      },
      {
        ...sectionTemplate,
        key: "3",
        title: "Building",
        sourceOrder: 30,
        blocks: [
          makeFigure(
            "building-photo",
            31,
            "The legislature building in the evening",
            "Stone building",
            "File:Parliament at dusk.png",
          ),
        ],
      },
      {
        ...sectionTemplate,
        key: "4",
        title: "Music",
        sourceOrder: 40,
        blocks: [
          makeFigure(
            "singer-photo",
            41,
            "The singer topped the chart in 2020 before accepting the award.",
            "Singer at an awards ceremony",
            "File:Singer at ceremony.jpg",
          ),
        ],
      },
      {
        ...sectionTemplate,
        key: "5",
        title: "Passengers",
        sourceOrder: 50,
        blocks: [
          makeFigure(
            "visitor-photo",
            51,
            "A visitor holds a map while waiting on the station platform.",
            "Passenger holding a paper guide",
            "File:Young woman looks at a route map on a platform.jpg",
          ),
        ],
      },
    ];

    const manifest = extractArticleContextFromDocument({
      ...document,
      sections,
    });

    expect(manifest.blocks).toHaveLength(2);
    expect(manifest.blocks).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          kind: "diagram",
          caption: "Current official map",
        }),
        expect.objectContaining({
          kind: "diagram",
          caption: "The legislature within the political system",
        }),
      ]),
    );
    expect(
      manifest.blocks.some((block) => block.caption.includes("evening")),
    ).toBe(false);
    expect(
      manifest.blocks.some((block) => block.caption.includes("topped")),
    ).toBe(false);
    expect(
      manifest.blocks.some((block) => block.caption.includes("visitor")),
    ).toBe(false);
  });
});
