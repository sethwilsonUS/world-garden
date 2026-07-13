import type {
  ArticleContextDownloadFormat,
  ContextBlock,
  ContextChartCell,
  ContextManifest,
} from "./article-context-types";

type CsvValue = string | number | null | undefined;

const CSV_HEADERS = [
  "block_id",
  "kind",
  "section_index",
  "section_title",
  "item_type",
  "item_id",
  "label",
  "start",
  "end",
  "latitude",
  "longitude",
  "series",
  "x",
  "value",
  "unit",
  "description",
  "source_url",
  "revision_id",
] as const;

type CsvHeader = (typeof CSV_HEADERS)[number];
type CsvRow = Record<CsvHeader, CsvValue>;

const emptyRow = (manifest: ContextManifest, block: ContextBlock): CsvRow => ({
  block_id: block.id,
  kind: block.kind,
  section_index: block.section.index,
  section_title: block.section.title,
  item_type: "",
  item_id: "",
  label: "",
  start: "",
  end: "",
  latitude: "",
  longitude: "",
  series: "",
  x: "",
  value: "",
  unit: "",
  description: "",
  source_url: block.sources[0]?.url ?? block.provenance.articleRevisionUrl,
  revision_id: manifest.revisionId,
});

const chartCell = (value: ContextChartCell): CsvValue => value ?? "";

const blockRows = (manifest: ContextManifest, block: ContextBlock): CsvRow[] => {
  const base = emptyRow(manifest, block);
  if (block.kind === "map") {
    const places = block.map.places.map((place) => ({
      ...base,
      item_type: "place",
      item_id: place.id,
      label: place.name,
      latitude: place.latitude,
      longitude: place.longitude,
      description: place.description ?? "",
    }));
    const routePoints = block.map.routes.flatMap((route) =>
      route.points.map((point, index) => ({
        ...base,
        item_type: "route_point",
        item_id: `${route.id}:${index + 1}`,
        label: point.label || route.name,
        latitude: point.latitude,
        longitude: point.longitude,
        description: route.description ?? "",
      })),
    );
    const areaPoints = block.map.areas.flatMap((area) =>
      area.rings.flatMap((ring, ringIndex) =>
        ring.map((point, pointIndex) => ({
          ...base,
          item_type: "area_point",
          item_id: `${area.id}:${ringIndex + 1}:${pointIndex + 1}`,
          label: area.name,
          latitude: point.latitude,
          longitude: point.longitude,
          description: area.description ?? "",
        })),
      ),
    );
    return [...places, ...routePoints, ...areaPoints];
  }
  if (block.kind === "timeline") {
    return block.timeline.events.map((event) => ({
      ...base,
      item_type: "event",
      item_id: event.id,
      label: event.label,
      start: event.start.display,
      end: event.end?.display ?? "",
      description: event.description ?? "",
    }));
  }
  if (block.kind === "chart") {
    return block.chart.series.flatMap((series) =>
      block.chart.rows.map((row, index) => ({
        ...base,
        item_type: "data_point",
        item_id: `${series.id}:${index + 1}`,
        label: series.label,
        series: series.label,
        x: chartCell(row[series.xColumn] ?? null),
        value: chartCell(row[series.yColumn] ?? null),
        unit: series.unit ?? "",
      })),
    );
  }
  const parts = block.diagram.parts.map((part) => ({
    ...base,
    item_type: "diagram_part",
    item_id: part.id,
    label: part.label,
    description: part.description ?? "",
  }));
  const steps = block.diagram.walkthrough.map((step, index) => ({
    ...base,
    item_type: "walkthrough_step",
    item_id: `${block.id}:step:${index + 1}`,
    label: `Step ${index + 1}`,
    description: step,
  }));
  return [...parts, ...steps];
};

const quoteCsv = (value: CsvValue): string => {
  let text = value == null ? "" : String(value);
  if (typeof value === "string" && /^(?:[\t\r\n]|\s*[=+\-@])/.test(text)) {
    text = `'${text}`;
  }
  return /[",\r\n]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text;
};

export const serializeArticleContextCsv = (manifest: ContextManifest): string => {
  const rows = manifest.blocks.flatMap((block) => blockRows(manifest, block));
  return [
    CSV_HEADERS.join(","),
    ...rows.map((row) => CSV_HEADERS.map((header) => quoteCsv(row[header])).join(",")),
  ].join("\r\n");
};

export const serializeArticleContextJson = (manifest: ContextManifest): string =>
  `${JSON.stringify(manifest, null, 2)}\n`;

const safeFileStem = (title: string): string =>
  title
    .normalize("NFKD")
    .replace(/[^a-zA-Z0-9]+/g, "-")
    .replace(/^-|-$/g, "")
    .toLowerCase()
    .slice(0, 80) || "article";

export const createArticleContextDownload = (
  manifest: ContextManifest,
  format: ArticleContextDownloadFormat,
): {
  body: string;
  contentType: string;
  fileName: string;
} => {
  if (format === "csv") {
    return {
      body: serializeArticleContextCsv(manifest),
      contentType: "text/csv; charset=utf-8",
      fileName: `${safeFileStem(manifest.title)}-context.csv`,
    };
  }
  return {
    body: serializeArticleContextJson(manifest),
    contentType: "application/json; charset=utf-8",
    fileName: `${safeFileStem(manifest.title)}-context.json`,
  };
};
