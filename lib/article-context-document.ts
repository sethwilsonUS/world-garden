import type {
  ArticleContextRequest,
  ContextBlock,
  ContextChartBlock,
  ContextManifest,
  ContextSection,
  ContextTimelineEvent,
} from "./article-context-types";
import {
  createChartCandidate,
  createChartCandidateFromSpec,
  extractChartFromTable,
} from "./article-context-charts";
import type { ArticleContextTable } from "./article-context-table";
import { createDiagramCandidateFromFigure } from "./article-context-diagrams";
import { MAX_BLOCKS_PER_ARTICLE } from "./article-context-limits";
import { createMapCandidateFromGeoJson } from "./article-context-geojson";
import {
  createTimelineCandidate,
  extractTimelineFromTable,
  parseContextDateRange,
} from "./article-context-timelines";
import type { BlockCandidate } from "./article-context-foundations";
import {
  ARTICLE_CONTEXT_EXTRACTOR_VERSION,
  ARTICLE_CONTEXT_SCHEMA_VERSION,
} from "./article-context-types";
import { validateContextManifest } from "./article-context-validation";
import type {
  MediaWikiDocument,
  MediaWikiBlock,
  MediaWikiDocumentSection,
  MediaWikiTableBlock,
  MediaWikiTableCell,
} from "./mediawiki-document";

export type ArticleContextDocumentOptions = {
  now?: () => Date;
};

const contextSection = (section: MediaWikiDocumentSection): ContextSection => ({
  index: section.key,
  title: section.title,
  ...(section.anchor ? { anchor: section.anchor } : {}),
});

const proseBefore = (
  section: MediaWikiDocumentSection,
  sourceOrder: number,
): string => {
  const preceding = [...section.blocks]
    .reverse()
    .find((block) => block.sourceOrder < sourceOrder && block.kind === "prose");
  return preceding?.kind === "prose" ? preceding.text : "";
};

const tableCellMap = (
  block: MediaWikiTableBlock,
): Map<string, MediaWikiTableCell> =>
  new Map(block.table.cells.map((cell) => [cell.id, cell]));

const projectTable = (
  section: MediaWikiDocumentSection,
  block: MediaWikiTableBlock,
): {
  table: ArticleContextTable;
} | null => {
  const cells = tableCellMap(block);
  const resolvedRows = block.table.grid.map((row) =>
    row.map((cellId) => cells.get(cellId)),
  );
  if (resolvedRows.some((row) => row.some((cell) => !cell))) return null;

  const dataRows = resolvedRows.filter((row) =>
    row.some((cell) => cell?.kind === "data"),
  ) as MediaWikiTableCell[][];
  if (dataRows.length === 0) return null;
  const width = block.table.columnCount;
  if (dataRows.some((row) => row.length !== width)) return null;

  const originCellsByRow = new Map<number, MediaWikiTableCell[]>();
  for (const cell of block.table.cells) {
    const row = originCellsByRow.get(cell.originRow) ?? [];
    row.push(cell);
    originCellsByRow.set(cell.originRow, row);
  }
  const rowHeaderIds = new Set(
    block.table.cells.flatMap((cell) =>
      cell.kind === "header" &&
      (cell.scope === "row" ||
        cell.scope === "row-group" ||
        (cell.scope == null &&
          (originCellsByRow.get(cell.originRow) ?? []).some(
            (candidate) =>
              candidate.kind === "data" &&
              candidate.originColumn > cell.originColumn,
          )))
        ? [cell.id]
        : [],
    ),
  );
  const isRowHeader = (cell: MediaWikiTableCell): boolean =>
    rowHeaderIds.has(cell.id);
  const fallbackHeadersByColumn = Array.from(
    { length: width },
    (): MediaWikiTableCell[] => [],
  );
  for (const header of block.table.cells) {
    if (header.kind !== "header" || isRowHeader(header)) continue;
    const end = Math.min(width, header.originColumn + header.columnSpan);
    for (let column = header.originColumn; column < end; column += 1) {
      fallbackHeadersByColumn[column].push(header);
    }
  }
  fallbackHeadersByColumn.forEach((headers) =>
    headers.sort(
      (left, right) =>
        left.originRow - right.originRow ||
        left.originColumn - right.originColumn,
    ),
  );
  const headerPathCache = new Map<string, string[]>();
  const columnHeaderPath = (
    cell: MediaWikiTableCell,
    columnIndex: number,
  ): string[] => {
    const cacheKey = `${cell.id}\u0000${columnIndex}`;
    const cached = headerPathCache.get(cacheKey);
    if (cached) return cached;
    const associated = cell.associatedHeaderCellIds
      .map((id) => cells.get(id))
      .filter(
        (header): header is MediaWikiTableCell =>
          header != null && !isRowHeader(header),
      )
      .map((header) => header.text)
      .filter(Boolean);
    const path =
      associated.length > 0
        ? associated
        : fallbackHeadersByColumn[columnIndex]
            .filter((header) => header.originRow < cell.originRow)
            .map((header) => header.text)
            .filter(Boolean);
    headerPathCache.set(cacheKey, path);
    return path;
  };
  const headerPaths = dataRows[0].map((cell, columnIndex) =>
    columnHeaderPath(cell, columnIndex),
  );
  if (headerPaths.some((path) => path.length === 0)) return null;
  if (
    dataRows.some((row) =>
      row.some(
        (cell, columnIndex) =>
          (cell.columnSpan !== 1 && !isRowHeader(cell)) ||
          columnHeaderPath(cell, columnIndex).join("\u0000") !==
            headerPaths[columnIndex].join("\u0000"),
      ),
    )
  ) {
    return null;
  }

  return {
    table: {
      caption: block.table.caption,
      context: proseBefore(section, block.sourceOrder),
      headers: headerPaths.map((path) => path.at(-1) ?? path.join(" — ")),
      headerPaths,
      rows: dataRows.map((row) => row.map((cell) => cell.text)),
      position: block.sourceOrder,
      section: contextSection(section),
    },
  };
};

const tableCandidate = ({
  document,
  section,
  block,
  request,
  generatedAt,
}: {
  document: MediaWikiDocument;
  section: MediaWikiDocumentSection;
  block: MediaWikiTableBlock;
  request: ArticleContextRequest;
  generatedAt: string;
}) => {
  const projected = projectTable(section, block);
  if (!projected) return null;
  const timeline = extractTimelineFromTable(projected.table);
  if (timeline) {
    return createTimelineCandidate({
      events: timeline,
      request,
      sourceHash: document.documentHash,
      generatedAt,
      section: projected.table.section,
      position: block.sourceOrder,
      priority: 86,
      sourceIdentity: `semantic-date-table:${block.contentHash}`,
    });
  }
  const chart = extractChartFromTable(projected.table);
  if (!chart) return null;
  const chartWithHeaders: ContextChartBlock["chart"] = {
    ...chart,
    columns: chart.columns.map((column, index) => ({
      ...column,
      headerPath: projected.table.headerPaths[index] ?? [column.label],
    })),
  };
  return createChartCandidate({
    chart: chartWithHeaders,
    request,
    sourceHash: document.documentHash,
    generatedAt,
    section: projected.table.section,
    position: block.sourceOrder,
    priority: 72,
    sourceIdentity: `semantic-table:${block.contentHash}`,
    title:
      projected.table.caption ||
      `${section.key === "__summary__" ? request.title : section.title} data`,
  });
};

const easyTimelineCandidate = ({
  document,
  section,
  block,
  request,
  generatedAt,
}: {
  document: MediaWikiDocument;
  section: MediaWikiDocumentSection;
  block: Extract<
    MediaWikiDocumentSection["blocks"][number],
    { kind: "extension" }
  >;
  request: ArticleContextRequest;
  generatedAt: string;
}) => {
  if (block.extension.kind !== "easy-timeline") return null;
  const numericFormat = block.extension.dateFormat;
  const events: ContextTimelineEvent[] = block.extension.entries.flatMap(
    (entry, index) => {
      const start = parseContextDateRange(entry.from, { numericFormat });
      const explicitEnd = entry.to
        ? parseContextDateRange(entry.to, { numericFormat })
        : null;
      if (!start) return [];
      return [
        {
          id: `timeline-event-${index + 1}`,
          label: entry.label,
          start: start.start,
          ...(explicitEnd?.start
            ? { end: explicitEnd.start }
            : start.end
              ? { end: start.end }
              : {}),
          ...(entry.category ? { category: entry.category } : {}),
        },
      ];
    },
  );
  return createTimelineCandidate({
    events,
    request,
    sourceHash: document.documentHash,
    generatedAt,
    section: contextSection(section),
    position: block.sourceOrder,
    priority: 90,
    sourceIdentity: `semantic-easy-timeline:${block.contentHash}`,
  });
};

const candidateFromBlock = ({
  document,
  section,
  block,
  request,
  generatedAt,
}: {
  document: MediaWikiDocument;
  section: MediaWikiDocumentSection;
  block: MediaWikiBlock;
  request: ArticleContextRequest;
  generatedAt: string;
}): BlockCandidate | null => {
  if (block.kind === "table") {
    return tableCandidate({ document, section, block, request, generatedAt });
  }
  if (block.kind === "figure") {
    return createDiagramCandidateFromFigure({
      caption: block.caption,
      legend: block.legend,
      media: block.media,
      regions: block.regions,
      request,
      sourceHash: document.documentHash,
      generatedAt,
      section: contextSection(section),
      position: block.sourceOrder,
      sourceIdentity: `semantic-figure:${block.contentHash}`,
    });
  }
  if (block.kind !== "extension") return null;

  switch (block.extension.kind) {
    case "chart":
      return createChartCandidateFromSpec({
        spec: block.extension.spec,
        context: proseBefore(section, block.sourceOrder),
        request,
        sourceHash: document.documentHash,
        generatedAt,
        section: contextSection(section),
        position: block.sourceOrder,
        sourceIdentity: `semantic-chart:${block.contentHash}`,
      });
    case "kartographer": {
      const { geoJson, label, latitude, longitude, presentation, zoom } =
        block.extension;
      if (
        !geoJson &&
        !(
          presentation === "maplink" &&
          label &&
          latitude != null &&
          longitude != null
        )
      ) {
        return null;
      }
      return createMapCandidateFromGeoJson({
        value: geoJson ?? {
          type: "Feature",
          properties: { name: label },
          geometry: {
            type: "Point",
            coordinates: [longitude, latitude],
          },
        },
        fallbackName: section.title || request.title,
        suggestedZoom: zoom,
        request,
        sourceHash: document.documentHash,
        generatedAt,
        section: contextSection(section),
        position: block.sourceOrder,
        sourceIdentity: `semantic-kartographer:${block.contentHash}`,
      });
    }
    case "osm-location-map":
      return block.extension.markers.length === 0
        ? null
        : createMapCandidateFromGeoJson({
            value: {
              type: "FeatureCollection",
              features: block.extension.markers.map((marker) => ({
                type: "Feature",
                properties: {
                  name: marker.title,
                  ...(marker.description
                    ? { description: marker.description }
                    : {}),
                },
                geometry: {
                  type: "Point",
                  coordinates: [marker.longitude, marker.latitude],
                },
              })),
            },
            fallbackName: section.title || request.title,
            suggestedZoom: block.extension.zoom,
            request,
            sourceHash: document.documentHash,
            generatedAt,
            section: contextSection(section),
            position: block.sourceOrder,
            sourceIdentity: `semantic-osm-location-map:${block.contentHash}`,
          });
    case "easy-timeline":
      return easyTimelineCandidate({
        document,
        section,
        block,
        request,
        generatedAt,
      });
  }
};

const selectDocumentCandidates = (
  candidates: BlockCandidate[],
): ContextBlock[] => {
  const selected = new Map<string, BlockCandidate>();
  for (const candidate of candidates) {
    const key = `${candidate.block.section.index}\u0000${candidate.block.kind}`;
    const existing = selected.get(key);
    if (
      !existing ||
      candidate.priority > existing.priority ||
      (candidate.priority === existing.priority &&
        (candidate.position < existing.position ||
          (candidate.position === existing.position &&
            candidate.block.id.localeCompare(existing.block.id) < 0)))
    ) {
      selected.set(key, candidate);
    }
  }
  return [...selected.values()]
    .sort(
      (left, right) =>
        left.position - right.position ||
        right.priority - left.priority ||
        left.block.id.localeCompare(right.block.id),
    )
    .slice(0, MAX_BLOCKS_PER_ARTICLE)
    .map((candidate, order) => ({ ...candidate.block, order }));
};

export const extractArticleContextFromDocument = (
  document: MediaWikiDocument,
  options: ArticleContextDocumentOptions = {},
): ContextManifest => {
  const generatedAt = (options.now?.() ?? new Date()).toISOString();
  const request: ArticleContextRequest = { ...document.identity };
  const candidates = document.sections.flatMap((section) => {
    if (section.role !== "body") return [];
    return section.blocks.flatMap((block) => {
      const candidate = candidateFromBlock({
        document,
        section,
        block,
        request,
        generatedAt,
      });
      return candidate ? [candidate] : [];
    });
  });

  const blocks = selectDocumentCandidates(candidates);
  const manifest: ContextManifest = {
    schemaVersion: ARTICLE_CONTEXT_SCHEMA_VERSION,
    wikiPageId: document.identity.wikiPageId,
    title: document.identity.title,
    revisionId: document.identity.revisionId,
    language: document.identity.language,
    sourceHash: document.documentHash,
    extractorVersion: ARTICLE_CONTEXT_EXTRACTOR_VERSION,
    generatedAt,
    blocks,
  };
  const errors = validateContextManifest(manifest);
  if (errors.length > 0) {
    throw new Error(`Article context validation failed: ${errors.join("; ")}`);
  }
  return manifest;
};
