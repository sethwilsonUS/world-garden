export const MEDIAWIKI_DOCUMENT_SCHEMA_VERSION = 1 as const;

export { normalizeMediaWikiNumericId } from "../wikipedia-utils";

export type MediaWikiRevisionIdentity = Readonly<{
  wikiPageId: string;
  title: string;
  revisionId: string;
  language: string;
}>;

/** Backward-compatible name used by the first implementation slice. */
export type MediaWikiRevisionRequest = MediaWikiRevisionIdentity;

export type MediaWikiPlaintextSection = Readonly<{
  index: string;
  title: string;
  level: number;
  text: string;
}>;

export type MediaWikiDocumentRequest = MediaWikiRevisionRequest &
  Readonly<{
    plaintext?: Readonly<{
      lead: string;
      sections: readonly MediaWikiPlaintextSection[];
    }>;
  }>;

export type MediaWikiDocumentSourceFormat = "parsoid" | "legacy" | "plaintext";

export type MediaWikiFallbackReason =
  | "html-unavailable"
  | "document-limit"
  | "section-alignment-failed"
  | "unsupported-html-contract";

export type MediaWikiDocumentIssueCode =
  | "parse-fallback"
  | "parse-recovery"
  | "unmatched-section"
  | "unsupported-block"
  | "malformed-table"
  | "ambiguous-table-headers"
  | "nested-table"
  | "invalid-table-span"
  | "table-grid-collision"
  | "table-grid-hole"
  | "invalid-data-mw"
  | "unversioned-external-data"
  | "unsupported-extension"
  | "payload-limit"
  | "node-limit"
  | "depth-limit";

export type MediaWikiDocumentIssue = Readonly<{
  code: MediaWikiDocumentIssueCode;
  severity: "fallback" | "skipped";
  sectionKey?: string;
  sourceOrder?: number;
}>;

export type MediaWikiDocument = Readonly<{
  schemaVersion: typeof MEDIAWIKI_DOCUMENT_SCHEMA_VERSION;
  identity: MediaWikiRevisionRequest;
  sourceFormat: MediaWikiDocumentSourceFormat;
  fallbackReason?: MediaWikiFallbackReason;
  sourceHash: string;
  documentHash: string;
  sections: readonly MediaWikiDocumentSection[];
  citations: readonly MediaWikiCitation[];
  issues: readonly MediaWikiDocumentIssue[];
}>;

export type MediaWikiSectionRole = "body" | "end-matter";
export type MediaWikiSectionFidelity = "complete" | "partial" | "plaintext";

export type MediaWikiSectionSourceFragment = Readonly<{
  key: string;
  sourceSectionIndex: string;
}>;

export type MediaWikiDocumentSection = Readonly<{
  key: "__summary__" | string;
  /** Exact, potentially repeatable `data-mw-section-id` from Parsoid. */
  sourceSectionIndex?: string;
  /** The tocdata entry associated with a headed Parsoid section. */
  tocIndex?: string;
  /** Repeatable Parsoid wrappers merged into this logical source section. */
  sourceFragments?: readonly MediaWikiSectionSourceFragment[];
  title: string;
  level: number;
  sourceOrder: number;
  parentKey?: string;
  anchor?: string;
  role: MediaWikiSectionRole;
  fidelity: MediaWikiSectionFidelity;
  /** MediaWiki TextExtracts content retained for legacy/UI compatibility. */
  plaintextContent: string;
  /** Complete best-effort source text used when semantic adaptation declines. */
  fallback: Readonly<{
    text: string;
    source: "dom-text" | "mediawiki-plaintext";
  }>;
  blocks: readonly MediaWikiBlock[];
  links: readonly MediaWikiArticleLink[];
  citationIds: readonly string[];
}>;

export type MediaWikiBlockBase = Readonly<{
  id: string;
  sourceOrder: number;
  contentHash: string;
}>;

export type MediaWikiBlock =
  | MediaWikiTextBlock
  | MediaWikiListBlock
  | MediaWikiTableBlock
  | MediaWikiFigureBlock
  | MediaWikiExtensionBlock
  | MediaWikiUnsupportedBlock;

export type MediaWikiTextBlock = MediaWikiBlockBase &
  Readonly<{
    kind: "prose";
    role: "paragraph" | "blockquote";
    text: string;
  }>;

export type MediaWikiList = Readonly<{
  style: "ordered" | "unordered" | "description";
  start?: number;
  items: readonly MediaWikiListItem[];
}>;

export type MediaWikiListItemPart =
  | Readonly<{
      kind: "text";
      text: string;
      sourceOrder: number;
    }>
  | Readonly<{
      kind: "list";
      list: MediaWikiList;
      sourceOrder: number;
    }>;

export type MediaWikiListItem = Readonly<{
  sourceOrdinal: number;
  parts: readonly MediaWikiListItemPart[];
}>;

export type MediaWikiListBlock = MediaWikiBlockBase &
  Readonly<{
    kind: "list";
    list: MediaWikiList;
  }>;

export type MediaWikiTableScope =
  | "row"
  | "column"
  | "row-group"
  | "column-group";

export type MediaWikiTableCell = Readonly<{
  id: string;
  kind: "header" | "data";
  text: string;
  originRow: number;
  originColumn: number;
  rowSpan: number;
  columnSpan: number;
  rowGroup: number;
  columnGroup?: number;
  scope?: MediaWikiTableScope;
  explicitHeaderIds: readonly string[];
  associatedHeaderCellIds: readonly string[];
  headerPath: readonly string[];
}>;

export type NormalizedMediaWikiTable = Readonly<{
  caption: string;
  rowCount: number;
  columnCount: number;
  cells: readonly MediaWikiTableCell[];
  /** Cell IDs occupying each rectangular grid slot. */
  grid: readonly (readonly string[])[];
}>;

export type MediaWikiTableBlock = MediaWikiBlockBase &
  Readonly<{
    kind: "table";
    table: NormalizedMediaWikiTable;
  }>;

export type MediaWikiMediaResource = Readonly<{
  kind: "image" | "video";
  src: string;
  posterSrc?: string;
  resourceTitle?: string;
  alt: string;
  width?: number;
  height?: number;
}>;

export type MediaWikiFigureLegend = Readonly<{
  description: string;
  entries: readonly Readonly<{
    color: string;
    text: string;
  }>[];
  notes: readonly string[];
}>;

export type MediaWikiFigureBlock = MediaWikiBlockBase &
  Readonly<{
    kind: "figure";
    caption: string;
    legend?: MediaWikiFigureLegend;
    media: readonly MediaWikiMediaResource[];
    regions: readonly Readonly<{
      label: string;
      description?: string;
    }>[];
  }>;

export type JsonPrimitive = string | number | boolean | null;
export type JsonValue =
  | JsonPrimitive
  | readonly JsonValue[]
  | { readonly [key: string]: JsonValue };

export type MediaWikiExtensionSource =
  | Readonly<{
      kind: "chart";
      spec: JsonValue;
    }>
  | Readonly<{
      kind: "kartographer";
      presentation: "mapframe" | "maplink";
      label?: string;
      latitude?: number;
      longitude?: number;
      zoom?: number;
      geoJson?: JsonValue;
    }>
  | Readonly<{
      kind: "easy-timeline";
      dateFormat: "dmy" | "mdy" | "year";
      entries: readonly Readonly<{
        from: string;
        to: string;
        label: string;
        category?: string;
      }>[];
    }>
  | Readonly<{
      kind: "osm-location-map";
      zoom?: number;
      markers: readonly Readonly<{
        latitude: number;
        longitude: number;
        title: string;
        description?: string;
      }>[];
    }>;

export type MediaWikiExtensionBlock = MediaWikiBlockBase &
  Readonly<{
    kind: "extension";
    extension: MediaWikiExtensionSource;
  }>;

export type MediaWikiUnsupportedBlock = MediaWikiBlockBase &
  Readonly<{
    kind: "unsupported";
    sourceKind:
      | "table"
      | "list"
      | "figure"
      | "extension"
      | "preformatted"
      | "unknown";
    reason: MediaWikiDocumentIssueCode;
    affectsNarration: boolean;
  }>;

export type MediaWikiArticleLink = Readonly<{
  targetTitle: string;
  href: string;
  sourceOrder: number;
}>;

export type MediaWikiCitation = Readonly<{
  id: string;
  index: number;
  text: string;
  url?: string;
}>;

export type LoadMediaWikiDocumentOptions = Readonly<{
  fetchImpl?: typeof fetch;
  signal?: AbortSignal;
  /** Accepted for audit tooling; source offsets are never retained in the IR. */
  auditSourceLocations?: boolean;
}>;

export type MediaWikiSourceErrorCode =
  | "invalid-request"
  | "timeout"
  | "http-error"
  | "not-found"
  | "response-too-large"
  | "invalid-response"
  | "identity-mismatch";

export class MediaWikiSourceError extends Error {
  readonly code: MediaWikiSourceErrorCode;
  readonly retryable: boolean;
  readonly statusCode: number;

  constructor({
    code,
    message,
    retryable = false,
    statusCode = 502,
  }: {
    code: MediaWikiSourceErrorCode;
    message: string;
    retryable?: boolean;
    statusCode?: number;
  }) {
    super(message);
    this.name = "MediaWikiSourceError";
    this.code = code;
    this.retryable = retryable;
    this.statusCode = statusCode;
  }
}
