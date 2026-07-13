/**
 * Stable, serializable contracts for article context blocks.
 *
 * A context block always carries a complete semantic representation. Visual
 * renderers are progressive enhancement; clients must not need to inspect
 * Wikipedia HTML, SVG, GeoJSON, or chart-library options.
 */

export const ARTICLE_CONTEXT_SCHEMA_VERSION = 1 as const;
export const ARTICLE_CONTEXT_EXTRACTOR_VERSION = "1.0.2";

export type ContextBlockKind = "map" | "timeline" | "chart" | "diagram";

export type ContextSource = {
  label: string;
  url: string;
  revisionId?: string;
  license?: string;
  accessedAt: string;
};

export type ContextSection = {
  /** MediaWiki parse section index, or `__summary__` for the article lead. */
  index: string;
  title: string;
  /** MediaWiki's stable-in-this-revision heading anchor when available. */
  anchor?: string;
};

export type ContextProvenance = {
  articleUrl: string;
  articleRevisionUrl: string;
  sourceHash: string;
  extractorVersion: string;
  descriptionMethod: "deterministic" | "ai-assisted";
  model?: string;
  promptVersion?: string;
  editorialOverride?: {
    kind: "owner-accessibility-copy";
    updatedAt: string;
  };
};

export type ContextBlockBase = {
  id: string;
  kind: ContextBlockKind;
  title: string;
  takeaway: string;
  /** Short, abbreviation-expanded copy suitable for the main audio queue. */
  spokenSummary: string;
  /** Visible structured prose that stands alone without the visual view. */
  longDescription: string;
  section: ContextSection;
  /** Stable display position within the article revision. */
  order: number;
  sources: ContextSource[];
  provenance: ContextProvenance;
};

export type ContextCoordinate = {
  latitude: number;
  longitude: number;
};

export type ContextMapPlace = ContextCoordinate & {
  id: string;
  name: string;
  description?: string;
};

export type ContextMapRoutePoint = ContextCoordinate & {
  label?: string;
};

export type ContextMapRoute = {
  id: string;
  name: string;
  description?: string;
  points: ContextMapRoutePoint[];
};

export type ContextMapArea = {
  id: string;
  name: string;
  description?: string;
  /** Closed polygon rings in longitude-independent latitude/longitude form. */
  rings: ContextCoordinate[][];
};

export type ContextMapBlock = ContextBlockBase & {
  kind: "map";
  map: {
    center: ContextCoordinate;
    suggestedZoom?: number;
    places: ContextMapPlace[];
    routes: ContextMapRoute[];
    areas: ContextMapArea[];
  };
};

export type ContextDateValue = {
  /** Human-readable source date, retained when an ISO value is unavailable. */
  display: string;
  /** ISO 8601 date or year for precise Common Era values. */
  iso?: string;
  /** Numeric chronology key; negative years represent BCE dates. */
  sortKey: number;
  precision: "day" | "month" | "year" | "range" | "circa" | "unknown";
};

export type ContextTimelineEvent = {
  id: string;
  label: string;
  start: ContextDateValue;
  end?: ContextDateValue;
  description?: string;
  category?: string;
};

export type ContextTimelineBlock = ContextBlockBase & {
  kind: "timeline";
  timeline: {
    chronological: boolean;
    events: ContextTimelineEvent[];
  };
};

export type ContextChartCell = string | number | null;

export type ContextChartColumn = {
  key: string;
  label: string;
  dataType: "string" | "number";
  unit?: string;
};

export type ContextChartSeries = {
  id: string;
  label: string;
  type: "line" | "area" | "bar" | "pie";
  xColumn: string;
  yColumn: string;
  unit?: string;
};

export type ContextChartBlock = ContextBlockBase & {
  kind: "chart";
  chart: {
    columns: ContextChartColumn[];
    rows: Record<string, ContextChartCell>[];
    series: ContextChartSeries[];
    sourceChartType: "chart-extension" | "wikitable";
  };
};

export type ContextDiagramPart = {
  id: string;
  label: string;
  description?: string;
};

export type ContextDiagramRelationship = {
  fromId: string;
  toId: string;
  label: string;
};

export type ContextDiagramBlock = ContextBlockBase & {
  kind: "diagram";
  diagram: {
    image: {
      src: string;
      originalSrc?: string;
      alt: string;
      width?: number;
      height?: number;
    };
    parts: ContextDiagramPart[];
    relationships: ContextDiagramRelationship[];
    walkthrough: string[];
    caption: string;
  };
};

export type ContextBlock =
  | ContextMapBlock
  | ContextTimelineBlock
  | ContextChartBlock
  | ContextDiagramBlock;

export type ContextManifest = {
  schemaVersion: typeof ARTICLE_CONTEXT_SCHEMA_VERSION;
  wikiPageId: string;
  title: string;
  revisionId: string;
  language: string;
  sourceHash: string;
  extractorVersion: string;
  generatedAt: string;
  blocks: ContextBlock[];
};

export type ArticleContextRequest = {
  wikiPageId: string;
  title: string;
  revisionId: string;
  language?: string;
};

export type ArticleContextApiResponse = {
  context: ContextManifest;
  cacheStatus: "hit" | "miss";
};

export type ArticleContextDownloadFormat = "json" | "csv";
