import { parse, parseFragment, type DefaultTreeAdapterTypes } from "parse5";
import { createMediaWikiSpecialSectionKey } from "../mediawiki-section-key";
import { normalizeSafeCssColor } from "../safe-css-color";
import {
  MEDIAWIKI_DOCUMENT_SCHEMA_VERSION,
  MediaWikiSourceError,
  normalizeMediaWikiNumericId,
  type JsonValue,
  type LoadMediaWikiDocumentOptions,
  type MediaWikiArticleLink,
  type MediaWikiBlock,
  type MediaWikiCitation,
  type MediaWikiDocument,
  type MediaWikiDocumentRequest,
  type MediaWikiDocumentIssue,
  type MediaWikiDocumentIssueCode,
  type MediaWikiDocumentSection,
  type MediaWikiExtensionSource,
  type MediaWikiFigureLegend,
  type MediaWikiList,
  type MediaWikiListItem,
  type MediaWikiListItemPart,
  type MediaWikiMediaResource,
  type MediaWikiRevisionRequest,
  type MediaWikiSectionRole,
  type MediaWikiTableCell,
  type MediaWikiTableScope,
  type NormalizedMediaWikiTable,
} from "./types";

export * from "./types";

const WIKIPEDIA_API_PATH = "/w/api.php";
const USER_AGENT =
  "CurioGarden/1.0 (https://curiogarden.org; accessibility-first Wikipedia reader)";
const FETCH_TIMEOUT_MS = 25_000;
const MAX_RESPONSE_BYTES = 15 * 1024 * 1024;
const MAX_TABLE_ROWS = 2_000;
const MAX_TABLE_COLUMNS = 128;
const MAX_EXPANDED_TABLE_CELLS = 100_000;
const MAX_EMBEDDED_JSON_BYTES = 750 * 1024;
const MAX_EMBEDDED_JSON_NODES = 50_000;
const MAX_EMBEDDED_JSON_DEPTH = 64;
const MAX_MAP_COORDINATES = 50_000;
const MAX_MAP_JSON_DEPTH = 8;
const MAX_DOM_NODES = 500_000;
const MAX_DOM_DEPTH = 128;
const MIN_NESTED_MEDIA_DIMENSION = 100;
const MAX_FIGURE_LEGEND_ENTRIES = 32;
const MAX_FIGURE_LEGEND_COLOR_LENGTH = 128;
const MAX_FIGURE_LEGEND_DESCRIPTION_TEXT_LENGTH = 800;
const MAX_FIGURE_LEGEND_ENTRY_TEXT_LENGTH = 500;
const MAX_FIGURE_LEGEND_NOTES = 8;
const MAX_FIGURE_LEGEND_NOTE_TEXT_LENGTH = 2_000;
const MAX_FIGURE_LEGEND_TOTAL_TEXT_LENGTH = 12_000;

const HEADING_TAGS = new Set(["h1", "h2", "h3", "h4", "h5", "h6"]);
const ARTICLE_SECTION_HEADING_TAGS = new Set(["h2", "h3", "h4", "h5", "h6"]);

const END_MATTER_TITLES = new Set([
  "see also",
  "references",
  "external links",
  "notes",
  "further reading",
  "bibliography",
  "sources",
  "citations",
  "footnotes",
]);

type Node = DefaultTreeAdapterTypes.Node;
type ParentNode = DefaultTreeAdapterTypes.ParentNode;
type Element = DefaultTreeAdapterTypes.Element;

type TocEntry = {
  index: string;
  line: string;
  anchor?: string;
  level: number;
};

type ParsedSource = {
  html: string;
  toc: TocEntry[];
  format: "parsoid" | "legacy";
};

class ParsoidRejectedError extends Error {}

const throwIfAborted = (signal?: AbortSignal): void => {
  if (!signal?.aborted) return;
  throw (
    signal.reason ??
    new DOMException("The MediaWiki request was aborted", "AbortError")
  );
};

const isSourceRecoveryError = (error: { code: string }): boolean => {
  // MediaWiki returns an HTML body fragment rather than a complete document.
  // parse5 correctly notes the absent doctype, but that is not source recovery.
  return error.code !== "missing-doctype";
};

const isRecord = (value: unknown): value is Record<string, unknown> =>
  Boolean(value) && typeof value === "object" && !Array.isArray(value);

const normalizeTitle = (value: string): string =>
  value.replace(/_/g, " ").replace(/\s+/g, " ").trim().toLocaleLowerCase();

const normalizeText = (value: string): string =>
  value
    .replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/g, " ")
    .replace(/\s+/g, " ")
    .replace(/\s+([,.;:!?])/g, "$1")
    .trim();

const deterministicHash = (value: string): string => {
  let first = 0x811c9dc5;
  let second = 0x9e3779b9;
  for (let index = 0; index < value.length; index += 1) {
    const code = value.charCodeAt(index);
    first = Math.imul(first ^ code, 0x01000193);
    second = Math.imul(second ^ code, 0x85ebca6b);
    second ^= second >>> 13;
  }
  return `mediawiki-document:${MEDIAWIKI_DOCUMENT_SCHEMA_VERSION}:${(
    first >>> 0
  )
    .toString(16)
    .padStart(
      8,
      "0",
    )}${(second >>> 0).toString(16).padStart(8, "0")}:${value.length.toString(16)}`;
};

const isElement = (node: Node): node is Element => "tagName" in node;

const childNodes = (node: Node | ParentNode): Node[] =>
  "childNodes" in node ? (node.childNodes as Node[]) : [];

const attribute = (element: Element, name: string): string | undefined =>
  element.attrs.find((candidate) => candidate.name === name)?.value;

const classTokens = (element: Element): Set<string> =>
  new Set((attribute(element, "class") ?? "").split(/\s+/).filter(Boolean));

const hasRelToken = (element: Element, token: string): boolean =>
  (attribute(element, "rel") ?? "").split(/\s+/).includes(token);

const hasTypeToken = (element: Element, token: string): boolean =>
  (attribute(element, "typeof") ?? "").split(/\s+/).includes(token);

const isHeadingTag = (tagName: string): boolean => HEADING_TAGS.has(tagName);

const isDecimalToken = (value: string): boolean =>
  value.length > 0 &&
  value.length <= 16 &&
  [...value].every((character) => character >= "0" && character <= "9");

const isParsoidSectionSourceIndex = (value: string): boolean =>
  value === "-1" || value === "-2" || isDecimalToken(value);

const shouldSkipText = (element: Element): boolean => {
  if (["script", "style", "template", "noscript"].includes(element.tagName)) {
    return true;
  }
  const classes = classTokens(element);
  return (
    classes.has("mw-editsection") ||
    classes.has("reference") ||
    classes.has("mw-cite-backlink") ||
    classes.has("navbar") ||
    classes.has("navigation-not-searchable") ||
    hasTypeToken(element, "mw:Extension/ref")
  );
};

const textContent = (
  root: Node,
  options: {
    excludeNestedLists?: boolean;
    excludeNestedSections?: boolean;
  } = {},
): string => {
  const parts: string[] = [];
  const visit = (node: Node, isRoot = false) => {
    if (node.nodeName === "#text" && "value" in node) {
      parts.push(node.value);
      return;
    }
    if (!isElement(node)) {
      childNodes(node).forEach((child) => visit(child));
      return;
    }
    if (
      !isRoot &&
      options.excludeNestedSections &&
      node.tagName === "section"
    ) {
      return;
    }
    if (
      !isRoot &&
      options.excludeNestedLists &&
      ["ol", "ul", "dl"].includes(node.tagName)
    ) {
      return;
    }
    if (shouldSkipText(node)) return;
    childNodes(node).forEach((child) => visit(child));
  };
  visit(root, true);
  return normalizeText(parts.join(" "));
};

const allElements = (root: Node | ParentNode): Element[] => {
  const result: Element[] = [];
  const visit = (node: Node) => {
    if (isElement(node)) result.push(node);
    childNodes(node).forEach(visit);
  };
  childNodes(root).forEach(visit);
  return result;
};

const nodeOrders = (root: Node | ParentNode): Map<Node, number> => {
  const result = new Map<Node, number>();
  let order = 0;
  const visit = (node: Node) => {
    result.set(node, order);
    order += 1;
    childNodes(node).forEach(visit);
  };
  childNodes(root).forEach(visit);
  return result;
};

const domLimitIssue = (
  root: ParentNode,
): "node-limit" | "depth-limit" | null => {
  const stack = childNodes(root).map((node) => ({ node, depth: 1 }));
  let nodes = 0;
  while (stack.length > 0) {
    const current = stack.pop()!;
    nodes += 1;
    if (nodes > MAX_DOM_NODES) return "node-limit";
    if (current.depth > MAX_DOM_DEPTH) return "depth-limit";
    for (const child of childNodes(current.node)) {
      stack.push({ node: child, depth: current.depth + 1 });
    }
  }
  return null;
};

type ParsedList = {
  list: MediaWikiList;
  unsupportedSourceOrder?: number;
};

type ParsedExtensionResult =
  | { extension: MediaWikiExtensionSource }
  | { reason: MediaWikiDocumentIssueCode }
  | null;

type ExtensionParseCache = WeakMap<Element, ParsedExtensionResult>;

const parseList = (
  element: Element,
  orders: Map<Node, number>,
  extensionCache: ExtensionParseCache,
): ParsedList => {
  const style: MediaWikiList["style"] =
    element.tagName === "ol"
      ? "ordered"
      : element.tagName === "dl"
        ? "description"
        : "unordered";
  const startValue = Number(attribute(element, "start"));
  const start =
    style === "ordered" && Number.isSafeInteger(startValue)
      ? startValue
      : undefined;

  const itemElements = childNodes(element).filter(
    (node): node is Element =>
      isElement(node) &&
      (element.tagName === "dl"
        ? node.tagName === "dt" || node.tagName === "dd"
        : node.tagName === "li"),
  );
  let unsupportedSourceOrder: number | undefined;
  const markUnsupported = (node: Node) => {
    const sourceOrder = orders.get(node) ?? orders.get(element) ?? 0;
    unsupportedSourceOrder =
      unsupportedSourceOrder == null
        ? sourceOrder
        : Math.min(unsupportedSourceOrder, sourceOrder);
  };
  const itemParts = (item: Element): MediaWikiListItemPart[] => {
    const parts: MediaWikiListItemPart[] = [];
    let textParts: string[] = [];
    let textOrder = orders.get(item) ?? 0;
    const flushText = () => {
      const text = normalizeText(textParts.join(" "));
      textParts = [];
      if (!text) return;
      parts.push({ kind: "text", text, sourceOrder: textOrder });
    };
    const visit = (node: Node) => {
      if (node.nodeName === "#text" && "value" in node) {
        if (textParts.length === 0) textOrder = orders.get(node) ?? textOrder;
        textParts.push(node.value);
        return;
      }
      if (!isElement(node)) {
        childNodes(node).forEach(visit);
        return;
      }
      if (["ol", "ul", "dl"].includes(node.tagName)) {
        flushText();
        const nested = parseList(node, orders, extensionCache);
        if (nested.unsupportedSourceOrder != null) {
          markUnsupported(node);
          unsupportedSourceOrder = Math.min(
            unsupportedSourceOrder ?? nested.unsupportedSourceOrder,
            nested.unsupportedSourceOrder,
          );
        }
        parts.push({
          kind: "list",
          list: nested.list,
          sourceOrder: orders.get(node) ?? 0,
        });
        return;
      }
      if (shouldSkipText(node)) return;
      const extensionName = extensionNameFromType(node);
      if (extensionName && NON_NARRATIVE_EXTENSION_NAMES.has(extensionName)) {
        return;
      }
      const embeddedSource = isEmbeddedSourceCandidate(node)
        ? parseExtension(node, extensionCache)
        : null;
      if (
        node.tagName === "table" ||
        node.tagName === "pre" ||
        isFigureElement(node) ||
        embeddedSource != null
      ) {
        flushText();
        markUnsupported(node);
        return;
      }
      childNodes(node).forEach(visit);
    };
    childNodes(item).forEach(visit);
    flushText();
    return parts.sort((left, right) => left.sourceOrder - right.sourceOrder);
  };

  const items: MediaWikiListItem[] = itemElements.flatMap((item) => {
    const parts = itemParts(item);
    return parts.length > 0
      ? [{ sourceOrdinal: orders.get(item) ?? 0, parts }]
      : [];
  });

  return {
    list: {
      style,
      ...(start != null ? { start } : {}),
      items,
    },
    ...(unsupportedSourceOrder != null ? { unsupportedSourceOrder } : {}),
  };
};

const makeBlockBase = (
  sectionKey: string,
  kind: string,
  sourceOrder: number,
  content: unknown,
) => {
  const contentHash = deterministicHash(JSON.stringify(content));
  return {
    id: `${sectionKey}:${kind}:${sourceOrder}:${contentHash.slice(-12)}`,
    sourceOrder,
    contentHash,
  };
};

type ParsedTableResult =
  | { table: NormalizedMediaWikiTable }
  | { reason: MediaWikiDocumentIssueCode };

type TableRow = {
  element: Element;
  rowGroup: number;
};

type MutableTableCell = {
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
  rawHeaderIds: string[];
  explicitHeaderIds: string[];
  associatedHeaderCellIds: string[];
  headerPath: string[];
};

const directElementChildren = (node: Node | ParentNode): Element[] =>
  childNodes(node).filter(isElement);

const normalizedTableScope = (
  value: string | undefined,
): MediaWikiTableScope | undefined => {
  switch (value?.trim().toLocaleLowerCase()) {
    case "row":
      return "row";
    case "col":
      return "column";
    case "rowgroup":
      return "row-group";
    case "colgroup":
      return "column-group";
    default:
      return undefined;
  }
};

const parseTableSpan = (
  value: string | undefined,
  allowZero: boolean,
): number | null => {
  if (value == null || value.trim() === "") return 1;
  const span = Number(value);
  if (!Number.isSafeInteger(span) || span < 0 || (!allowZero && span === 0)) {
    return null;
  }
  return span;
};

const tableRows = (table: Element): TableRow[] => {
  const rows: TableRow[] = [];
  let rowGroup = 0;
  for (const child of directElementChildren(table)) {
    if (child.tagName === "tr") {
      rows.push({ element: child, rowGroup });
      continue;
    }
    if (!["thead", "tbody", "tfoot"].includes(child.tagName)) continue;
    rowGroup += 1;
    directElementChildren(child)
      .filter((candidate) => candidate.tagName === "tr")
      .forEach((element) => rows.push({ element, rowGroup }));
    rowGroup += 1;
  }
  return rows;
};

const tableColumnGroups = (table: Element): number[] => {
  const groups: number[] = [];
  let group = 0;
  for (const colgroup of directElementChildren(table).filter(
    (element) => element.tagName === "colgroup",
  )) {
    const columns = directElementChildren(colgroup).filter(
      (element) => element.tagName === "col",
    );
    if (columns.length === 0) {
      const span = parseTableSpan(attribute(colgroup, "span"), false);
      if (span != null)
        groups.push(...Array.from({ length: span }, () => group));
    } else {
      for (const column of columns) {
        const span = parseTableSpan(attribute(column, "span"), false);
        if (span != null)
          groups.push(...Array.from({ length: span }, () => group));
      }
    }
    group += 1;
  }
  return groups;
};

const cellsShareColumn = (
  left: MutableTableCell,
  right: MutableTableCell,
): boolean => {
  const leftEnd = left.originColumn + left.columnSpan;
  const rightEnd = right.originColumn + right.columnSpan;
  return left.originColumn < rightEnd && right.originColumn < leftEnd;
};

const tableHeaderAssociations = (
  cells: MutableTableCell[],
  rawIdToCellId: Map<string, string>,
): MediaWikiDocumentIssueCode | null => {
  const cellsById = new Map(cells.map((cell) => [cell.id, cell]));
  const headers = cells.filter((cell) => cell.kind === "header");
  for (const cell of cells) {
    cell.explicitHeaderIds = cell.rawHeaderIds.flatMap((rawId) => {
      const resolved = rawIdToCellId.get(rawId);
      return resolved ? [resolved] : [];
    });
    if (cell.explicitHeaderIds.length !== cell.rawHeaderIds.length) {
      return "ambiguous-table-headers";
    }
    if (
      cell.explicitHeaderIds.some((id) => cellsById.get(id)?.kind !== "header")
    ) {
      return "ambiguous-table-headers";
    }
  }

  const expansionCache = new Map<string, MutableTableCell[]>();
  const expanding = new Set<string>();
  const expandHeader = (
    header: MutableTableCell,
  ): MutableTableCell[] | null => {
    const cached = expansionCache.get(header.id);
    if (cached) return cached;
    if (expanding.has(header.id)) return null;
    expanding.add(header.id);
    const expanded: MutableTableCell[] = [];
    for (const parentId of header.explicitHeaderIds) {
      const parent = cellsById.get(parentId);
      if (!parent || parent.kind !== "header") return null;
      const ancestors = expandHeader(parent);
      if (!ancestors) return null;
      expanded.push(...ancestors);
    }
    expanded.push(header);
    const unique = expanded.filter(
      (candidate, index, list) =>
        list.findIndex((other) => other.id === candidate.id) === index,
    );
    expanding.delete(header.id);
    expansionCache.set(header.id, unique);
    return unique;
  };

  for (const header of headers) {
    const expanded = expandHeader(header);
    if (!expanded) return "ambiguous-table-headers";
    const ancestors = expanded.filter(
      (candidate) => candidate.id !== header.id,
    );
    header.associatedHeaderCellIds = ancestors.map((candidate) => candidate.id);
    header.headerPath = ancestors.map((candidate) => candidate.text);
  }

  for (const cell of cells) {
    if (cell.kind === "header") continue;

    let associated: MutableTableCell[];
    if (cell.explicitHeaderIds.length > 0) {
      const direct = cell.explicitHeaderIds.flatMap((id) => {
        const header = cellsById.get(id);
        return header?.kind === "header" ? [header] : [];
      });
      if (direct.length !== cell.explicitHeaderIds.length) {
        return "ambiguous-table-headers";
      }
      associated = direct.flatMap((header) => expandHeader(header) ?? []);
    } else {
      const columnGroups = headers.filter(
        (header) =>
          header.scope === "column-group" &&
          header.originRow <= cell.originRow &&
          cellsShareColumn(header, cell),
      );
      const columns = headers.filter(
        (header) =>
          (header.scope === "column" ||
            (!header.scope && header.originRow < cell.originRow)) &&
          header.originRow <= cell.originRow &&
          cellsShareColumn(header, cell),
      );
      const rowGroups = headers.filter(
        (header) =>
          header.scope === "row-group" && header.rowGroup === cell.rowGroup,
      );
      const rows = headers.filter(
        (header) =>
          (header.scope === "row" ||
            (!header.scope && header.originRow === cell.originRow)) &&
          header.originRow === cell.originRow &&
          header.originColumn < cell.originColumn,
      );
      associated = [...columnGroups, ...columns, ...rowGroups, ...rows]
        .sort((left, right) => {
          const category = (candidate: MutableTableCell): number =>
            candidate.scope === "column-group"
              ? 0
              : candidate.scope === "column" ||
                  (!candidate.scope && candidate.originRow < cell.originRow)
                ? 1
                : candidate.scope === "row-group"
                  ? 2
                  : 3;
          return (
            category(left) - category(right) ||
            left.originRow - right.originRow ||
            left.originColumn - right.originColumn
          );
        })
        .filter(
          (header, index, list) =>
            list.findIndex((candidate) => candidate.id === header.id) === index,
        )
        .flatMap((header) => expandHeader(header) ?? []);
    }
    associated = associated.filter(
      (header, index, list) =>
        list.findIndex((candidate) => candidate.id === header.id) === index,
    );
    if (associated.length === 0 || associated.some((header) => !header.text)) {
      return "ambiguous-table-headers";
    }
    cell.associatedHeaderCellIds = associated.map((header) => header.id);
    cell.headerPath = associated.map((header) => header.text);
  }
  return null;
};

const normalizeTable = (
  table: Element,
  sectionKey: string,
  orders: Map<Node, number>,
): ParsedTableResult => {
  if (
    allElements(table).some(
      (element) => element !== table && element.tagName === "table",
    )
  ) {
    return { reason: "nested-table" };
  }
  const rows = tableRows(table);
  if (rows.length === 0) return { reason: "malformed-table" };
  if (rows.length > MAX_TABLE_ROWS) return { reason: "payload-limit" };

  const groupLastRow = new Map<number, number>();
  rows.forEach((row, index) => groupLastRow.set(row.rowGroup, index));
  const columnGroups = tableColumnGroups(table);
  const grid: Array<Array<string | undefined>> = rows.map(() => []);
  const cells: MutableTableCell[] = [];
  const rawIdToCellId = new Map<string, string>();
  const tableOrder = orders.get(table) ?? 0;
  let expandedCells = 0;

  for (let rowIndex = 0; rowIndex < rows.length; rowIndex += 1) {
    const row = rows[rowIndex];
    const cellElements = directElementChildren(row.element).filter((element) =>
      ["th", "td"].includes(element.tagName),
    );
    let column = 0;
    for (const element of cellElements) {
      while (grid[rowIndex][column] != null) column += 1;
      const columnSpan = parseTableSpan(attribute(element, "colspan"), false);
      const rawRowSpan = parseTableSpan(attribute(element, "rowspan"), true);
      if (columnSpan == null || rawRowSpan == null) {
        return { reason: "invalid-table-span" };
      }
      const groupEnd = groupLastRow.get(row.rowGroup) ?? rowIndex;
      const rowSpan =
        rawRowSpan === 0
          ? groupEnd - rowIndex + 1
          : Math.min(rawRowSpan, groupEnd - rowIndex + 1);
      if (rowSpan < 1 || column + columnSpan > MAX_TABLE_COLUMNS) {
        return { reason: "payload-limit" };
      }
      expandedCells += rowSpan * columnSpan;
      if (expandedCells > MAX_EXPANDED_TABLE_CELLS) {
        return { reason: "payload-limit" };
      }
      const id = `${sectionKey}:table:${tableOrder}:cell:${rowIndex}:${column}`;
      for (
        let occupiedRow = rowIndex;
        occupiedRow < rowIndex + rowSpan;
        occupiedRow += 1
      ) {
        for (
          let occupiedColumn = column;
          occupiedColumn < column + columnSpan;
          occupiedColumn += 1
        ) {
          if (grid[occupiedRow][occupiedColumn] != null) {
            return { reason: "table-grid-collision" };
          }
          grid[occupiedRow][occupiedColumn] = id;
        }
      }
      const rawId = attribute(element, "id")?.trim();
      if (rawId) {
        if (rawIdToCellId.has(rawId)) {
          return { reason: "ambiguous-table-headers" };
        }
        rawIdToCellId.set(rawId, id);
      }
      cells.push({
        id,
        kind: element.tagName === "th" ? "header" : "data",
        text: textContent(element),
        originRow: rowIndex,
        originColumn: column,
        rowSpan,
        columnSpan,
        rowGroup: row.rowGroup,
        ...(columnGroups[column] != null
          ? { columnGroup: columnGroups[column] }
          : {}),
        ...(normalizedTableScope(attribute(element, "scope"))
          ? { scope: normalizedTableScope(attribute(element, "scope")) }
          : {}),
        rawHeaderIds: (attribute(element, "headers") ?? "")
          .split(/\s+/)
          .filter(Boolean),
        explicitHeaderIds: [],
        associatedHeaderCellIds: [],
        headerPath: [],
      });
      column += columnSpan;
    }
  }

  const columnCount = Math.max(0, ...grid.map((row) => row.length));
  if (columnCount === 0) return { reason: "malformed-table" };
  if (
    grid.some(
      (row) =>
        row.length !== columnCount ||
        Array.from({ length: columnCount }, (_, index) => row[index]).some(
          (slot) => slot == null,
        ),
    )
  ) {
    return { reason: "table-grid-hole" };
  }
  const associationError = tableHeaderAssociations(cells, rawIdToCellId);
  if (associationError) return { reason: associationError };
  const captionElement = directElementChildren(table).find(
    (element) => element.tagName === "caption",
  );
  const normalizedCells: MediaWikiTableCell[] = cells.map((cell) => ({
    id: cell.id,
    kind: cell.kind,
    text: cell.text,
    originRow: cell.originRow,
    originColumn: cell.originColumn,
    rowSpan: cell.rowSpan,
    columnSpan: cell.columnSpan,
    rowGroup: cell.rowGroup,
    ...(cell.columnGroup != null ? { columnGroup: cell.columnGroup } : {}),
    ...(cell.scope ? { scope: cell.scope } : {}),
    explicitHeaderIds: cell.explicitHeaderIds,
    associatedHeaderCellIds: cell.associatedHeaderCellIds,
    headerPath: cell.headerPath,
  }));
  return {
    table: {
      caption: captionElement ? textContent(captionElement) : "",
      rowCount: rows.length,
      columnCount,
      cells: normalizedCells,
      grid: grid.map((row) => row as string[]),
    },
  };
};

const typeTokens = (element: Element): string[] =>
  (attribute(element, "typeof") ?? "").split(/\s+/).filter(Boolean);

const isFigureElement = (element: Element): boolean =>
  element.tagName === "figure" ||
  typeTokens(element).some((token) => token.startsWith("mw:File"));

const normalizeMediaUrl = (
  value: string | undefined,
  language: string,
): string | null => {
  if (!value) return null;
  try {
    const url = new URL(value, `https://${language}.wikipedia.org/`);
    if (url.protocol !== "http:" && url.protocol !== "https:") return null;
    url.protocol = "https:";
    return url.toString();
  } catch {
    return null;
  }
};

const resourceTitle = (value: string | undefined): string | undefined => {
  if (!value) return undefined;
  let title = value;
  try {
    title = decodeURIComponent(title);
  } catch {
    // Preserve the source spelling when an invalid percent escape is present.
  }
  const wikiMarker = "/wiki/";
  const markerIndex = title.indexOf(wikiMarker);
  if (markerIndex >= 0) title = title.slice(markerIndex + wikiMarker.length);
  while (title.startsWith("./")) title = title.slice(2);
  title = title.replace(/_/g, " ").trim();
  return title || undefined;
};

const positiveDimension = (value: string | undefined): number | undefined => {
  const number = Number(value);
  return Number.isSafeInteger(number) && number > 0 ? number : undefined;
};

const safeCssColor = (value: string): string | null => {
  return normalizeSafeCssColor(value, {
    maxLength: MAX_FIGURE_LEGEND_COLOR_LENGTH,
    allowImportant: true,
  });
};

const inlineBackgroundColor = (element: Element): string | null => {
  const style = attribute(element, "style");
  if (!style) return null;
  type CascadedValue<T> = { value: T; important: boolean };
  const cascade = <T>(
    current: CascadedValue<T> | undefined,
    value: T,
    important: boolean,
  ): CascadedValue<T> =>
    current?.important && !important ? current : { value, important };
  let effectiveColor: CascadedValue<string> | undefined;
  let effectiveImage: CascadedValue<boolean> | undefined;
  for (const declaration of style.split(";")) {
    const separator = declaration.indexOf(":");
    if (separator < 0) continue;
    const property = declaration.slice(0, separator).trim().toLocaleLowerCase();
    const value = declaration.slice(separator + 1).trim();
    const important = /\s*!important\s*$/i.test(value);
    if (property === "background") {
      const color = safeCssColor(value);
      effectiveColor = cascade(effectiveColor, value, important);
      effectiveImage = cascade(effectiveImage, color == null, important);
    } else if (property === "background-color") {
      effectiveColor = cascade(effectiveColor, value, important);
    } else if (property === "background-image") {
      const image = value.replace(/\s*!important\s*$/i, "").trim();
      effectiveImage = cascade(
        effectiveImage,
        image.toLocaleLowerCase() !== "none",
        important,
      );
    }
  }
  if (effectiveImage?.value) return null;
  return safeCssColor(effectiveColor?.value ?? "");
};

type FigureLegendLine = {
  colors: (string | null)[];
  textBeforeColor: string[];
  textAfterColor: string[];
};

const FIGURE_CAPTION_BREAK_ELEMENTS = new Set([
  "br",
  "dd",
  "div",
  "dt",
  "li",
  "p",
]);

const figureLegend = (
  captionElement: Element,
): MediaWikiFigureLegend | undefined => {
  const emptyLine = (): FigureLegendLine => ({
    colors: [],
    textBeforeColor: [],
    textAfterColor: [],
  });
  const lines: FigureLegendLine[] = [emptyLine()];
  let sawSwatch = false;
  const currentLine = () => lines[lines.length - 1]!;
  const breakLine = () => {
    const current = currentLine();
    if (
      current.colors.length > 0 ||
      normalizeText(
        [...current.textBeforeColor, ...current.textAfterColor].join(" "),
      )
    ) {
      lines.push(emptyLine());
    }
  };
  const visit = (node: Node) => {
    if (node.nodeName === "#text" && "value" in node) {
      const line = currentLine();
      (line.colors.length > 0
        ? line.textAfterColor
        : line.textBeforeColor
      ).push(node.value);
      return;
    }
    if (!isElement(node)) {
      childNodes(node).forEach(visit);
      return;
    }
    if (classTokens(node).has("legend-color")) {
      sawSwatch = true;
      const nestedSwatch = allElements(node).some((candidate) =>
        classTokens(candidate).has("legend-color"),
      );
      currentLine().colors.push(
        nestedSwatch ? null : inlineBackgroundColor(node),
      );
      return;
    }
    if (shouldSkipText(node)) return;
    if (node.tagName === "br") {
      breakLine();
      return;
    }
    const isBlockBoundary = FIGURE_CAPTION_BREAK_ELEMENTS.has(node.tagName);
    if (isBlockBoundary) breakLine();
    childNodes(node).forEach(visit);
    if (isBlockBoundary) breakLine();
  };
  childNodes(captionElement).forEach(visit);
  if (!sawSwatch) return undefined;

  const entries: { color: string; text: string }[] = [];
  const notes: string[] = [];
  const descriptionParts: string[] = [];
  let totalTextLength = 0;
  let sawEntry = false;
  let sawLegendLabel = false;
  for (const line of lines) {
    const textBeforeColor = normalizeText(line.textBeforeColor.join(" "));
    const textAfterColor = normalizeText(line.textAfterColor.join(" "));
    if (line.colors.length > 0) {
      if (
        notes.length > 0 ||
        line.colors.length !== 1 ||
        !line.colors[0] ||
        entries.length >= MAX_FIGURE_LEGEND_ENTRIES
      ) {
        return undefined;
      }
      const hasLegendPrefix = /^legend\s*:\s*$/i.test(textBeforeColor);
      if (textBeforeColor && textAfterColor && !hasLegendPrefix) {
        return undefined;
      }
      const text =
        textAfterColor || textBeforeColor.replace(/^legend\s*:\s*/i, "");
      if (!text || text.length > MAX_FIGURE_LEGEND_ENTRY_TEXT_LENGTH) {
        return undefined;
      }
      totalTextLength += text.length;
      if (totalTextLength > MAX_FIGURE_LEGEND_TOTAL_TEXT_LENGTH) {
        return undefined;
      }
      entries.push({ color: line.colors[0], text });
      sawEntry = true;
      continue;
    }
    const text = normalizeText(
      [...line.textBeforeColor, ...line.textAfterColor].join(" "),
    );
    if (!text) continue;
    if (!sawEntry) {
      if (/^legend\s*:\s*$/i.test(text)) {
        sawLegendLabel = true;
        continue;
      }
      if (sawLegendLabel) return undefined;
      totalTextLength += text.length;
      if (totalTextLength > MAX_FIGURE_LEGEND_TOTAL_TEXT_LENGTH) {
        return undefined;
      }
      descriptionParts.push(text);
      continue;
    }
    const note = /^notes?\s*:\s*(.+)$/i.exec(text)?.[1]?.trim();
    if (!note) return undefined;
    if (
      notes.length >= MAX_FIGURE_LEGEND_NOTES ||
      note.length > MAX_FIGURE_LEGEND_NOTE_TEXT_LENGTH
    ) {
      return undefined;
    }
    totalTextLength += note.length;
    if (totalTextLength > MAX_FIGURE_LEGEND_TOTAL_TEXT_LENGTH) {
      return undefined;
    }
    notes.push(note);
  }
  const description = normalizeText(descriptionParts.join(" "));
  if (description.length > MAX_FIGURE_LEGEND_DESCRIPTION_TEXT_LENGTH) {
    return undefined;
  }
  return entries.length > 0
    ? {
        description,
        entries,
        notes,
      }
    : undefined;
};

const figureBlock = (
  element: Element,
  sectionKey: string,
  orders: Map<Node, number>,
  language: string,
): MediaWikiBlock | null => {
  const descendants = allElements(element);
  const media: MediaWikiMediaResource[] = [];
  for (const image of descendants.filter(
    (candidate) => candidate.tagName === "img",
  )) {
    const src = normalizeMediaUrl(attribute(image, "src"), language);
    if (!src || media.some((candidate) => candidate.src === src)) continue;
    const owner =
      image.parentNode && isElement(image.parentNode as Node)
        ? (image.parentNode as Element)
        : undefined;
    const width = positiveDimension(attribute(image, "width"));
    const height = positiveDimension(attribute(image, "height"));
    media.push({
      kind: "image",
      src,
      ...(resourceTitle(
        attribute(image, "resource") ??
          (owner
            ? (attribute(owner, "resource") ?? attribute(owner, "href"))
            : undefined),
      )
        ? {
            resourceTitle: resourceTitle(
              attribute(image, "resource") ??
                (owner
                  ? (attribute(owner, "resource") ?? attribute(owner, "href"))
                  : undefined),
            ),
          }
        : {}),
      alt: normalizeText(attribute(image, "alt") ?? ""),
      ...(width ? { width } : {}),
      ...(height ? { height } : {}),
    });
  }
  for (const video of descendants.filter(
    (candidate) => candidate.tagName === "video",
  )) {
    const source =
      attribute(video, "src") ??
      directElementChildren(video)
        .find(
          (candidate) =>
            candidate.tagName === "source" && attribute(candidate, "src"),
        )
        ?.attrs.find((candidate) => candidate.name === "src")?.value;
    const src = normalizeMediaUrl(source, language);
    if (!src || media.some((candidate) => candidate.src === src)) continue;
    const width = positiveDimension(attribute(video, "width"));
    const height = positiveDimension(attribute(video, "height"));
    const posterSrc = normalizeMediaUrl(attribute(video, "poster"), language);
    media.push({
      kind: "video",
      src,
      ...(posterSrc ? { posterSrc } : {}),
      alt: normalizeText(
        attribute(video, "aria-label") ?? attribute(video, "title") ?? "",
      ),
      ...(width ? { width } : {}),
      ...(height ? { height } : {}),
    });
  }
  if (media.length === 0) return null;
  const captionElement = descendants.find(
    (candidate) =>
      candidate.tagName === "figcaption" ||
      classTokens(candidate).has("thumbcaption"),
  );
  const regions = descendants
    .filter((candidate) => candidate.tagName === "area")
    .flatMap((area) => {
      const alt = normalizeText(attribute(area, "alt") ?? "");
      const title = normalizeText(attribute(area, "title") ?? "");
      const label = alt || title;
      return label
        ? [
            {
              label,
              ...(alt && title && title !== alt ? { description: title } : {}),
            },
          ]
        : [];
    });
  const legend = captionElement ? figureLegend(captionElement) : undefined;
  const content = {
    caption: captionElement ? textContent(captionElement) : "",
    ...(legend ? { legend } : {}),
    media,
    regions,
  };
  return {
    ...makeBlockBase(sectionKey, "figure", orders.get(element) ?? 0, content),
    kind: "figure",
    ...content,
  };
};

type JsonBudget = { nodes: number };

const canonicalJsonValue = (
  value: unknown,
  budget: JsonBudget,
  depth = 0,
): JsonValue | undefined => {
  budget.nodes += 1;
  if (
    budget.nodes > MAX_EMBEDDED_JSON_NODES ||
    depth > MAX_EMBEDDED_JSON_DEPTH
  ) {
    return undefined;
  }
  if (
    value === null ||
    typeof value === "string" ||
    typeof value === "boolean"
  ) {
    return value;
  }
  if (typeof value === "number")
    return Number.isFinite(value) ? value : undefined;
  if (Array.isArray(value)) {
    const result: JsonValue[] = [];
    for (const item of value) {
      const normalized = canonicalJsonValue(item, budget, depth + 1);
      if (normalized === undefined) return undefined;
      result.push(normalized);
    }
    return result;
  }
  if (!isRecord(value)) return undefined;
  const result: Record<string, JsonValue> = Object.create(null) as Record<
    string,
    JsonValue
  >;
  for (const key of Object.keys(value).sort()) {
    if (["__proto__", "constructor", "prototype"].includes(key)) {
      return undefined;
    }
    const normalized = canonicalJsonValue(value[key], budget, depth + 1);
    if (normalized === undefined) return undefined;
    result[key] = normalized;
  }
  return result;
};

const embeddedJsonExceedsLimit = (raw: string): boolean =>
  new TextEncoder().encode(raw).byteLength > MAX_EMBEDDED_JSON_BYTES;

const parseEmbeddedJson = (raw: string | undefined): JsonValue | undefined => {
  if (raw == null || embeddedJsonExceedsLimit(raw)) {
    return undefined;
  }
  try {
    return canonicalJsonValue(JSON.parse(raw), { nodes: 0 });
  } catch {
    return undefined;
  }
};

const mapJsonWithinLimits = (value: JsonValue): boolean => {
  const state = { coordinates: 0 };
  const visit = (
    candidate: JsonValue,
    depth: number,
    insideCoordinates: boolean,
  ): boolean => {
    if (depth > MAX_MAP_JSON_DEPTH) return false;
    if (Array.isArray(candidate)) {
      if (
        insideCoordinates &&
        candidate.length >= 2 &&
        candidate.every((part) => typeof part === "number")
      ) {
        state.coordinates += 1;
        return state.coordinates <= MAX_MAP_COORDINATES;
      }
      return candidate.every((part) =>
        visit(part, depth + 1, insideCoordinates),
      );
    }
    if (candidate != null && typeof candidate === "object") {
      return Object.entries(candidate).every(([key, part]) =>
        visit(part, depth + 1, insideCoordinates || key === "coordinates"),
      );
    }
    return true;
  };
  return visit(value, 0, false);
};

const containsUnversionedExternalData = (value: JsonValue): boolean => {
  if (Array.isArray(value)) {
    return value.some(containsUnversionedExternalData);
  }
  if (value == null || typeof value !== "object") return false;
  const record = value as Record<string, JsonValue>;
  if (jsonText(record.type) === "ExternalData") return true;
  return Object.values(record).some(containsUnversionedExternalData);
};

const parseChartExtension = (element: Element): ParsedExtensionResult => {
  if (
    element.tagName !== "wiki-chart" &&
    attribute(element, "data-mw-chart") == null
  ) {
    return null;
  }
  const rawPayload = attribute(element, "data-mw-chart");
  if (rawPayload && embeddedJsonExceedsLimit(rawPayload)) {
    return { reason: "payload-limit" };
  }
  const payload = parseEmbeddedJson(rawPayload);
  if (payload === undefined) return { reason: "invalid-data-mw" };
  const spec = isRecord(payload) && "spec" in payload ? payload.spec : payload;
  if (!isRecord(spec) && !Array.isArray(spec)) {
    return { reason: "unsupported-extension" };
  }
  return { extension: { kind: "chart", spec } };
};

const jsonRecord = (
  value: JsonValue | undefined,
): Record<string, JsonValue> | null =>
  value != null && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, JsonValue>)
    : null;

const jsonText = (value: JsonValue | undefined): string | undefined =>
  typeof value === "string" ? value : undefined;

const finiteAttributeNumber = (
  value: string | undefined,
): number | undefined => {
  if (value == null || value.trim() === "") return undefined;
  const result = Number(value);
  return Number.isFinite(result) ? result : undefined;
};

const extensionNameFromType = (element: Element): string | undefined =>
  typeTokens(element)
    .find((token) => token.startsWith("mw:Extension/"))
    ?.slice("mw:Extension/".length)
    .toLocaleLowerCase();

const isEmbeddedSourceCandidate = (element: Element): boolean =>
  element.tagName === "wiki-chart" ||
  attribute(element, "data-mw-chart") != null ||
  extensionNameFromType(element) != null ||
  typeTokens(element).includes("mw:Transclusion") ||
  attribute(element, "data-mw-kartographer") != null ||
  ["mapframe", "maplink", "timeline"].includes(element.tagName);

const NON_NARRATIVE_EXTENSION_NAMES = new Set([
  "indicator",
  "ref",
  "references",
  "section",
  "templatestyles",
]);

const VISUAL_EXTENSION_NAMES = new Set(["gallery", "hiero", "imagemap"]);

const extensionBodySource = (
  dataMw: Record<string, JsonValue>,
): string | undefined => {
  const body = jsonRecord(dataMw.body);
  return jsonText(body?.extsrc);
};

const parseKartographerExtension = (
  element: Element,
  dataMw: Record<string, JsonValue> | null,
): ParsedExtensionResult => {
  const name = (
    jsonText(dataMw?.name) ??
    extensionNameFromType(element) ??
    attribute(element, "data-mw-kartographer") ??
    (["mapframe", "maplink"].includes(element.tagName) ? element.tagName : "")
  ).toLocaleLowerCase();
  if (name !== "mapframe" && name !== "maplink") return null;
  const dataAttrs = jsonRecord(dataMw?.attrs);
  const attrText = (name: string): string | undefined =>
    jsonText(dataAttrs?.[name]) ?? attribute(element, name);
  const latitude = finiteAttributeNumber(
    attrText("latitude") ?? attribute(element, "data-lat"),
  );
  const longitude = finiteAttributeNumber(
    attrText("longitude") ?? attribute(element, "data-lon"),
  );
  const zoom = finiteAttributeNumber(
    attrText("zoom") ?? attribute(element, "data-zoom"),
  );
  if (
    (latitude != null && (latitude < -90 || latitude > 90)) ||
    (longitude != null && (longitude < -180 || longitude > 180))
  ) {
    return { reason: "unsupported-extension" };
  }
  const bodySource = dataMw
    ? extensionBodySource(dataMw)
    : textContent(element);
  if (bodySource?.trim() && embeddedJsonExceedsLimit(bodySource.trim())) {
    return { reason: "payload-limit" };
  }
  const geoJson = bodySource?.trim()
    ? parseEmbeddedJson(bodySource.trim())
    : undefined;
  if (geoJson !== undefined && containsUnversionedExternalData(geoJson)) {
    return { reason: "unversioned-external-data" };
  }
  if (geoJson !== undefined && !mapJsonWithinLimits(geoJson)) {
    return { reason: "payload-limit" };
  }
  if (
    bodySource?.trim() &&
    geoJson === undefined &&
    latitude == null &&
    longitude == null
  ) {
    return { reason: "invalid-data-mw" };
  }
  if (
    (latitude == null) !== (longitude == null) ||
    (latitude == null && geoJson === undefined)
  ) {
    return { reason: "unsupported-extension" };
  }
  const label = normalizeText(textContent(element));
  return {
    extension: {
      kind: "kartographer",
      presentation: name,
      ...(label ? { label } : {}),
      ...(latitude != null ? { latitude } : {}),
      ...(longitude != null ? { longitude } : {}),
      ...(zoom != null ? { zoom: Math.max(0, Math.min(22, zoom)) } : {}),
      ...(geoJson !== undefined ? { geoJson } : {}),
    },
  };
};

const TIMELINE_FIELD_NAMES = new Set([
  "bar",
  "barset",
  "from",
  "till",
  "text",
  "color",
]);

const timelineFields = (line: string): Map<string, string> => {
  const starts: Array<{ name: string; keyStart: number; valueStart: number }> =
    [];
  for (let index = 0; index < line.length; index += 1) {
    if (index > 0 && !/\s/.test(line[index - 1])) continue;
    let cursor = index;
    while (cursor < line.length && /[A-Za-z]/.test(line[cursor])) cursor += 1;
    const name = line.slice(index, cursor).toLocaleLowerCase();
    while (cursor < line.length && /\s/.test(line[cursor])) cursor += 1;
    if (!TIMELINE_FIELD_NAMES.has(name) || line[cursor] !== ":") continue;
    starts.push({ name, keyStart: index, valueStart: cursor + 1 });
    index = cursor;
  }
  const result = new Map<string, string>();
  starts.forEach((start, index) => {
    let value = line
      .slice(start.valueStart, starts[index + 1]?.keyStart ?? line.length)
      .trim();
    if (value.length >= 2 && value.startsWith('"') && value.endsWith('"')) {
      value = value.slice(1, -1).trim();
    }
    if (value) result.set(start.name, value);
  });
  return result;
};

const timelineDateFormat = (source: string): "dmy" | "mdy" | "year" => {
  for (const line of source.split(/\r?\n/)) {
    const equals = line.indexOf("=");
    if (equals < 0) continue;
    const name = line.slice(0, equals).trim().toLocaleLowerCase();
    if (name !== "dateformat") continue;
    const value = line
      .slice(equals + 1)
      .trim()
      .toLocaleLowerCase();
    return value.startsWith("dd")
      ? "dmy"
      : value.startsWith("mm")
        ? "mdy"
        : "year";
  }
  return "year";
};

const parseTimelineExtension = (
  element: Element,
  dataMw: Record<string, JsonValue> | null,
): ParsedExtensionResult => {
  const name = (
    jsonText(dataMw?.name) ??
    extensionNameFromType(element) ??
    (element.tagName === "timeline" ? "timeline" : "")
  ).toLocaleLowerCase();
  if (name !== "timeline") return null;
  const source = dataMw ? extensionBodySource(dataMw) : textContent(element);
  if (!source) return { reason: "invalid-data-mw" };
  if (embeddedJsonExceedsLimit(source)) return { reason: "payload-limit" };
  const entries: Array<{
    from: string;
    to: string;
    label: string;
    category?: string;
  }> = [];
  for (const line of source.split(/\r?\n/)) {
    const fields = timelineFields(line);
    const from = normalizeText(fields.get("from") ?? "");
    const to = normalizeText(fields.get("till") ?? "");
    const label = normalizeText(fields.get("text") ?? "");
    if (!from || !to || !label) continue;
    const category = normalizeText(fields.get("color") ?? "");
    entries.push({ from, to, label, ...(category ? { category } : {}) });
    if (entries.length > 2_000) return { reason: "payload-limit" };
  }
  if (entries.length === 0) return { reason: "unsupported-extension" };
  return {
    extension: {
      kind: "easy-timeline",
      dateFormat: timelineDateFormat(source),
      entries,
    },
  };
};

const templateParameterText = (
  value: JsonValue | undefined,
): string | undefined => jsonText(value) ?? jsonText(jsonRecord(value)?.wt);

const normalizedTemplateName = (value: string): string =>
  value
    .trim()
    .toLocaleLowerCase()
    .replace(/_/g, " ")
    .replace(/\s+/g, " ")
    .replace(/^template\s*:\s*/, "");

const decimalCoordinatePair = (
  value: string,
): { latitude: number; longitude: number } | null => {
  let parts: string[];
  const trimmed = value.trim();
  if (trimmed.startsWith("{{") && trimmed.endsWith("}}")) {
    parts = trimmed
      .slice(2, -2)
      .split("|")
      .map((part) => part.trim());
    if (normalizedTemplateName(parts.shift() ?? "") !== "coord") return null;
  } else if (trimmed.includes(";")) {
    parts = trimmed.split(";").map((part) => part.trim());
  } else {
    parts = trimmed.split(",").map((part) => part.trim());
  }
  if (parts.length !== 2) return null;
  const latitude = finiteAttributeNumber(parts[0]);
  const longitude = finiteAttributeNumber(parts[1]);
  return latitude != null &&
    longitude != null &&
    latitude >= -90 &&
    latitude <= 90 &&
    longitude >= -180 &&
    longitude <= 180
    ? { latitude, longitude }
    : null;
};

const parseOsmLocationMapExtension = (
  dataMw: Record<string, JsonValue> | null,
): ParsedExtensionResult => {
  const parts = dataMw?.parts;
  if (!Array.isArray(parts)) return null;
  for (const part of parts) {
    const template = jsonRecord(jsonRecord(part)?.template);
    if (!template) continue;
    const target = jsonRecord(template.target);
    const targetName =
      templateParameterText(target?.wt ?? template.target) ?? "";
    if (normalizedTemplateName(targetName) !== "osm location map") continue;
    const params = jsonRecord(template.params);
    if (!params) return { reason: "invalid-data-mw" };
    const indexes = Object.keys(params)
      .filter((name) => name.startsWith("mark-coord"))
      .flatMap((name) => {
        const index = Number(name.slice("mark-coord".length));
        return Number.isSafeInteger(index) && index >= 0 ? [index] : [];
      })
      .sort((left, right) => left - right);
    if (indexes.length === 0 || indexes.length > MAX_MAP_COORDINATES) {
      return { reason: "unsupported-extension" };
    }
    const markers = [];
    for (const index of indexes) {
      const coordinateSource = templateParameterText(
        params[`mark-coord${index}`],
      );
      const coordinate = coordinateSource
        ? decimalCoordinatePair(coordinateSource)
        : null;
      if (!coordinate) return { reason: "unsupported-extension" };
      const title = normalizeText(
        templateParameterText(params[`mark-title${index}`]) ??
          templateParameterText(params[`label${index}`]) ??
          `Location ${index}`,
      );
      const description = normalizeText(
        templateParameterText(params[`mark-description${index}`]) ?? "",
      );
      markers.push({
        ...coordinate,
        title,
        ...(description ? { description } : {}),
      });
    }
    const zoom = finiteAttributeNumber(templateParameterText(params.zoom));
    return {
      extension: {
        kind: "osm-location-map",
        ...(zoom != null ? { zoom: Math.max(0, Math.min(22, zoom)) } : {}),
        markers,
      },
    };
  }
  return null;
};

const parseDataMwExtension = (element: Element): ParsedExtensionResult => {
  const rawDataMw = attribute(element, "data-mw");
  if (!isEmbeddedSourceCandidate(element)) return null;
  if (rawDataMw && embeddedJsonExceedsLimit(rawDataMw)) {
    return { reason: "payload-limit" };
  }
  const dataMwValue =
    rawDataMw == null ? undefined : parseEmbeddedJson(rawDataMw);
  if (rawDataMw != null && dataMwValue === undefined) {
    return { reason: "invalid-data-mw" };
  }
  const dataMw = jsonRecord(dataMwValue);
  const parsed =
    parseKartographerExtension(element, dataMw) ??
    parseTimelineExtension(element, dataMw) ??
    parseOsmLocationMapExtension(dataMw);
  if (parsed) return parsed;
  return extensionNameFromType(element) != null ||
    attribute(element, "data-mw-kartographer") != null ||
    ["mapframe", "maplink", "timeline"].includes(element.tagName)
    ? { reason: "unsupported-extension" }
    : null;
};

const parseExtension = (
  element: Element,
  cache: ExtensionParseCache,
): ParsedExtensionResult => {
  if (cache.has(element)) return cache.get(element) ?? null;
  const parsed = parseChartExtension(element) ?? parseDataMwExtension(element);
  cache.set(element, parsed);
  return parsed;
};

const isExplicitVisualExtension = (element: Element): boolean => {
  const extensionName = extensionNameFromType(element);
  return (
    (extensionName != null &&
      (VISUAL_EXTENSION_NAMES.has(extensionName) ||
        ["mapframe", "maplink", "timeline"].includes(extensionName))) ||
    attribute(element, "data-mw-kartographer") != null ||
    ["mapframe", "maplink", "timeline"].includes(element.tagName)
  );
};

/**
 * Identifies elements that can independently project a visual. This is kept
 * separate from the broad embedded-source predicate so an unrelated extension
 * nested in a structural container cannot be emitted twice as a visual block.
 */
const isNamedVisualSourceCandidate = (
  element: Element,
  extensionCache: ExtensionParseCache,
): boolean => {
  if (element.tagName === "figure" || isExplicitVisualExtension(element)) {
    return true;
  }
  // A named chart remains a visual source even when its payload is malformed
  // or over budget. Keeping it in the visual traversal lets extensionBlock
  // preserve the typed failure instead of collapsing it into a generic
  // container fallback.
  if (
    element.tagName === "wiki-chart" ||
    attribute(element, "data-mw-chart") != null
  ) {
    return true;
  }
  if (isFigureElement(element)) {
    return allElements(element).some((candidate) => {
      if (candidate.tagName !== "img" && candidate.tagName !== "video") {
        return false;
      }
      return (
        (positiveDimension(attribute(candidate, "width")) ?? 0) >=
          MIN_NESTED_MEDIA_DIMENSION &&
        (positiveDimension(attribute(candidate, "height")) ?? 0) >=
          MIN_NESTED_MEDIA_DIMENSION
      );
    });
  }
  const extension = parseExtension(element, extensionCache);
  return extension != null && "extension" in extension;
};

const extensionBlock = (
  element: Element,
  sectionKey: string,
  orders: Map<Node, number>,
  issues: MediaWikiDocumentIssue[],
  extensionCache: ExtensionParseCache,
): MediaWikiBlock | null => {
  const extensionName = extensionNameFromType(element);
  if (extensionName && NON_NARRATIVE_EXTENSION_NAMES.has(extensionName)) {
    return null;
  }
  const parsed = parseExtension(element, extensionCache);
  if (parsed == null) return null;
  const sourceOrder = orders.get(element) ?? 0;
  if ("extension" in parsed) {
    return {
      ...makeBlockBase(sectionKey, "extension", sourceOrder, parsed.extension),
      kind: "extension",
      extension: parsed.extension,
    };
  }
  issues.push({
    code: parsed.reason,
    severity: "fallback",
    sectionKey,
    sourceOrder,
  });
  return {
    ...makeBlockBase(sectionKey, "unsupported", sourceOrder, {
      sourceKind: "extension",
      reason: parsed.reason,
    }),
    kind: "unsupported",
    sourceKind: "extension",
    reason: parsed.reason,
    affectsNarration: true,
  };
};

const blockFromElement = (
  node: Element,
  sectionKey: string,
  orders: Map<Node, number>,
  issues: MediaWikiDocumentIssue[],
  language: string,
  extensionCache: ExtensionParseCache,
): MediaWikiBlock | null => {
  const extensionName = extensionNameFromType(node);
  if (extensionName === "poem") {
    const text = textContent(node);
    return text
      ? {
          ...makeBlockBase(sectionKey, "prose", orders.get(node) ?? 0, text),
          kind: "prose",
          role: "blockquote",
          text,
        }
      : null;
  }
  if (extensionName && VISUAL_EXTENSION_NAMES.has(extensionName)) {
    const figure = figureBlock(node, sectionKey, orders, language);
    if (figure) return figure;
  }
  const extension = extensionBlock(
    node,
    sectionKey,
    orders,
    issues,
    extensionCache,
  );
  if (extension) return extension;

  if (node.tagName === "pre") {
    const sourceOrder = orders.get(node) ?? 0;
    issues.push({
      code: "unsupported-block",
      severity: "fallback",
      sectionKey,
      sourceOrder,
    });
    return {
      ...makeBlockBase(sectionKey, "unsupported", sourceOrder, {
        sourceKind: "preformatted",
        reason: "unsupported-block",
      }),
      kind: "unsupported",
      sourceKind: "preformatted",
      reason: "unsupported-block",
      affectsNarration: true,
    };
  }

  if (isFigureElement(node)) {
    const figure = figureBlock(node, sectionKey, orders, language);
    if (figure) return figure;
    const sourceOrder = orders.get(node) ?? 0;
    issues.push({
      code: "unsupported-block",
      severity: "fallback",
      sectionKey,
      sourceOrder,
    });
    return {
      ...makeBlockBase(sectionKey, "unsupported", sourceOrder, {
        sourceKind: "figure",
        reason: "unsupported-block",
      }),
      kind: "unsupported",
      sourceKind: "figure",
      reason: "unsupported-block",
      affectsNarration: true,
    };
  }

  if (node.tagName === "p" || node.tagName === "blockquote") {
    const text = textContent(node);
    return text
      ? {
          ...makeBlockBase(sectionKey, "prose", orders.get(node) ?? 0, text),
          kind: "prose",
          role: node.tagName === "blockquote" ? "blockquote" : "paragraph",
          text,
        }
      : null;
  }

  if (["ol", "ul", "dl"].includes(node.tagName)) {
    const parsed = parseList(node, orders, extensionCache);
    if (parsed.unsupportedSourceOrder != null) {
      const sourceOrder = orders.get(node) ?? 0;
      issues.push({
        code: "unsupported-block",
        severity: "fallback",
        sectionKey,
        sourceOrder: parsed.unsupportedSourceOrder,
      });
      return {
        ...makeBlockBase(sectionKey, "unsupported", sourceOrder, {
          sourceKind: "list",
          reason: "unsupported-block",
        }),
        kind: "unsupported",
        sourceKind: "list",
        reason: "unsupported-block",
        affectsNarration: true,
      };
    }
    const list = parsed.list;
    return list.items.length > 0
      ? {
          ...makeBlockBase(sectionKey, "list", orders.get(node) ?? 0, list),
          kind: "list",
          list,
        }
      : null;
  }

  if (node.tagName === "table") {
    const normalized = normalizeTable(node, sectionKey, orders);
    if ("table" in normalized) {
      return {
        ...makeBlockBase(
          sectionKey,
          "table",
          orders.get(node) ?? 0,
          normalized.table,
        ),
        kind: "table",
        table: normalized.table,
      };
    }
    const sourceOrder = orders.get(node) ?? 0;
    issues.push({
      code: normalized.reason,
      severity: "fallback",
      sectionKey,
      sourceOrder,
    });
    return {
      ...makeBlockBase(sectionKey, "unsupported", sourceOrder, {
        sourceKind: "table",
        reason: normalized.reason,
      }),
      kind: "unsupported",
      sourceKind: "table",
      reason: normalized.reason,
      affectsNarration: true,
    };
  }

  return null;
};

const collectBlocks = (
  sectionElement: Element,
  sectionKey: string,
  orders: Map<Node, number>,
  issues: MediaWikiDocumentIssue[],
  language: string,
  extensionCache: ExtensionParseCache,
): MediaWikiBlock[] => {
  const blocks: MediaWikiBlock[] = [];
  const emittedVisualElements = new Set<Element>();
  const visitNestedVisual = (node: Node) => {
    if (!isElement(node)) {
      childNodes(node).forEach(visitNestedVisual);
      return;
    }
    if (node !== sectionElement && node.tagName === "section") return;
    if (isHeadingTag(node.tagName) || shouldSkipText(node)) return;
    if (isNamedVisualSourceCandidate(node, extensionCache)) {
      if (!emittedVisualElements.has(node)) {
        const block = blockFromElement(
          node,
          sectionKey,
          orders,
          issues,
          language,
          extensionCache,
        );
        if (
          block &&
          (block.kind === "figure" ||
            block.kind === "extension" ||
            (block.kind === "unsupported" &&
              (block.sourceKind === "figure" ||
                block.sourceKind === "extension")))
        ) {
          blocks.push(block);
          emittedVisualElements.add(node);
          return;
        }
      } else {
        return;
      }
    }
    childNodes(node).forEach(visitNestedVisual);
  };
  const visit = (node: Node) => {
    if (node.nodeName === "#text" && "value" in node) {
      const text = normalizeText(node.value);
      if (text) {
        const sourceOrder = orders.get(node) ?? 0;
        blocks.push({
          ...makeBlockBase(sectionKey, "prose", sourceOrder, text),
          kind: "prose",
          role: "paragraph",
          text,
        });
      }
      return;
    }
    if (!isElement(node)) {
      childNodes(node).forEach(visit);
      return;
    }
    if (node !== sectionElement && node.tagName === "section") return;
    if (isHeadingTag(node.tagName)) return;
    if (shouldSkipText(node)) return;

    const block = blockFromElement(
      node,
      sectionKey,
      orders,
      issues,
      language,
      extensionCache,
    );
    if (block) {
      blocks.push(block);
      if (block.kind === "figure" || block.kind === "extension") {
        emittedVisualElements.add(node);
      } else {
        childNodes(node).forEach(visitNestedVisual);
      }
      return;
    }

    childNodes(node).forEach(visit);
  };
  childNodes(sectionElement).forEach(visit);
  return blocks.sort((left, right) => left.sourceOrder - right.sourceOrder);
};

const sectionDomFallbackRuns = (
  sectionElement: Element,
  orders: Map<Node, number>,
): Array<{ sourceOrder: number; text: string }> => {
  const runs: Array<{ sourceOrder: number; text: string }> = [];
  const visit = (node: Node) => {
    if (node.nodeName === "#text" && "value" in node) {
      const text = normalizeText(node.value);
      if (text) runs.push({ sourceOrder: orders.get(node) ?? 0, text });
      return;
    }
    if (!isElement(node)) {
      childNodes(node).forEach(visit);
      return;
    }
    if (
      node !== sectionElement &&
      (node.tagName === "section" || isHeadingTag(node.tagName))
    ) {
      return;
    }
    if (shouldSkipText(node)) return;
    childNodes(node).forEach(visit);
  };
  childNodes(sectionElement).forEach(visit);
  return runs.sort((left, right) => left.sourceOrder - right.sourceOrder);
};

const fallbackTextFromRuns = (
  runs: readonly { sourceOrder: number; text: string }[],
): string => normalizeText(runs.map((run) => run.text).join(" "));

const canonicalList = (list: MediaWikiList): unknown => ({
  style: list.style,
  ...(list.start != null ? { start: list.start } : {}),
  items: list.items.map((item) => ({
    parts: item.parts.map((part) =>
      part.kind === "text"
        ? { kind: part.kind, text: part.text }
        : { kind: part.kind, list: canonicalList(part.list) },
    ),
  })),
});

const canonicalBlock = (block: MediaWikiBlock): unknown => {
  switch (block.kind) {
    case "prose":
      return { kind: block.kind, role: block.role, text: block.text };
    case "list":
      return { kind: block.kind, list: canonicalList(block.list) };
    case "table": {
      const idBySourceId = new Map(
        block.table.cells.map((cell, index) => [cell.id, `cell:${index}`]),
      );
      return {
        kind: block.kind,
        table: {
          caption: block.table.caption,
          rowCount: block.table.rowCount,
          columnCount: block.table.columnCount,
          cells: block.table.cells.map((cell, index) => ({
            id: `cell:${index}`,
            kind: cell.kind,
            text: cell.text,
            originRow: cell.originRow,
            originColumn: cell.originColumn,
            rowSpan: cell.rowSpan,
            columnSpan: cell.columnSpan,
            rowGroup: cell.rowGroup,
            ...(cell.columnGroup != null
              ? { columnGroup: cell.columnGroup }
              : {}),
            ...(cell.scope ? { scope: cell.scope } : {}),
            explicitHeaderIds: cell.explicitHeaderIds.map(
              (id) => idBySourceId.get(id) ?? id,
            ),
            associatedHeaderCellIds: cell.associatedHeaderCellIds.map(
              (id) => idBySourceId.get(id) ?? id,
            ),
            headerPath: cell.headerPath,
          })),
          grid: block.table.grid.map((row) =>
            row.map((id) => idBySourceId.get(id) ?? id),
          ),
        },
      };
    }
    case "figure":
      return {
        kind: block.kind,
        caption: block.caption,
        ...(block.legend ? { legend: block.legend } : {}),
        media: block.media,
        regions: block.regions,
      };
    case "extension":
      return { kind: block.kind, extension: block.extension };
    case "unsupported":
      return {
        kind: block.kind,
        sourceKind: block.sourceKind,
        reason: block.reason,
        affectsNarration: block.affectsNarration,
      };
  }
};

const semanticSourceHash = (
  identity: MediaWikiRevisionRequest,
  sourceFormat: MediaWikiDocument["sourceFormat"],
  sections: readonly MediaWikiDocumentSection[],
  citations: readonly MediaWikiCitation[],
): string =>
  deterministicHash(
    JSON.stringify({
      parserVersion: MEDIAWIKI_DOCUMENT_SCHEMA_VERSION,
      identity,
      sourceFormat,
      sections: sections.map((section) => ({
        key: section.key,
        ...(section.sourceSectionIndex
          ? { sourceSectionIndex: section.sourceSectionIndex }
          : {}),
        ...(section.tocIndex ? { tocIndex: section.tocIndex } : {}),
        ...(section.sourceFragments?.length
          ? { sourceFragments: section.sourceFragments }
          : {}),
        title: section.title,
        level: section.level,
        ...(section.parentKey ? { parentKey: section.parentKey } : {}),
        ...(section.anchor ? { anchor: section.anchor } : {}),
        role: section.role,
        fidelity: section.fidelity,
        plaintextContent: section.plaintextContent,
        fallback: section.fallback,
        blocks: section.blocks.map(canonicalBlock),
        links: section.links.map(({ targetTitle, href }) => ({
          targetTitle,
          href,
        })),
        citationIds: section.citationIds,
      })),
      citations,
    }),
  );

const semanticDocumentHash = (
  sourceHash: string,
  fallbackReason: MediaWikiDocument["fallbackReason"],
  issues: readonly MediaWikiDocumentIssue[],
): string =>
  deterministicHash(
    JSON.stringify({
      parserVersion: MEDIAWIKI_DOCUMENT_SCHEMA_VERSION,
      sourceHash,
      ...(fallbackReason ? { fallbackReason } : {}),
      issues: issues.map(({ code, severity, sectionKey }) => ({
        code,
        severity,
        ...(sectionKey ? { sectionKey } : {}),
      })),
    }),
  );

const normalizeWikiHref = (href: string, language: string): string | null => {
  try {
    const url = new URL(href, `https://${language}.wikipedia.org/wiki/`);
    if (url.protocol !== "https:" && url.protocol !== "http:") return null;
    return url.toString();
  } catch {
    return null;
  }
};

const articleLinkFromElement = (
  node: Element,
  language: string,
  orders: Map<Node, number>,
): MediaWikiArticleLink | null => {
  if (node.tagName !== "a" || !hasRelToken(node, "mw:WikiLink")) return null;
  const rawHref = attribute(node, "href") ?? "";
  const href = normalizeWikiHref(rawHref, language);
  let targetTitle = normalizeText(attribute(node, "title") ?? "");
  if (!targetTitle && href) {
    const marker = "/wiki/";
    const path = new URL(href).pathname;
    const index = path.indexOf(marker);
    if (index >= 0) {
      try {
        targetTitle = decodeURIComponent(
          path.slice(index + marker.length),
        ).replace(/_/g, " ");
      } catch {
        targetTitle = path.slice(index + marker.length).replace(/_/g, " ");
      }
    }
  }
  return href && targetTitle
    ? {
        targetTitle,
        href,
        sourceOrder: orders.get(node) ?? 0,
      }
    : null;
};

const collectLinks = (
  sectionElement: Element,
  language: string,
  orders: Map<Node, number>,
): MediaWikiArticleLink[] => {
  const links: MediaWikiArticleLink[] = [];
  const visit = (node: Node) => {
    if (!isElement(node)) return;
    if (node !== sectionElement && node.tagName === "section") return;
    const link = articleLinkFromElement(node, language, orders);
    if (link) links.push(link);
    childNodes(node).forEach(visit);
  };
  childNodes(sectionElement).forEach(visit);
  return links.sort((left, right) => left.sourceOrder - right.sourceOrder);
};

const citationIdFromHref = (href: string | undefined): string | null => {
  if (!href?.startsWith("#cite_note-")) return null;
  try {
    return decodeURIComponent(href.slice(1));
  } catch {
    return href.slice(1);
  }
};

const collectCitationReferences = (
  sectionElement: Element,
  orders: Map<Node, number>,
): Array<{ id: string; sourceOrder: number }> => {
  const result: Array<{ id: string; sourceOrder: number }> = [];
  const visit = (node: Node) => {
    if (!isElement(node)) return;
    if (node !== sectionElement && node.tagName === "section") return;
    if (node.tagName === "a") {
      const id = citationIdFromHref(attribute(node, "href"));
      if (id) {
        result.push({ id, sourceOrder: orders.get(node) ?? 0 });
      }
    }
    childNodes(node).forEach(visit);
  };
  childNodes(sectionElement).forEach(visit);
  return result;
};

const collectCitationIds = (
  sectionElement: Element,
  orders: Map<Node, number>,
): string[] => [
  ...new Set(
    collectCitationReferences(sectionElement, orders).map(({ id }) => id),
  ),
];

const collectCitations = (
  root: ParentNode,
  language: string,
): MediaWikiCitation[] => {
  const citations: MediaWikiCitation[] = [];
  for (const element of allElements(root)) {
    if (element.tagName !== "li") continue;
    const id = attribute(element, "id")?.trim();
    if (!id?.startsWith("cite_note-")) continue;
    const lastIdPart = id.split("-").at(-1);
    const parsedIndex = Number(lastIdPart);
    const index =
      Number.isSafeInteger(parsedIndex) && parsedIndex > 0
        ? parsedIndex
        : citations.length + 1;
    const external = allElements(element).find((candidate) => {
      if (candidate.tagName !== "a") return false;
      const href = attribute(candidate, "href") ?? "";
      return (
        hasRelToken(candidate, "mw:ExtLink") ||
        href.startsWith("https://") ||
        href.startsWith("http://") ||
        href.startsWith("//")
      );
    });
    const url = external
      ? normalizeWikiHref(attribute(external, "href") ?? "", language)
      : null;
    citations.push({
      id,
      index,
      text: textContent(element),
      ...(url ? { url } : {}),
    });
  }
  return citations;
};

const headingAnchor = (section: Element): string | undefined => {
  const heading = sectionHeading(section);
  return heading ? attribute(heading, "id") : undefined;
};

const sectionHeading = (section: Element): Element | undefined => {
  let heading: Element | undefined;
  const visit = (node: Node) => {
    if (heading || !isElement(node)) return;
    if (node !== section && node.tagName === "section") return;
    if (isHeadingTag(node.tagName)) {
      heading = node;
      return;
    }
    childNodes(node).forEach(visit);
  };
  childNodes(section).forEach(visit);
  return heading;
};

const parseSectionsFromParsoid = ({
  root,
  toc,
  orders,
  language,
  issues,
  extensionCache,
}: {
  root: ParentNode;
  toc: TocEntry[];
  orders: Map<Node, number>;
  language: string;
  issues: MediaWikiDocumentIssue[];
  extensionCache: ExtensionParseCache;
}): MediaWikiDocumentSection[] => {
  const sectionElements = allElements(root).filter(
    (element) =>
      element.tagName === "section" &&
      isParsoidSectionSourceIndex(
        attribute(element, "data-mw-section-id") ?? "",
      ),
  );
  const sectionKeyByElement = new Map<Element, string>();
  const sourceIndexOccurrenceByElement = new Map<Element, number>();
  const sourceIndexOccurrences = new Map<string, number>();
  sectionElements.forEach((section, index) => {
    const raw = attribute(section, "data-mw-section-id")!;
    const occurrence = (sourceIndexOccurrences.get(raw) ?? 0) + 1;
    sourceIndexOccurrences.set(raw, occurrence);
    sourceIndexOccurrenceByElement.set(section, occurrence);
    const isNegativeLead =
      index === 0 && raw === "-1" && sectionHeading(section) == null;
    sectionKeyByElement.set(
      section,
      raw === "0" || isNegativeLead
        ? "__summary__"
        : raw === "-1" || raw === "-2"
          ? createMediaWikiSpecialSectionKey(raw, occurrence)
          : raw,
    );
  });
  const usedTocEntries = new Set<number>();
  let tocCursor = 0;
  const takeTocEntry = (
    sourceIndex: string,
    heading: Element | undefined,
  ): TocEntry | undefined => {
    if (!heading || sourceIndex === "0" || sourceIndex === "-2") {
      return undefined;
    }
    const headingTitle = normalizeTitle(textContent(heading));
    const anchor = attribute(heading, "id");
    let matchIndex = -1;
    for (let index = tocCursor; index < toc.length; index += 1) {
      if (usedTocEntries.has(index)) continue;
      const entry = toc[index];
      const exactEditableIndex =
        sourceIndex !== "-1" && entry.index === sourceIndex;
      const matchingHeading =
        normalizeTitle(entry.line) === headingTitle ||
        Boolean(anchor && entry.anchor === anchor);
      if (
        (exactEditableIndex && matchingHeading) ||
        (sourceIndex === "-1" && matchingHeading)
      ) {
        matchIndex = index;
        break;
      }
    }
    if (matchIndex < 0) return undefined;
    usedTocEntries.add(matchIndex);
    tocCursor = matchIndex + 1;
    return toc[matchIndex];
  };
  const roleByKey = new Map<string, MediaWikiSectionRole>();
  const fallbackRunsBySectionKey = new Map<
    string,
    Array<{ sourceOrder: number; text: string }>
  >();

  const nearestSectionAncestor = (element: Element): Element | undefined => {
    let parent: Node | undefined = element.parentNode as Node | undefined;
    while (parent) {
      if (isElement(parent) && sectionKeyByElement.has(parent)) return parent;
      parent =
        "parentNode" in parent
          ? (parent.parentNode as Node | undefined)
          : undefined;
    }
    return undefined;
  };

  const parsedSections: MediaWikiDocumentSection[] = sectionElements.map(
    (sectionElement) => {
      const key = sectionKeyByElement.get(sectionElement)!;
      const sourceSectionIndex = attribute(
        sectionElement,
        "data-mw-section-id",
      )!;
      const heading = sectionHeading(sectionElement);
      const tocEntry =
        key === "__summary__"
          ? undefined
          : takeTocEntry(sourceSectionIndex, heading);
      let parent = nearestSectionAncestor(sectionElement);
      let parentKey: string | undefined;
      while (parent) {
        if (attribute(parent, "data-mw-section-id") !== "-2") {
          parentKey = sectionKeyByElement.get(parent);
          break;
        }
        parent = nearestSectionAncestor(parent);
      }
      const title =
        key === "__summary__"
          ? "Summary"
          : tocEntry?.line ||
            (heading ? textContent(heading) : "Source continuation");
      const inheritedEndMatter = parentKey
        ? roleByKey.get(parentKey) === "end-matter"
        : false;
      const role: MediaWikiSectionRole =
        inheritedEndMatter || END_MATTER_TITLES.has(normalizeTitle(title))
          ? "end-matter"
          : "body";
      roleByKey.set(key, role);
      const blocks = collectBlocks(
        sectionElement,
        key,
        orders,
        issues,
        language,
        extensionCache,
      );
      const fallbackRuns = sectionDomFallbackRuns(sectionElement, orders);
      fallbackRunsBySectionKey.set(key, fallbackRuns);
      const fallbackText = fallbackTextFromRuns(fallbackRuns);
      const fidelity = blocks.some(
        (block) => block.kind === "unsupported" && block.affectsNarration,
      )
        ? "partial"
        : "complete";
      const anchor =
        key === "__summary__"
          ? undefined
          : tocEntry?.anchor || headingAnchor(sectionElement);
      return {
        key,
        sourceSectionIndex,
        ...(tocEntry ? { tocIndex: tocEntry.index } : {}),
        title,
        level: key === "__summary__" ? 0 : tocEntry?.level || 1,
        sourceOrder: orders.get(sectionElement) ?? 0,
        ...(parentKey ? { parentKey } : {}),
        ...(anchor ? { anchor } : {}),
        role,
        fidelity,
        plaintextContent: fallbackText,
        fallback: { text: fallbackText, source: "dom-text" },
        blocks,
        links: collectLinks(sectionElement, language, orders),
        citationIds: collectCitationIds(sectionElement, orders),
      } satisfies MediaWikiDocumentSection;
    },
  );

  const logicalSections = parsedSections.filter(
    (section) => section.sourceSectionIndex !== "-2",
  );
  const pseudoSections = sectionElements.flatMap((element, index) =>
    parsedSections[index].sourceSectionIndex === "-2"
      ? [{ element, section: parsedSections[index] }]
      : [],
  );

  const fragmentGroup = (
    sourceOrder: number,
    boundaries: readonly number[],
  ): number => {
    let group = 0;
    while (group < boundaries.length && sourceOrder > boundaries[group]) {
      group += 1;
    }
    return group;
  };

  for (const { element, section } of pseudoSections) {
    const childBoundaries = sectionElements
      .filter(
        (candidate) =>
          candidate !== element &&
          nearestSectionAncestor(candidate) === element,
      )
      .map((candidate) => orders.get(candidate) ?? 0)
      .sort((left, right) => left - right);
    const groups = Array.from({ length: childBoundaries.length + 1 }, () => ({
      blocks: [] as MediaWikiBlock[],
      links: [] as MediaWikiArticleLink[],
      citations: [] as Array<{ id: string; sourceOrder: number }>,
      textRuns: [] as Array<{ sourceOrder: number; text: string }>,
    }));
    for (const block of section.blocks) {
      groups[fragmentGroup(block.sourceOrder, childBoundaries)].blocks.push(
        block,
      );
    }
    for (const link of section.links) {
      groups[fragmentGroup(link.sourceOrder, childBoundaries)].links.push(link);
    }
    for (const citation of collectCitationReferences(element, orders)) {
      groups[
        fragmentGroup(citation.sourceOrder, childBoundaries)
      ].citations.push(citation);
    }
    for (const run of sectionDomFallbackRuns(element, orders)) {
      groups[fragmentGroup(run.sourceOrder, childBoundaries)].textRuns.push(
        run,
      );
    }

    const occurrence = sourceIndexOccurrenceByElement.get(element)!;
    groups.forEach((group, groupIndex) => {
      if (
        group.blocks.length === 0 &&
        group.links.length === 0 &&
        group.citations.length === 0 &&
        group.textRuns.length === 0
      ) {
        return;
      }
      const fragmentKey = createMediaWikiSpecialSectionKey(
        "-2",
        occurrence,
        groupIndex + 1,
      );
      const sourceOrders = [
        ...group.blocks.map((block) => block.sourceOrder),
        ...group.links.map((link) => link.sourceOrder),
        ...group.citations.map((citation) => citation.sourceOrder),
        ...group.textRuns.map((run) => run.sourceOrder),
      ];
      const sourceOrder = Math.min(...sourceOrders);
      let ownerIndex = -1;
      for (let index = 0; index < logicalSections.length; index += 1) {
        if (logicalSections[index].sourceOrder < sourceOrder)
          ownerIndex = index;
      }
      const fragmentText = fallbackTextFromRuns(group.textRuns);
      const rekeyedBlocks = group.blocks.map(
        (block): MediaWikiBlock => ({
          ...block,
          id: `${fragmentKey}:${block.kind}:${block.sourceOrder}:${block.contentHash.slice(-12)}`,
        }),
      );
      const fragmentFidelity = rekeyedBlocks.some(
        (block) => block.kind === "unsupported" && block.affectsNarration,
      )
        ? "partial"
        : "complete";
      if (ownerIndex < 0) {
        fallbackRunsBySectionKey.set(fragmentKey, group.textRuns);
        logicalSections.push({
          ...section,
          key: fragmentKey,
          sourceOrder,
          fidelity: fragmentFidelity,
          plaintextContent: fragmentText,
          fallback: { text: fragmentText, source: "dom-text" },
          blocks: rekeyedBlocks,
          links: group.links,
          citationIds: [...new Set(group.citations.map(({ id }) => id))],
        });
        return;
      }

      const owner = logicalSections[ownerIndex];
      const mergedFallbackRuns = [
        ...(fallbackRunsBySectionKey.get(owner.key) ?? []),
        ...group.textRuns,
      ].sort((left, right) => left.sourceOrder - right.sourceOrder);
      fallbackRunsBySectionKey.set(owner.key, mergedFallbackRuns);
      const mergedFallbackText = fallbackTextFromRuns(mergedFallbackRuns);
      logicalSections[ownerIndex] = {
        ...owner,
        sourceFragments: [
          ...(owner.sourceFragments ?? []),
          { key: fragmentKey, sourceSectionIndex: "-2" },
        ],
        fidelity:
          owner.fidelity === "partial" || fragmentFidelity === "partial"
            ? "partial"
            : owner.fidelity,
        plaintextContent: mergedFallbackText,
        fallback: {
          text: mergedFallbackText,
          source: "dom-text",
        },
        blocks: [...owner.blocks, ...rekeyedBlocks].sort(
          (left, right) => left.sourceOrder - right.sourceOrder,
        ),
        links: [...owner.links, ...group.links].sort(
          (left, right) => left.sourceOrder - right.sourceOrder,
        ),
        citationIds: [
          ...new Set([
            ...owner.citationIds,
            ...group.citations.map(({ id }) => id),
          ]),
        ],
      };
      issues.forEach((issue, issueIndex) => {
        if (
          issue.sectionKey === section.key &&
          fragmentGroup(issue.sourceOrder ?? sourceOrder, childBoundaries) ===
            groupIndex
        ) {
          issues[issueIndex] = { ...issue, sectionKey: owner.key };
        }
      });
    });
  }

  return logicalSections.sort(
    (left, right) => left.sourceOrder - right.sourceOrder,
  );
};

const visibleTextRuns = ({
  root,
  semanticElements,
  orders,
}: {
  root: ParentNode;
  semanticElements: Set<Element>;
  orders: Map<Node, number>;
}): Array<{ sourceOrder: number; text: string; covered: boolean }> => {
  const runs: Array<{
    sourceOrder: number;
    text: string;
    covered: boolean;
  }> = [];
  const visit = (node: Node, covered: boolean, skipped: boolean) => {
    if (node.nodeName === "#text" && "value" in node) {
      const text = normalizeText(node.value);
      if (!skipped && text) {
        runs.push({
          sourceOrder: orders.get(node) ?? -1,
          text,
          covered,
        });
      }
      return;
    }
    if (!isElement(node)) {
      childNodes(node).forEach((child) => visit(child, covered, skipped));
      return;
    }
    const nextSkipped =
      skipped || isHeadingTag(node.tagName) || shouldSkipText(node);
    const nextCovered = covered || semanticElements.has(node);
    childNodes(node).forEach((child) => visit(child, nextCovered, nextSkipped));
  };
  childNodes(root).forEach((node) => visit(node, false, false));
  return runs.sort((left, right) => left.sourceOrder - right.sourceOrder);
};

const parseSectionsFromLegacy = ({
  root,
  toc,
  orders,
  language,
  issues,
  extensionCache,
}: {
  root: ParentNode;
  toc: TocEntry[];
  orders: Map<Node, number>;
  language: string;
  issues: MediaWikiDocumentIssue[];
  extensionCache: ExtensionParseCache;
}): MediaWikiDocumentSection[] => {
  const elements = allElements(root);
  const headings = elements.filter((element) =>
    ARTICLE_SECTION_HEADING_TAGS.has(element.tagName),
  );
  const normalizedTocTitles = toc.map((entry) => normalizeTitle(entry.line));
  const matchedHeadings: Array<{ heading: Element; toc: TocEntry }> = [];
  let tocCursor = 0;
  for (const heading of headings) {
    const anchor = attribute(heading, "id");
    const normalizedHeadingTitle = normalizeTitle(textContent(heading));
    let matchIndex = -1;
    for (let index = tocCursor; index < toc.length; index += 1) {
      if (
        (anchor && toc[index].anchor === anchor) ||
        normalizedTocTitles[index] === normalizedHeadingTitle
      ) {
        matchIndex = index;
        break;
      }
    }
    if (matchIndex < 0) continue;
    matchedHeadings.push({ heading, toc: toc[matchIndex] });
    tocCursor = matchIndex + 1;
  }

  const semanticTags = new Set([
    "p",
    "blockquote",
    "ol",
    "ul",
    "dl",
    "table",
    "figure",
    "pre",
  ]);
  const semanticElements = elements.filter((element) => {
    if (
      !semanticTags.has(element.tagName) &&
      !isFigureElement(element) &&
      !isEmbeddedSourceCandidate(element)
    ) {
      return false;
    }
    const isNestedVisual = isNamedVisualSourceCandidate(
      element,
      extensionCache,
    );
    let parent = element.parentNode as Node | undefined;
    while (parent) {
      if (
        isElement(parent) &&
        (semanticTags.has(parent.tagName) ||
          isFigureElement(parent) ||
          isEmbeddedSourceCandidate(parent))
      ) {
        if (
          !isNestedVisual ||
          isNamedVisualSourceCandidate(parent, extensionCache)
        ) {
          return false;
        }
      }
      parent =
        "parentNode" in parent
          ? (parent.parentNode as Node | undefined)
          : undefined;
    }
    return true;
  });
  const linkElements = elements.filter(
    (element) => element.tagName === "a" && hasRelToken(element, "mw:WikiLink"),
  );
  const citationLinkElements = elements.filter(
    (element) =>
      element.tagName === "a" &&
      citationIdFromHref(attribute(element, "href")) != null,
  );
  const semanticElementSet = new Set(semanticElements);
  const descriptors: Array<{
    key: string;
    title: string;
    level: number;
    anchor?: string;
    start: number;
    parentKey?: string;
  }> = [
    {
      key: "__summary__" as const,
      title: "Summary",
      level: 0,
      anchor: undefined,
      start: -1,
      parentKey: undefined,
    },
  ];
  const hierarchy: Array<{ key: string; level: number }> = [
    { key: "__summary__", level: 0 },
  ];
  for (const { heading, toc: entry } of matchedHeadings) {
    while (
      hierarchy.length > 1 &&
      hierarchy[hierarchy.length - 1].level >= entry.level
    ) {
      hierarchy.pop();
    }
    const parentKey = hierarchy.at(-1)?.key ?? "__summary__";
    descriptors.push({
      key: entry.index,
      title: entry.line,
      level: entry.level,
      anchor: entry.anchor || attribute(heading, "id"),
      start: orders.get(heading) ?? 0,
      parentKey,
    });
    hierarchy.push({ key: entry.index, level: entry.level });
  }

  const textRuns = visibleTextRuns({
    root,
    semanticElements: semanticElementSet,
    orders,
  });
  const textRunsBySection = new Map<
    string,
    Array<{ sourceOrder: number; text: string; covered: boolean }>
  >();
  let textRunCursor = 0;
  descriptors.forEach((descriptor, index) => {
    const end = descriptors[index + 1]?.start ?? Number.POSITIVE_INFINITY;
    while (
      textRunCursor < textRuns.length &&
      textRuns[textRunCursor].sourceOrder <= descriptor.start
    ) {
      textRunCursor += 1;
    }
    const sectionRuns: typeof textRuns = [];
    while (
      textRunCursor < textRuns.length &&
      textRuns[textRunCursor].sourceOrder < end
    ) {
      sectionRuns.push(textRuns[textRunCursor]);
      textRunCursor += 1;
    }
    textRunsBySection.set(descriptor.key, sectionRuns);
  });

  const bucketElementsBySection = (
    candidates: readonly Element[],
  ): Map<string, Element[]> => {
    const buckets = new Map(
      descriptors.map((descriptor) => [descriptor.key, [] as Element[]]),
    );
    let descriptorIndex = 0;
    for (const element of candidates) {
      const order = orders.get(element) ?? 0;
      while (
        descriptorIndex + 1 < descriptors.length &&
        order > descriptors[descriptorIndex + 1].start
      ) {
        descriptorIndex += 1;
      }
      const descriptor = descriptors[descriptorIndex];
      const end =
        descriptors[descriptorIndex + 1]?.start ?? Number.POSITIVE_INFINITY;
      if (order > descriptor.start && order < end) {
        buckets.get(descriptor.key)!.push(element);
      }
    }
    return buckets;
  };
  const semanticElementsBySection = bucketElementsBySection(semanticElements);
  const linkElementsBySection = bucketElementsBySection(linkElements);
  const citationLinksBySection = bucketElementsBySection(citationLinkElements);

  const roleByKey = new Map<string, MediaWikiSectionRole>();
  return descriptors.map((descriptor) => {
    const sectionTextRuns = textRunsBySection.get(descriptor.key) ?? [];
    const blocks = [
      ...(semanticElementsBySection.get(descriptor.key) ?? []).flatMap(
        (element) => {
          const block = blockFromElement(
            element,
            descriptor.key,
            orders,
            issues,
            language,
            extensionCache,
          );
          return block ? [block] : [];
        },
      ),
      ...sectionTextRuns.flatMap((run) =>
        run.covered
          ? []
          : [
              {
                ...makeBlockBase(
                  descriptor.key,
                  "prose",
                  run.sourceOrder,
                  run.text,
                ),
                kind: "prose" as const,
                role: "paragraph" as const,
                text: run.text,
              },
            ],
      ),
    ].sort((left, right) => left.sourceOrder - right.sourceOrder);
    const inheritedEndMatter = descriptor.parentKey
      ? roleByKey.get(descriptor.parentKey) === "end-matter"
      : false;
    const role: MediaWikiSectionRole =
      inheritedEndMatter ||
      END_MATTER_TITLES.has(normalizeTitle(descriptor.title))
        ? "end-matter"
        : "body";
    roleByKey.set(descriptor.key, role);
    const fallbackText = normalizeText(
      sectionTextRuns.map((run) => run.text).join(" "),
    );
    const links = (linkElementsBySection.get(descriptor.key) ?? []).flatMap(
      (element) => {
        const link = articleLinkFromElement(element, language, orders);
        return link ? [link] : [];
      },
    );
    const citationIds = (citationLinksBySection.get(descriptor.key) ?? [])
      .flatMap((element) => {
        const id = citationIdFromHref(attribute(element, "href"));
        return id ? [id] : [];
      })
      .filter((id, idIndex, ids) => ids.indexOf(id) === idIndex);
    return {
      key: descriptor.key,
      title: descriptor.title,
      level: descriptor.level,
      sourceOrder:
        descriptor.key === "__summary__" ? 0 : Math.max(0, descriptor.start),
      ...(descriptor.parentKey ? { parentKey: descriptor.parentKey } : {}),
      ...(descriptor.anchor ? { anchor: descriptor.anchor } : {}),
      role,
      fidelity: blocks.some(
        (block) => block.kind === "unsupported" && block.affectsNarration,
      )
        ? "partial"
        : "complete",
      plaintextContent: fallbackText,
      fallback: { text: fallbackText, source: "dom-text" },
      blocks,
      links,
      citationIds,
    } satisfies MediaWikiDocumentSection;
  });
};

const parseToc = (value: unknown): TocEntry[] => {
  const root =
    isRecord(value) && Array.isArray(value.sections) ? value.sections : value;
  if (!Array.isArray(root)) return [];
  return root.flatMap((entry) => {
    if (!isRecord(entry)) return [];
    const index = String(entry.index ?? "").trim();
    const rawLine = String(entry.line ?? "");
    const line = textContent(parseFragment(rawLine));
    const rawLevel = Number(entry.level);
    if (!index || !line) return [];
    return [
      {
        index,
        line,
        level: Number.isSafeInteger(rawLevel) && rawLevel > 0 ? rawLevel : 1,
        ...(typeof entry.anchor === "string" && entry.anchor
          ? { anchor: entry.anchor }
          : {}),
      },
    ];
  });
};

const extractParsedHtml = (value: unknown): string | null => {
  if (typeof value === "string") return value;
  if (isRecord(value) && typeof value["*"] === "string") return value["*"];
  return null;
};

const parseResponsePayload = (
  value: unknown,
  request: MediaWikiRevisionRequest,
): { html: string; toc: TocEntry[] } => {
  if (!isRecord(value) || !isRecord(value.parse)) {
    throw new MediaWikiSourceError({
      code: "invalid-response",
      message: "Wikipedia returned no parse data",
      retryable: true,
    });
  }
  const parsed = value.parse;
  const pageId = normalizeMediaWikiNumericId(parsed.pageid);
  const revisionId = normalizeMediaWikiNumericId(parsed.revid);
  const title = typeof parsed.title === "string" ? parsed.title : "";
  if (
    pageId !== request.wikiPageId ||
    revisionId !== request.revisionId ||
    normalizeTitle(title) !== normalizeTitle(request.title)
  ) {
    throw new MediaWikiSourceError({
      code: "identity-mismatch",
      message: "Wikipedia returned a different page or revision",
      statusCode: 409,
    });
  }
  const html = extractParsedHtml(parsed.text);
  if (html == null) {
    throw new MediaWikiSourceError({
      code: "invalid-response",
      message: "Wikipedia returned no parsed HTML",
      retryable: true,
    });
  }
  return {
    html,
    toc: parseToc(parsed.tocdata ?? parsed.sections),
  };
};

const readLimitedResponse = async (response: Response): Promise<unknown> => {
  const declaredLength = Number(response.headers.get("content-length"));
  if (Number.isFinite(declaredLength) && declaredLength > MAX_RESPONSE_BYTES) {
    throw new MediaWikiSourceError({
      code: "response-too-large",
      message: "Wikipedia response exceeded the safe size limit",
      statusCode: 502,
    });
  }
  let text: string;
  if (response.body) {
    const reader = response.body.getReader();
    const decoder = new TextDecoder();
    const chunks: string[] = [];
    let bytes = 0;
    while (true) {
      const { value, done } = await reader.read();
      if (done) break;
      bytes += value.byteLength;
      if (bytes > MAX_RESPONSE_BYTES) {
        await reader.cancel();
        throw new MediaWikiSourceError({
          code: "response-too-large",
          message: "Wikipedia response exceeded the safe size limit",
          statusCode: 502,
        });
      }
      chunks.push(decoder.decode(value, { stream: true }));
    }
    chunks.push(decoder.decode());
    text = chunks.join("");
  } else {
    text = await response.text();
    if (new TextEncoder().encode(text).byteLength > MAX_RESPONSE_BYTES) {
      throw new MediaWikiSourceError({
        code: "response-too-large",
        message: "Wikipedia response exceeded the safe size limit",
        statusCode: 502,
      });
    }
  }
  try {
    return JSON.parse(text);
  } catch {
    throw new MediaWikiSourceError({
      code: "invalid-response",
      message: "Wikipedia returned invalid JSON",
      retryable: true,
    });
  }
};

const isParsoidRejection = (payload: unknown): boolean => {
  if (!isRecord(payload) || !isRecord(payload.error)) return false;
  const code = String(payload.error.code ?? "").toLocaleLowerCase();
  const info = String(payload.error.info ?? "").toLocaleLowerCase();
  return (
    [
      "badvalue",
      "invalidparammix",
      "unknown_parameter",
      "unknownparameter",
    ].includes(code) && info.includes("parser")
  );
};

const fetchParseAttempt = async (
  request: MediaWikiRevisionRequest,
  options: LoadMediaWikiDocumentOptions,
  format: "parsoid" | "legacy",
): Promise<ParsedSource> => {
  throwIfAborted(options.signal);
  const fetchImpl = options.fetchImpl ?? fetch;
  const endpoint = new URL(
    `https://${request.language}.wikipedia.org${WIKIPEDIA_API_PATH}`,
  );
  const params: Record<string, string> = {
    action: "parse",
    format: "json",
    formatversion: "2",
    oldid: request.revisionId,
    prop: format === "parsoid" ? "text|tocdata|revid" : "text|sections|revid",
    disableeditsection: "1",
    disablelimitreport: "1",
    origin: "*",
  };
  if (format === "parsoid") params.parser = "parsoid";
  endpoint.search = new URLSearchParams(params).toString();

  const timeoutController = new AbortController();
  const timeout = setTimeout(() => timeoutController.abort(), FETCH_TIMEOUT_MS);
  const abort = () => timeoutController.abort(options.signal?.reason);
  options.signal?.addEventListener("abort", abort, { once: true });
  try {
    const response = await fetchImpl(endpoint, {
      headers: { "User-Agent": USER_AGENT, Accept: "application/json" },
      signal: timeoutController.signal,
      cache: "no-store",
    });
    const payload = await readLimitedResponse(response);
    if (!response.ok) {
      if (
        format === "parsoid" &&
        response.status === 400 &&
        isParsoidRejection(payload)
      ) {
        throw new ParsoidRejectedError("Wikipedia rejected the Parsoid parser");
      }
      throw new MediaWikiSourceError({
        code: response.status === 404 ? "not-found" : "http-error",
        message: `Wikipedia parse request returned HTTP ${response.status}`,
        retryable: response.status >= 500,
        statusCode: response.status === 404 ? 404 : 502,
      });
    }
    if (format === "parsoid" && isParsoidRejection(payload)) {
      throw new ParsoidRejectedError("Wikipedia rejected the Parsoid parser");
    }
    const parsed = parseResponsePayload(payload, request);
    return { ...parsed, format };
  } catch (error) {
    if (options.signal?.aborted) {
      throw options.signal.reason ?? error;
    }
    if (error instanceof ParsoidRejectedError) throw error;
    if (error instanceof MediaWikiSourceError) throw error;
    const timedOut =
      timeoutController.signal.aborted && !options.signal?.aborted;
    throw new MediaWikiSourceError({
      code: timedOut ? "timeout" : "http-error",
      message: timedOut
        ? "Wikipedia parse request timed out"
        : "Wikipedia parse request failed",
      retryable: true,
    });
  } finally {
    clearTimeout(timeout);
    options.signal?.removeEventListener("abort", abort);
  }
};

const fetchParsedSource = async (
  request: MediaWikiRevisionRequest,
  options: LoadMediaWikiDocumentOptions,
): Promise<ParsedSource> => {
  try {
    return await fetchParseAttempt(request, options, "parsoid");
  } catch (error) {
    if (!(error instanceof ParsoidRejectedError)) throw error;
    return await fetchParseAttempt(request, options, "legacy");
  }
};

const validateRequest = (
  request: MediaWikiRevisionRequest,
): MediaWikiRevisionRequest => {
  const wikiPageId = normalizeMediaWikiNumericId(request.wikiPageId);
  const revisionId = normalizeMediaWikiNumericId(request.revisionId);
  if (
    !wikiPageId ||
    !revisionId ||
    !normalizeText(request.title) ||
    request.language !== "en"
  ) {
    throw new MediaWikiSourceError({
      code: "invalid-request",
      message:
        "A valid English Wikipedia page and revision identity is required",
      statusCode: 400,
    });
  }
  return {
    wikiPageId,
    revisionId,
    title: normalizeText(request.title),
    language: "en",
  };
};

const buildPlaintextSections = (
  input: NonNullable<MediaWikiDocumentRequest["plaintext"]>,
): MediaWikiDocumentSection[] => {
  const descriptors: Array<{
    key: string;
    title: string;
    level: number;
    text: string;
    sourceOrder: number;
    parentKey?: string;
  }> = [
    {
      key: "__summary__" as const,
      title: "Summary",
      level: 0,
      text: input.lead,
      sourceOrder: 0,
      parentKey: undefined,
    },
  ];
  const hierarchy: Array<{ key: string; level: number }> = [
    { key: "__summary__", level: 0 },
  ];
  input.sections.forEach((section, index) => {
    const key = String(section.index).trim();
    const title = normalizeText(section.title);
    const level =
      Number.isSafeInteger(section.level) && section.level > 0
        ? section.level
        : 1;
    if (!key || !title) return;
    while (
      hierarchy.length > 1 &&
      hierarchy[hierarchy.length - 1].level >= level
    ) {
      hierarchy.pop();
    }
    const parentKey = hierarchy.at(-1)?.key ?? "__summary__";
    descriptors.push({
      key,
      title,
      level,
      text: section.text,
      sourceOrder: (index + 1) * 2,
      parentKey,
    });
    hierarchy.push({ key, level });
  });

  const roleByKey = new Map<string, MediaWikiSectionRole>();
  return descriptors.map((descriptor) => {
    const inheritedEndMatter = descriptor.parentKey
      ? roleByKey.get(descriptor.parentKey) === "end-matter"
      : false;
    const role: MediaWikiSectionRole =
      inheritedEndMatter ||
      END_MATTER_TITLES.has(normalizeTitle(descriptor.title))
        ? "end-matter"
        : "body";
    roleByKey.set(descriptor.key, role);
    const blocks: MediaWikiBlock[] = descriptor.text
      ? [
          {
            ...makeBlockBase(
              descriptor.key,
              "prose",
              descriptor.sourceOrder + 1,
              descriptor.text,
            ),
            kind: "prose",
            role: "paragraph",
            text: descriptor.text,
          },
        ]
      : [];
    return {
      key: descriptor.key,
      title: descriptor.title,
      level: descriptor.level,
      sourceOrder: descriptor.sourceOrder,
      ...(descriptor.parentKey ? { parentKey: descriptor.parentKey } : {}),
      role,
      fidelity: "plaintext",
      plaintextContent: descriptor.text,
      fallback: {
        text: descriptor.text,
        source: "mediawiki-plaintext",
      },
      blocks,
      links: [],
      citationIds: [],
    } satisfies MediaWikiDocumentSection;
  });
};

const plaintextDocument = (
  request: MediaWikiRevisionRequest,
  plaintext: NonNullable<MediaWikiDocumentRequest["plaintext"]>,
  fallbackReason: MediaWikiDocument["fallbackReason"],
  extraIssues: readonly MediaWikiDocumentIssueCode[] = [],
): MediaWikiDocument => {
  const sections = buildPlaintextSections(plaintext);
  const citations: MediaWikiCitation[] = [];
  const sourceHash = semanticSourceHash(
    request,
    "plaintext",
    sections,
    citations,
  );
  const issues = [
    { code: "parse-fallback" as const, severity: "fallback" as const },
    ...extraIssues.map(
      (code): MediaWikiDocumentIssue => ({ code, severity: "fallback" }),
    ),
  ];
  const withoutHash = {
    schemaVersion: MEDIAWIKI_DOCUMENT_SCHEMA_VERSION,
    identity: request,
    sourceFormat: "plaintext" as const,
    fallbackReason,
    sourceHash,
    sections,
    citations,
    issues,
  };
  return {
    ...withoutHash,
    documentHash: semanticDocumentHash(sourceHash, fallbackReason, issues),
  };
};

const alignSectionPlaintext = (
  sections: MediaWikiDocumentSection[],
  plaintext: NonNullable<MediaWikiDocumentRequest["plaintext"]>,
): MediaWikiDocumentSection[] | null => {
  const sourceByIndex = new Map<string, { title: string; text: string }>();
  for (const section of plaintext.sections) {
    const index = String(section.index).trim();
    if (!index || sourceByIndex.has(index)) return null;
    sourceByIndex.set(index, {
      title: normalizeText(section.title),
      text: section.text,
    });
  }
  const usesParsoidSectionIdentity = sections.some(
    (section) => section.sourceSectionIndex != null,
  );
  if (!usesParsoidSectionIdentity) {
    const structuredKeys = new Set(
      sections
        .filter((section) => section.key !== "__summary__")
        .map((section) => section.key),
    );
    if (
      sourceByIndex.size !== structuredKeys.size ||
      [...sourceByIndex.keys()].some((key) => !structuredKeys.has(key))
    ) {
      return null;
    }
    const legacyAligned: MediaWikiDocumentSection[] = [];
    for (const section of sections) {
      const source =
        section.key === "__summary__"
          ? { title: "Summary", text: plaintext.lead }
          : sourceByIndex.get(section.key);
      if (!source || source.title !== normalizeText(section.title)) return null;
      legacyAligned.push({ ...section, plaintextContent: source.text });
    }
    return legacyAligned;
  }
  const tocSections = sections.filter(
    (section) => section.key !== "__summary__" && section.tocIndex != null,
  );
  if (sourceByIndex.size !== tocSections.length) return null;

  const aligned: MediaWikiDocumentSection[] = [];
  let sourceCursor = 0;
  const orderedSources = [...sourceByIndex.entries()];
  for (const section of sections) {
    if (section.key === "__summary__") {
      aligned.push({ ...section, plaintextContent: plaintext.lead });
      continue;
    }
    if (section.tocIndex == null) {
      aligned.push(section);
      continue;
    }
    const [sourceIndex, source] = orderedSources[sourceCursor] ?? [];
    sourceCursor += 1;
    if (
      !source ||
      source.title !== normalizeText(section.title) ||
      (section.sourceSectionIndex !== "-1" && section.key !== sourceIndex)
    ) {
      return null;
    }
    aligned.push({
      ...section,
      plaintextContent: source.text,
    });
  }
  return aligned;
};

type ParsedDocumentState = {
  root: ParentNode;
  parseRecovered: boolean;
  semanticIssues: MediaWikiDocumentIssue[];
  limitIssue: "node-limit" | "depth-limit" | null;
  sections: MediaWikiDocumentSection[];
};

const parseDocumentSource = (
  source: ParsedSource,
  request: MediaWikiRevisionRequest,
): ParsedDocumentState => {
  let parseRecovered = false;
  const semanticIssues: MediaWikiDocumentIssue[] = [];
  const root = parse(source.html, {
    onParseError: (error) => {
      if (!parseRecovered && isSourceRecoveryError(error)) {
        parseRecovered = true;
      }
    },
  });
  const limitIssue = domLimitIssue(root);
  if (limitIssue) {
    return { root, parseRecovered, semanticIssues, limitIssue, sections: [] };
  }
  const orders = nodeOrders(root);
  const extensionCache: ExtensionParseCache = new WeakMap();
  const sections =
    source.format === "parsoid"
      ? parseSectionsFromParsoid({
          root,
          toc: source.toc,
          orders,
          language: request.language,
          issues: semanticIssues,
          extensionCache,
        })
      : parseSectionsFromLegacy({
          root,
          toc: source.toc,
          orders,
          language: request.language,
          issues: semanticIssues,
          extensionCache,
        });
  return { root, parseRecovered, semanticIssues, limitIssue: null, sections };
};

const hasCompleteParsoidContract = (
  sections: readonly MediaWikiDocumentSection[],
  toc: readonly TocEntry[],
): boolean => {
  if (
    sections.length === 0 ||
    sections[0].key !== "__summary__" ||
    sections.filter((section) => section.key === "__summary__").length !== 1
  ) {
    return false;
  }
  const sectionKeys = sections
    .filter((section) => section.key !== "__summary__")
    .map((section) => section.key);
  const tocSections = sections.filter((section) => section.tocIndex != null);
  if (
    new Set(sectionKeys).size !== sectionKeys.length ||
    tocSections.length !== toc.length ||
    sections.some(
      (section) =>
        section.sourceSectionIndex != null &&
        isDecimalToken(section.sourceSectionIndex) &&
        section.sourceSectionIndex !== "0" &&
        section.tocIndex == null,
    )
  ) {
    return false;
  }
  return tocSections.every((section, index) => {
    const tocEntry = toc[index];
    return (
      section.tocIndex === tocEntry?.index &&
      normalizeTitle(section.title) === normalizeTitle(tocEntry.line)
    );
  });
};

export const loadMediaWikiDocument = async (
  input: MediaWikiDocumentRequest,
  options: LoadMediaWikiDocumentOptions = {},
): Promise<MediaWikiDocument> => {
  const request = validateRequest(input);
  throwIfAborted(options.signal);
  let source: ParsedSource;
  try {
    source = await fetchParsedSource(request, options);
  } catch (error) {
    if (
      error instanceof MediaWikiSourceError &&
      error.code === "identity-mismatch"
    ) {
      throw error;
    }
    if (options.signal?.aborted) throw error;
    if (input.plaintext) {
      return plaintextDocument(
        request,
        input.plaintext,
        error instanceof MediaWikiSourceError &&
          error.code === "response-too-large"
          ? "document-limit"
          : "html-unavailable",
      );
    }
    throw error;
  }
  const documentLimitFallback = (
    issue: "node-limit" | "depth-limit",
  ): MediaWikiDocument => {
    if (input.plaintext) {
      return plaintextDocument(request, input.plaintext, "document-limit", [
        issue,
      ]);
    }
    throw new MediaWikiSourceError({
      code: "response-too-large",
      message: "Wikipedia HTML exceeded the safe document complexity limit",
    });
  };
  const legacyFailureFallback = (error: unknown): MediaWikiDocument => {
    if (
      error instanceof MediaWikiSourceError &&
      error.code === "identity-mismatch"
    ) {
      throw error;
    }
    if (options.signal?.aborted) throw error;
    if (input.plaintext) {
      return plaintextDocument(
        request,
        input.plaintext,
        "unsupported-html-contract",
      );
    }
    throw error;
  };

  let state = parseDocumentSource(source, request);
  if (state.limitIssue) return documentLimitFallback(state.limitIssue);
  if (
    source.format === "parsoid" &&
    !hasCompleteParsoidContract(state.sections, source.toc)
  ) {
    try {
      source = await fetchParseAttempt(request, options, "legacy");
    } catch (error) {
      return legacyFailureFallback(error);
    }
    state = parseDocumentSource(source, request);
    if (state.limitIssue) return documentLimitFallback(state.limitIssue);
  }
  let sections = state.sections;
  if (input.plaintext) {
    let aligned = alignSectionPlaintext(sections, input.plaintext);
    if (!aligned && source.format === "parsoid") {
      try {
        source = await fetchParseAttempt(request, options, "legacy");
      } catch (error) {
        return legacyFailureFallback(error);
      }
      state = parseDocumentSource(source, request);
      if (state.limitIssue) return documentLimitFallback(state.limitIssue);
      sections = state.sections;
      aligned = alignSectionPlaintext(sections, input.plaintext);
    }
    if (!aligned) {
      return plaintextDocument(
        request,
        input.plaintext,
        "section-alignment-failed",
        ["unmatched-section"],
      );
    }
    sections = aligned;
  }
  const issues: MediaWikiDocumentIssue[] = [
    ...(state.parseRecovered
      ? ([
          {
            code: "parse-recovery",
            severity: "skipped",
          },
        ] satisfies MediaWikiDocumentIssue[])
      : []),
    ...state.semanticIssues,
  ];
  const citations = collectCitations(state.root, request.language);
  const sourceHash = semanticSourceHash(
    request,
    source.format,
    sections,
    citations,
  );
  const withoutHash = {
    schemaVersion: MEDIAWIKI_DOCUMENT_SCHEMA_VERSION,
    identity: request,
    sourceFormat: source.format,
    sourceHash,
    sections,
    citations,
    issues,
  } as const;
  return {
    ...withoutHash,
    documentHash: semanticDocumentHash(sourceHash, undefined, issues),
  };
};
