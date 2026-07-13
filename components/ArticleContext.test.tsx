import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import type {
  ContextBlock,
  ContextChartBlock,
  ContextManifest,
  ContextMapBlock,
} from "@/lib/article-context-types";
import type { ArticleImage } from "@/lib/data-context";
import {
  ArticleContextLane,
  ContextSectionLink,
  chartToCsv,
  getContextBlocksForSection,
} from "./ArticleContext";
import { Lightbox } from "./ArticleGallery";
import { ContextChartView, MapSchematic } from "./ArticleContextVisuals";
import { ThemeProvider } from "./ThemeProvider";

const base = {
  caption: "This makes the visual easier to understand.",
  longDescription: "A complete long description that does not depend on the visual view.",
  section: { index: "1", title: "History", anchor: "History" },
  order: 1,
  sources: [
    {
      label: "Wikipedia source",
      url: "https://en.wikipedia.org/wiki/Example",
      revisionId: "123",
      license: "CC BY-SA 4.0",
      accessedAt: "2026-07-13T00:00:00.000Z",
    },
  ],
  provenance: {
    articleUrl: "https://en.wikipedia.org/wiki/Example",
    articleRevisionUrl: "https://en.wikipedia.org/w/index.php?oldid=123",
    sourceHash: "abcdef1234567890",
    extractorVersion: "2.0.0",
    descriptionMethod: "deterministic" as const,
  },
};

const blocks: ContextBlock[] = [
  {
    ...base,
    id: "map-one",
    kind: "map",
    title: "Places in the journey",
    caption: "Rome is the single place identified for this journey.",
    section: { index: "__summary__", title: "Summary" },
    map: {
      center: { latitude: 41.9, longitude: 12.5 },
      suggestedZoom: 5,
      places: [
        {
          id: "rome",
          name: "Rome",
          latitude: 41.9,
          longitude: 12.5,
          description: "The starting point.",
        },
      ],
      routes: [],
      areas: [],
    },
  },
  {
    ...base,
    id: "timeline-one",
    kind: "timeline",
    title: "Key events",
    caption: "The expedition began on 20 July 1969.",
    order: 2,
    timeline: {
      chronological: true,
      events: [
        {
          id: "event-one",
          label: "The expedition began",
          start: {
            display: "20 July 1969",
            iso: "1969-07-20",
            sortKey: 19690720,
            precision: "day",
          },
          description: "The first event in the sequence.",
          category: "Expedition",
        },
      ],
    },
  },
  {
    ...base,
    id: "chart-one",
    kind: "chart",
    title: "Population over time",
    caption: "Population rises from 100 to 1.65 billion between 1900 and 2000.",
    order: 3,
    chart: {
      columns: [
        { key: "year", label: "Year", dataType: "string" },
        { key: "population", label: "Population", dataType: "number", unit: "people" },
      ],
      rows: [
        { year: "1900", population: 100 },
        { year: "2000", population: 1_650_000_000 },
      ],
      series: [
        {
          id: "population",
          label: "Population",
          type: "line",
          xColumn: "year",
          yColumn: "population",
          unit: "people",
        },
      ],
      sourceChartType: "wikitable",
    },
  },
  {
    ...base,
    id: "diagram-one",
    kind: "diagram",
    title: "How the system connects",
    caption: "The first part flows into the second part.",
    order: 4,
    diagram: {
      image: {
        src: "https://upload.wikimedia.org/example.png",
        alt: "A labeled diagram of two connected parts.",
        width: 800,
        height: 600,
      },
      parts: [
        { id: "a", label: "First part", description: "The input." },
        { id: "b", label: "Second part", description: "The output." },
      ],
      relationships: [{ fromId: "a", toId: "b", label: "flows into" }],
      walkthrough: ["Begin at the first part.", "Follow the connection to the second part."],
      caption: "The source diagram and its two labeled parts.",
    },
  },
];

const manifest: ContextManifest = {
  schemaVersion: 2,
  wikiPageId: "123",
  title: "Example",
  revisionId: "123",
  language: "en",
  sourceHash: "manifesthash",
  extractorVersion: "2.0.0",
  generatedAt: "2026-07-13T00:00:00.000Z",
  blocks,
};

describe("ArticleContext", () => {
  it("renders compact direct links to the associated first visual", () => {
    const markup = renderToStaticMarkup(
      createElement(ContextSectionLink, { blocks: [blocks[0]] }),
    );

    expect(markup).toContain('href="#article-context-map-one"');
    expect(markup).toContain(
      'aria-label="1 visual: jump to map: Places in the journey"',
    );
    expect(markup).toContain("1 visual");
  });

  it("renders every visual directly with captions, fuller descriptions, and semantic equivalents", () => {
    const markup = renderToStaticMarkup(
      createElement(
        ThemeProvider,
        null,
        createElement(ArticleContextLane, {
          state: { status: "ready", manifest, error: null },
          retry: () => {},
        }),
      ),
    );

    expect(markup).toContain("Show coordinate overview");
    expect(markup).toContain("Street map will load as it approaches the viewport.");
    expect(markup).not.toContain("context-explorer");
    expect(markup).not.toContain("Listen to context");
    expect(markup).not.toContain("Listen to full description");
    expect(markup).toContain('id="article-context-map-one" tabindex="-1"');
    expect(markup).toContain(
      'aria-describedby="article-context-map-one-caption article-context-map-one-description"',
    );
    expect(markup).toContain(
      '<p id="article-context-map-one-caption" class="context-visual-caption">Rome is the single place identified for this journey.</p>',
    );
    expect(markup).toContain(
      '<p id="article-context-map-one-description" class="sr-only">A complete long description that does not depend on the visual view.</p>',
    );
    expect(markup).toContain(
      '<span class="context-data-disclosure-label">Exact map data<span class="sr-only"> for Places in the journey</span></span>',
    );
    expect(markup).toContain(
      '<span class="context-data-disclosure-meta">1 place</span>',
    );
    expect(markup).toContain("Latitude 41.9000, longitude 12.5000");
    expect(markup).toContain('<time dateTime="1969-07-20">20 July 1969</time>');
    expect(markup).toContain(
      '<span class="context-data-disclosure-label">Exact chart data<span class="sr-only"> for Population over time</span></span>',
    );
    expect(markup).toContain(
      '<span class="context-data-disclosure-meta">2 rows, 2 columns</span>',
    );
    expect(markup).toContain("Exact data for Population over time");
    expect(markup).toContain('<th scope="row">1900</th>');
    expect(markup).toContain("1,650,000,000");
    expect(markup).toContain('alt="A labeled diagram of two connected parts."');
    expect(markup).toContain("First part");
    expect(markup).toContain("flows into");
    expect(markup).toContain("Report a problem");
    expect(markup).not.toContain('role="application"');

    const dataDisclosures = markup.match(
      /<details class="context-data-disclosure">/g,
    );
    expect(dataDisclosures).toHaveLength(2);
    expect(markup).not.toContain(
      '<details class="context-data-disclosure" open="">',
    );

    const mapPosition = markup.indexOf("article-context-map-one");
    const timelinePosition = markup.indexOf("article-context-timeline-one");
    const chartPosition = markup.indexOf("article-context-chart-one");
    const diagramPosition = markup.indexOf("article-context-diagram-one");
    expect(mapPosition).toBeLessThan(timelinePosition);
    expect(timelinePosition).toBeLessThan(chartPosition);
    expect(chartPosition).toBeLessThan(diagramPosition);
  });

  it("renders no lane or placeholder spacing for a ready manifest with no visuals", () => {
    const markup = renderToStaticMarkup(
      createElement(ArticleContextLane, {
        state: {
          status: "ready",
          manifest: { ...manifest, blocks: [] },
          error: null,
        },
        retry: () => {},
      }),
    );

    expect(markup).toBe("");
  });

  it("renders ranked data as a concise leaderboard with entity row headers", () => {
    const rankingBlock: ContextChartBlock = {
      ...base,
      id: "ranking-one",
      kind: "chart",
      title: "Tournament ranking data",
      caption:
        "Points is listed for 13 ranked entries; the lowest is 1 for Team 13, and the highest is 13 for Team 1.",
      chart: {
        columns: [
          { key: "position", label: "Position", dataType: "number" },
          { key: "team", label: "Team", dataType: "string" },
          { key: "points", label: "Points", dataType: "number" },
          { key: "won", label: "Won", dataType: "number" },
          { key: "final-result", label: "Final result", dataType: "string" },
        ],
        rows: Array.from({ length: 13 }, (_, index) => ({
          position: index + 1,
          team: `Team ${index + 1}`,
          points: 13 - index,
          won: Math.max(0, 6 - Math.floor(index / 2)),
          "final-result": index < 4 ? "Semifinals" : "Eliminated",
        })),
        series: [
          {
            id: "points",
            label: "Points",
            type: "bar",
            xColumn: "team",
            yColumn: "points",
          },
          {
            id: "won",
            label: "Won",
            type: "bar",
            xColumn: "team",
            yColumn: "won",
          },
        ],
        sourceChartType: "wikitable",
      },
    };

    const markup = renderToStaticMarkup(
      createElement(
        ThemeProvider,
        null,
        createElement(ContextChartView, {
          block: rankingBlock,
          caption: rankingBlock.caption,
          captionId: "ranking-caption",
        }),
      ),
    );

    expect(markup).toContain(
      'aria-label="Points for the first 8 published entries in Tournament ranking data"',
    );
    expect(markup.match(/<li>/g)).toHaveLength(8);
    expect(markup).toContain(
      "The overview pictures the first 8 of 13 published entries in source ranking order.",
    );
    expect(markup).toContain(
      "Bar lengths provide supporting metric context and do not determine the published rank.",
    );
    expect(markup.match(/type="checkbox"/g)).toHaveLength(2);
    expect(markup).toContain('type="checkbox" disabled="" checked=""');
    expect(markup).toContain("Metrics shown in the ranking overview");
    expect(markup).toContain("Points shown. Each metric uses its own scale");
    expect(markup).toContain('class="context-ranked-bar-track" aria-hidden="true"');
    expect(markup).toContain("context-ranked-bar-fill-positive");
    expect(markup).not.toContain("context-echarts");
    expect(markup).toContain('<span class="sr-only">Team: </span>Team 1');
    expect(markup).toContain(
      '<span class="sr-only">Final result: </span>Semifinals',
    );
    expect(markup).toContain('<th scope="row">Team 1</th>');
    expect(markup).toContain('<td>1</td><th scope="row">Team 1</th>');
  });

  it("separates incompatible standard-chart scales and keeps exact rows intact", () => {
    const demographicBlock: ContextChartBlock = {
      ...base,
      id: "demographic-one",
      kind: "chart",
      title: "Age and sex distribution",
      caption: "Population totals and percentages are available by age group.",
      chart: {
        columns: [
          { key: "age", label: "Age group", dataType: "string" },
          { key: "total", label: "Total (thousands)", dataType: "number", unit: "thousands" },
          { key: "male", label: "Males (thousands)", dataType: "number", unit: "thousands" },
          { key: "share", label: "Share of population", dataType: "number", unit: "%" },
          { key: "ratio", label: "Sex ratio", dataType: "number", unit: "males per female" },
        ],
        rows: [
          { age: "Total", total: 330_000, male: 164_000, share: 100, ratio: 0.98 },
          ...Array.from({ length: 13 }, (_, index) => ({
            age: `${index * 5}–${index * 5 + 4}`,
            total: 30_000 - index * 1_000,
            male: index === 0 ? null : 15_000 - index * 500,
            share: 9 - index * 0.4,
            ratio: 1.05 - index * 0.02,
          })),
        ],
        series: [
          {
            id: "total",
            label: "Total (thousands)",
            type: "bar",
            xColumn: "age",
            yColumn: "total",
            unit: "thousands",
          },
          {
            id: "male",
            label: "Males (thousands)",
            type: "bar",
            xColumn: "age",
            yColumn: "male",
            unit: "thousands",
          },
          {
            id: "share",
            label: "Share of population",
            type: "bar",
            xColumn: "age",
            yColumn: "share",
            unit: "%",
          },
          {
            id: "ratio",
            label: "Sex ratio",
            type: "bar",
            xColumn: "age",
            yColumn: "ratio",
            unit: "males per female",
          },
        ],
        sourceChartType: "wikitable",
      },
    };

    const markup = renderToStaticMarkup(
      createElement(
        ThemeProvider,
        null,
        createElement(ContextChartView, {
          block: demographicBlock,
          caption: demographicBlock.caption,
          captionId: "demographic-caption",
        }),
      ),
    );

    expect(markup).toContain("Series shown in the visual overview");
    expect(markup.match(/type="checkbox"/g)).toHaveLength(4);
    expect(markup.match(/type="checkbox" checked=""/g)).toHaveLength(2);
    expect(markup).toContain("Total (thousands)</span>");
    expect(markup).not.toContain("Total (thousands) (thousands)");
    expect(markup).toContain("Counts (thousands)");
    expect(markup).toContain(
      "Total (thousands) and Males (thousands) shown on one compatible scale.",
    );
    expect(markup).toContain(
      "Showing the first 12 of 13 categories in meaningful source order; 1 more remain in Exact chart data. 1 aggregate row kept in Exact chart data.",
    );
    expect(markup.match(/<section class="context-standard-chart-panel"/g)).toHaveLength(1);
    expect(markup).toContain(
      'aria-label="Total (thousands) and Males (thousands) by category for Age and sex distribution"',
    );
    expect(markup.match(/class="context-mobile-bar-track"/g)).toHaveLength(24);
    expect(markup).toContain("context-mobile-bar-fill-positive");
    expect(markup).toContain(">30,000</strong><span> thousands</span>");
    expect(markup).toContain(">Not available</strong>");
    expect(markup).not.toContain(">Not available</strong><span> thousands</span>");
    expect(markup).toContain('<th scope="row">Total</th>');
    expect(markup).toContain(
      '<span class="context-data-disclosure-meta">14 rows, 5 columns</span>',
    );
  });

  it("omits a misleading connected line when repeated categories have no ordered chronology", () => {
    const repeatedYearBlock: ContextChartBlock = {
      ...base,
      id: "repeated-year-line",
      kind: "chart",
      title: "Population by changing territory",
      caption: "The complete source table lists multiple territories for the same years.",
      chart: {
        columns: [
          { key: "year", label: "Year", dataType: "number" },
          { key: "population", label: "Population", dataType: "number" },
        ],
        rows: Array.from({ length: 14 }, (_, index) => ({
          year: 1800 + Math.floor(index / 2),
          population: 10_000 + index * 500,
        })),
        series: [
          {
            id: "population",
            label: "Population",
            type: "line",
            xColumn: "year",
            yColumn: "population",
          },
        ],
        sourceChartType: "wikitable",
      },
    };

    const markup = renderToStaticMarkup(
      createElement(
        ThemeProvider,
        null,
        createElement(ContextChartView, {
          block: repeatedYearBlock,
          caption: repeatedYearBlock.caption,
          captionId: "repeated-year-caption",
        }),
      ),
    );

    expect(markup).toContain(
      "The visual overview is omitted because the source line does not have a unique ordered chronology",
    );
    expect(markup).not.toContain("context-echarts");
    expect(markup).toContain(">1800</th>");
    expect(markup).toContain("14 rows, 2 columns");
  });

  it("centers a single place in the coordinate overview fallback", () => {
    const markup = renderToStaticMarkup(
      createElement(MapSchematic, { block: blocks[0] as ContextMapBlock }),
    );

    expect(markup).toContain(
      'role="img" aria-label="Coordinate overview for Places in the journey"',
    );
    expect(markup).toContain('transform="translate(320 150)"');
  });

  it("matches context to summary and article sections without relying only on titles", () => {
    expect(getContextBlocksForSection(blocks, null).map((block) => block.id)).toEqual(["map-one"]);
    expect(getContextBlocksForSection(blocks, 0, "History").map((block) => block.id)).toEqual([
      "timeline-one",
      "chart-one",
      "diagram-one",
    ]);
  });

  it("neutralizes formula-leading chart strings in client CSV downloads", () => {
    const chartBlock = blocks.find(
      (block): block is ContextChartBlock => block.kind === "chart",
    );
    expect(chartBlock).toBeDefined();
    if (!chartBlock) return;

    const csv = chartToCsv({
      ...chartBlock,
      chart: {
        ...chartBlock.chart,
        columns: [
          { key: "label", label: "=HYPERLINK(\"https://example.com\")", dataType: "string" },
          { key: "value", label: "Value", dataType: "string" },
        ],
        rows: [
          { label: "+SUM(1,1)", value: "@command" },
          { label: "  -2+3", value: -42 },
        ],
      },
    });

    expect(csv).toContain("'=HYPERLINK");
    expect(csv).toContain("\"'+SUM(1,1)\"");
    expect(csv).toContain("'@command");
    expect(csv).toContain("'  -2+3,-42");
    expect(csv).not.toContain(",'-42");
  });

  it("does not autoplay article-gallery video", () => {
    const markup = renderToStaticMarkup(
      createElement(Lightbox, {
        images: [
          {
            src: "https://upload.wikimedia.org/poster.jpg",
            originalSrc: "https://upload.wikimedia.org/poster.jpg",
            videoSrc: "https://upload.wikimedia.org/video.webm",
            alt: "A demonstration video",
            caption: "A demonstration.",
          },
        ],
        state: { index: 0 },
        onClose: () => {},
      }),
    );

    expect(markup).toContain('preload="metadata"');
    expect(markup).not.toContain("autoplay");
  });

  it("renders the preferred gallery rendition in a viewport media stage", () => {
    const image = {
      src: "https://upload.wikimedia.org/330px-example.jpg",
      originalSrc: "https://upload.wikimedia.org/original-example.jpg",
      lightboxSrc: "https://upload.wikimedia.org/1600px-example.jpg",
      lightboxWidth: 1600,
      lightboxHeight: 1200,
      width: 330,
      height: 248,
      alt: "A detailed example",
      caption: "The detailed example.",
    } satisfies ArticleImage & {
      lightboxSrc: string;
      lightboxWidth: number;
      lightboxHeight: number;
    };
    const markup = renderToStaticMarkup(
      createElement(Lightbox, {
        images: [image],
        state: { index: 0 },
        onClose: () => {},
      }),
    );

    expect(markup).toContain("https://upload.wikimedia.org/1600px-example.jpg");
    expect(markup).toContain("data-lightbox-media-stage");
    expect(markup).toContain('aria-labelledby="');
    expect(markup).toContain('aria-live="polite"');
    expect(markup).toContain('aria-atomic="true"');
    expect(markup).toContain('alt="A detailed example"');
    expect(markup).toContain("h-11 w-11");
    expect(markup).toContain("position:absolute");
    expect(markup).not.toContain('width="330"');
  });

  it("does not repeat a visible caption as the image alternative", () => {
    const markup = renderToStaticMarkup(
      createElement(Lightbox, {
        images: [
          {
            src: "https://upload.wikimedia.org/portrait.jpg",
            originalSrc: "https://upload.wikimedia.org/portrait.jpg",
            alt: "Portrait of Ada Lovelace",
            caption: "Portrait of Ada Lovelace",
          },
        ],
        state: { index: 0 },
        onClose: () => {},
      }),
    );

    expect(markup).toContain('alt=""');
    expect(markup).toContain(">Portrait of Ada Lovelace</p>");
  });

  it("uses the known thumbnail when a trusted lightbox rendition is absent", () => {
    const markup = renderToStaticMarkup(
      createElement(Lightbox, {
        images: [
          {
            src: "https://upload.wikimedia.org/330px-example.jpg",
            originalSrc: "https://upload.wikimedia.org/guessed-original-example.jpg",
            alt: "A cached example",
            caption: "An image from a legacy cache row.",
          },
        ],
        state: { index: 0 },
        onClose: () => {},
      }),
    );

    expect(markup).toContain("https://upload.wikimedia.org/330px-example.jpg");
    expect(markup).not.toContain(
      "https://upload.wikimedia.org/guessed-original-example.jpg",
    );
  });
});
