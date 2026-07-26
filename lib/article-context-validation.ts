import {
  ARTICLE_CONTEXT_SCHEMA_VERSION,
  type ContextBlock,
  type ContextCoordinate,
  type ContextMapGeometry,
  type ContextManifest,
} from "./article-context-types";
import { isValidContextDiagramLegend } from "./article-context-legend";
import {
  MAX_BLOCKS_PER_ARTICLE,
  MAX_TABLE_CELLS,
  MAX_TABLE_ROWS,
} from "./article-context-limits";

const legendTextFields = (block: ContextBlock): string[] => {
  if (
    block.kind !== "diagram" ||
    !isValidContextDiagramLegend(block.diagram.legend)
  ) {
    return [];
  }
  return [
    block.diagram.legend.description,
    ...block.diagram.legend.entries.flatMap((entry) => [
      entry.color,
      entry.text,
    ]),
    ...block.diagram.legend.notes,
  ];
};

const blockTextFields = (block: ContextBlock): string[] => [
  block.title,
  block.caption,
  block.longDescription,
  block.section.title,
  ...block.sources.flatMap((source) => [source.label, source.url]),
  ...legendTextFields(block),
];

const isHttpsUrl = (value: string): boolean => {
  try {
    return new URL(value).protocol === "https:";
  } catch {
    return false;
  }
};

const isSafeCommonsImage = (value: string): boolean => {
  try {
    const url = new URL(value.startsWith("//") ? `https:${value}` : value);
    return (
      url.protocol === "https:" &&
      url.hostname === "upload.wikimedia.org" &&
      url.pathname.startsWith("/wikipedia/commons/") &&
      !url.pathname.toLocaleLowerCase().includes("/math/") &&
      !url.pathname.toLocaleLowerCase().endsWith(".svg")
    );
  } catch {
    return false;
  }
};

const validCoordinate = (latitude: number, longitude: number): boolean =>
  latitude >= -90 && latitude <= 90 && longitude >= -180 && longitude <= 180;

const geometryCoordinates = (
  geometry: ContextMapGeometry,
): ContextCoordinate[] => {
  if (geometry.type === "Point") return [geometry.coordinates];
  if (geometry.type === "MultiPoint" || geometry.type === "LineString") {
    return geometry.coordinates;
  }
  if (geometry.type === "MultiLineString" || geometry.type === "Polygon") {
    return geometry.coordinates.flat();
  }
  if (geometry.type === "MultiPolygon") {
    return geometry.coordinates.flat(2);
  }
  return geometry.geometries.flatMap(geometryCoordinates);
};

/** Human-readable invariant violations; an empty array is client-safe. */
export const validateContextManifest = (
  manifest: ContextManifest,
): string[] => {
  const errors: string[] = [];
  if (manifest.schemaVersion !== ARTICLE_CONTEXT_SCHEMA_VERSION) {
    errors.push("Unsupported context schema version");
  }
  if (manifest.blocks.length > MAX_BLOCKS_PER_ARTICLE) {
    errors.push("Too many context blocks");
  }
  const ids = new Set<string>();
  for (const block of manifest.blocks) {
    if (!block.id || ids.has(block.id)) {
      errors.push(`Duplicate or empty block ID: ${block.id}`);
    }
    ids.add(block.id);
    if (
      !block.title ||
      !block.caption ||
      !block.longDescription ||
      block.sources.length === 0
    ) {
      errors.push(
        `Block ${block.id} is missing its accessibility copy or sources`,
      );
    }
    if (
      blockTextFields(block).some((text) =>
        /<(?:script|style|svg|iframe|object|embed)\b/i.test(text),
      )
    ) {
      errors.push(`Block ${block.id} contains unsafe markup`);
    }
    if (block.sources.some((source) => !isHttpsUrl(source.url))) {
      errors.push(`Block ${block.id} contains a non-HTTPS source`);
    }

    if (block.kind === "map") {
      const featureCount =
        block.map.features?.length ??
        block.map.places.length +
          block.map.routes.length +
          block.map.areas.length;
      if (featureCount === 0) {
        errors.push(`Map ${block.id} has no semantic features`);
      }
      const coordinates: ContextCoordinate[] = block.map.features
        ? [
            block.map.center,
            ...block.map.features.flatMap((feature) =>
              geometryCoordinates(feature.geometry),
            ),
          ]
        : [
            block.map.center,
            ...block.map.places,
            ...block.map.routes.flatMap((route) => route.points),
            ...block.map.areas.flatMap((area) => area.rings.flat()),
          ];
      if (
        coordinates.some(
          ({ latitude, longitude }) =>
            !Number.isFinite(latitude) ||
            !Number.isFinite(longitude) ||
            !validCoordinate(latitude, longitude),
        )
      ) {
        errors.push(`Map ${block.id} contains an invalid coordinate`);
      }
      if (block.map.routes.some((route) => route.points.length < 2)) {
        errors.push(`Map ${block.id} contains an incomplete route`);
      }
    } else if (block.kind === "timeline") {
      if (
        block.timeline.events.length < 3 ||
        block.timeline.events.length > MAX_TABLE_ROWS
      ) {
        errors.push(`Timeline ${block.id} has an unsupported event count`);
      }
      if (
        block.timeline.events.some(
          (event, index, events) =>
            !event.label ||
            !Number.isFinite(event.start.sortKey) ||
            (index > 0 &&
              event.start.sortKey < events[index - 1].start.sortKey),
        )
      ) {
        errors.push(`Timeline ${block.id} has invalid or unsorted events`);
      }
    } else if (block.kind === "chart") {
      const columnKeys = new Set(
        block.chart.columns.map((column) => column.key),
      );
      if (
        block.chart.columns.length < 2 ||
        columnKeys.size !== block.chart.columns.length ||
        block.chart.rows.length < 3 ||
        block.chart.rows.length > MAX_TABLE_ROWS ||
        block.chart.rows.length * block.chart.columns.length > MAX_TABLE_CELLS
      ) {
        errors.push(`Chart ${block.id} has an invalid table shape`);
      }
      if (
        block.chart.series.some(
          (series) =>
            !columnKeys.has(series.xColumn) ||
            !columnKeys.has(series.yColumn) ||
            !block.chart.rows.some(
              (row) => typeof row[series.yColumn] === "number",
            ),
        )
      ) {
        errors.push(`Chart ${block.id} has an invalid series`);
      }
    } else if (block.kind === "diagram") {
      if (
        !isSafeCommonsImage(block.diagram.image.src) ||
        !block.diagram.caption ||
        block.diagram.walkthrough.length === 0
      ) {
        errors.push(
          `Diagram ${block.id} is missing its safe semantic equivalent`,
        );
      }
      if (
        block.diagram.legend !== undefined &&
        !isValidContextDiagramLegend(block.diagram.legend)
      ) {
        errors.push(`Diagram ${block.id} contains an invalid legend`);
      }
    }
  }
  return errors;
};
