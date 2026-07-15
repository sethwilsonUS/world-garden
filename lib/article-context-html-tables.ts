import { type ContextSection } from "./article-context-types";
import {
  parseAttributes,
  sanitizeContextCaption,
  sanitizeContextText,
  sectionAtOffset,
  type SectionBoundary,
} from "./article-context-foundations";
import {
  MAX_TABLE_CELLS,
  MAX_TABLE_COLUMNS,
  MAX_TABLE_ROWS,
} from "./article-context-limits";

export type ParsedHtmlTable = {
  caption: string;
  context: string;
  headers: string[];
  rows: string[][];
  position: number;
  section: ContextSection;
};

type ParsedHtmlTableCell = {
  value: string;
  isHeader: boolean;
  colspan: number;
  rowspan: number;
};

type ParsedHtmlTableRow = {
  cells: ParsedHtmlTableCell[];
  headerCount: number;
};

const parseTableSpan = (value: string | undefined, maximum: number): number | null => {
  if (value == null) return 1;
  if (!/^\d+$/.test(value)) return null;
  const parsed = Number(value);
  return Number.isSafeInteger(parsed) && parsed >= 1 && parsed <= maximum
    ? parsed
    : null;
};

const sanitizeTableCellText = (value: string): string =>
  sanitizeContextText(
    value
      .replace(
        /<(?:div|span)\b[^>]*class\s*=\s*(["'])[^"']*\b(?:navbar|mw-editsection)\b[^"']*\1[^>]*>[\s\S]*?<\/(?:div|span)>/gi,
        " ",
      )
      .replace(
        /<abbr\b([^>]*)>([\s\S]*?)<\/abbr>/gi,
        (_match, attributeSource: string, inner: string) =>
          parseAttributes(attributeSource).title || inner,
      ),
    1_000,
  );

const precedingTableParagraphContext = (
  html: string,
  position: number,
  boundaries: SectionBoundary[],
): string => {
  let sectionStart = 0;
  for (const boundary of boundaries) {
    if (boundary.start > position) break;
    sectionStart = boundary.start;
  }
  const boundedStart = Math.max(sectionStart, position - 4_000);
  const prefix = html.slice(boundedStart, position);
  const paragraphs = [...prefix.matchAll(/<p\b[^>]*>([\s\S]*?)<\/p>/gi)];
  const nearest = paragraphs.at(-1);
  if (!nearest) return "";
  const paragraphEnd = (nearest.index ?? 0) + nearest[0].length;
  // Avoid borrowing prose from a distant part of a long section.
  if (prefix.length - paragraphEnd > 1_200) return "";
  return sanitizeContextText(nearest[1], 600);
};

/**
 * Expand simple rowspans into a rectangular data grid. Wikipedia standings
 * commonly group a shared outcome (for example, "Eliminated in quarterfinals")
 * across several rows. Reject unsupported or malformed geometry as a whole so
 * a chart can never be built from only the fragment that happened to be flat.
 */
const normalizeTableDataRows = (
  rows: ParsedHtmlTableRow[],
  width: number,
): string[][] | null => {
  const activeSpans = new Map<
    number,
    { value: string; remainingRows: number }
  >();
  const normalizedRows: string[][] = [];

  for (const row of rows) {
    const values: Array<string | undefined> = Array.from({ length: width });
    for (const [columnIndex, span] of activeSpans) {
      if (columnIndex >= width || values[columnIndex] !== undefined) return null;
      values[columnIndex] = span.value;
      span.remainingRows -= 1;
      if (span.remainingRows === 0) activeSpans.delete(columnIndex);
    }

    let cursor = 0;
    for (const cell of row.cells) {
      // Multi-column cells require a full header/grid association algorithm.
      // Declining those tables is safer than guessing which metric they mean.
      if (cell.colspan !== 1) return null;
      while (cursor < width && values[cursor] !== undefined) cursor += 1;
      if (cursor >= width) return null;
      values[cursor] = cell.value;
      if (cell.rowspan > 1) {
        if (activeSpans.has(cursor)) return null;
        activeSpans.set(cursor, {
          value: cell.value,
          remainingRows: cell.rowspan - 1,
        });
      }
      cursor += 1;
    }

    if (values.some((value) => value === undefined)) return null;
    normalizedRows.push(values as string[]);
  }

  return activeSpans.size === 0 ? normalizedRows : null;
};

export const parseWikitables = (
  html: string,
  boundaries: SectionBoundary[],
): ParsedHtmlTable[] => {
  const tables: ParsedHtmlTable[] = [];
  for (const tableMatch of html.matchAll(/<table\b([^>]*)>([\s\S]*?)<\/table>/gi)) {
    const attrs = parseAttributes(tableMatch[1]);
    if (!/(?:^|\s)wikitable(?:\s|$)/i.test(attrs.class ?? "")) continue;
    const body = tableMatch[2];
    if (/<table\b/i.test(body)) continue;
    const captionMatch = body.match(/<caption\b[^>]*>([\s\S]*?)<\/caption>/i);
    const caption = captionMatch
      ? sanitizeContextCaption(captionMatch[1], 300)
      : "";
    const parsedRows: ParsedHtmlTableRow[] = [];
    let malformedSpan = false;
    for (const rowMatch of body.matchAll(/<tr\b[^>]*>([\s\S]*?)<\/tr>/gi)) {
      const cells: ParsedHtmlTableCell[] = [];
      let headerCount = 0;
      for (const cellMatch of rowMatch[1].matchAll(
        /<(th|td)\b([^>]*)>([\s\S]*?)<\/\1>/gi,
      )) {
        const cellAttrs = parseAttributes(cellMatch[2]);
        const colspan = parseTableSpan(cellAttrs.colspan, MAX_TABLE_COLUMNS);
        const rowspan = parseTableSpan(cellAttrs.rowspan, MAX_TABLE_ROWS);
        if (colspan == null || rowspan == null) {
          malformedSpan = true;
          continue;
        }
        const isHeader = cellMatch[1].toLowerCase() === "th";
        if (isHeader) headerCount += 1;
        cells.push({
          value: sanitizeTableCellText(cellMatch[3]),
          isHeader,
          colspan,
          rowspan,
        });
      }
      if (cells.length > 0) parsedRows.push({ cells, headerCount });
    }
    if (malformedSpan) continue;
    const headerIndex = parsedRows.findIndex(
      (row) =>
        row.cells.every((cell) => cell.colspan === 1 && cell.rowspan === 1) &&
        row.cells.length >= 2 &&
        row.cells.length <= MAX_TABLE_COLUMNS &&
        row.headerCount >= Math.ceil(row.cells.length / 2),
    );
    if (headerIndex < 0) continue;
    const headers = parsedRows[headerIndex].cells.map((cell) => cell.value);
    if (new Set(headers.map((header) => header.toLowerCase())).size !== headers.length) {
      continue;
    }
    const normalizedDataRows = normalizeTableDataRows(
      parsedRows.slice(headerIndex + 1),
      headers.length,
    );
    if (!normalizedDataRows) continue;
    const rows = normalizedDataRows
      .filter(
        (row) =>
          row.length === headers.length &&
          row.some(Boolean) &&
          row.some(
            (value, index) => value.toLowerCase() !== headers[index].toLowerCase(),
          ),
      )
      .slice(0, MAX_TABLE_ROWS + 1)
      .map((row) => row);
    if (
      rows.length < 3 ||
      rows.length > MAX_TABLE_ROWS ||
      rows.length * headers.length > MAX_TABLE_CELLS
    ) {
      continue;
    }
    const position = tableMatch.index ?? 0;
    tables.push({
      caption,
      context: precedingTableParagraphContext(html, position, boundaries),
      headers,
      rows,
      position,
      section: sectionAtOffset(boundaries, position),
    });
  }
  return tables;
};
