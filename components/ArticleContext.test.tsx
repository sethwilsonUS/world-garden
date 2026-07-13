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
  ArticleContextIndex,
  ArticleContextLane,
  chartToCsv,
  getContextAudioDetail,
  getContextAudioKey,
  getContextBlocksForSection,
  isContextAudioKey,
} from "./ArticleContext";
import { Lightbox } from "./ArticleGallery";
import { MapSchematic } from "./ArticleContextVisuals";
import { ThemeProvider } from "./ThemeProvider";

const base = {
  takeaway: "This makes the article easier to understand.",
  spokenSummary: "A concise description suitable for synthetic speech.",
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
    extractorVersion: "1.0.0",
    descriptionMethod: "deterministic" as const,
  },
};

const blocks: ContextBlock[] = [
  {
    ...base,
    id: "map-one",
    kind: "map",
    title: "Places in the journey",
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
    order: 3,
    chart: {
      columns: [
        { key: "year", label: "Year", dataType: "string" },
        { key: "population", label: "Population", dataType: "number", unit: "people" },
      ],
      rows: [
        { year: "1900", population: 100 },
        { year: "2000", population: 250 },
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
  schemaVersion: 1,
  wikiPageId: "123",
  title: "Example",
  revisionId: "123",
  language: "en",
  sourceHash: "manifesthash",
  extractorVersion: "1.0.0",
  generatedAt: "2026-07-13T00:00:00.000Z",
  blocks,
};

describe("ArticleContext", () => {
  it("renders a compact section-linked context index", () => {
    const markup = renderToStaticMarkup(
      createElement(ArticleContextIndex, { blocks }),
    );

    expect(markup).toContain('aria-label="Context notes in this article"');
    expect(markup).toContain("Places in the journey");
    expect(markup).toContain("article-context-map-one");
    expect(markup).toContain("Article summary");
  });

  it("renders semantic equivalents alongside the default interactive map", () => {
    const markup = renderToStaticMarkup(
      createElement(
        ThemeProvider,
        null,
        createElement(ArticleContextLane, {
          state: { status: "ready", manifest, error: null },
          retry: () => {},
          onListen: () => {},
        }),
      ),
    );

    expect(markup).toContain("Show coordinate overview");
    expect(markup).toContain("Loading interactive map");
    expect(markup).not.toContain("Coordinate overview — not a street map");
    expect(markup).toContain("Latitude 41.9000, longitude 12.5000");
    expect(markup).toContain('<time dateTime="1969-07-20">20 July 1969</time>');
    expect(markup).toContain("Exact data for Population over time");
    expect(markup).toContain('<th scope="row">1900</th>');
    expect(markup).toContain('alt="A labeled diagram of two connected parts."');
    expect(markup).toContain("First part");
    expect(markup).toContain("flows into");
    expect(markup).toContain("Report a problem");
    expect(markup).not.toContain('role="application"');
  });

  it("centers a single place in the coordinate overview fallback", () => {
    const markup = renderToStaticMarkup(
      createElement(MapSchematic, { block: blocks[0] as ContextMapBlock }),
    );

    expect(markup).toContain("Coordinate overview — not a street map");
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

  it("versions context audio keys with the source hash and description kind", () => {
    expect(getContextAudioKey(blocks[0])).toBe("context-summary-map-one-abcdef123456");
    expect(getContextAudioKey(blocks[0], "description")).toBe(
      "context-description-map-one-abcdef123456",
    );
  });

  it("recognizes only supported context audio keys and recovers their detail", () => {
    const summaryKey = getContextAudioKey(blocks[0], "summary");
    const descriptionKey = getContextAudioKey(blocks[0], "description");

    expect(isContextAudioKey(summaryKey)).toBe(true);
    expect(isContextAudioKey(descriptionKey)).toBe(true);
    expect(getContextAudioDetail(summaryKey)).toBe("summary");
    expect(getContextAudioDetail(descriptionKey)).toBe("description");
    expect(isContextAudioKey("context-unknown-map-one")).toBe(false);
    expect(isContextAudioKey("section-0")).toBe(false);
    expect(isContextAudioKey(null)).toBe(false);
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
