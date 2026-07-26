import type {
  MediaWikiDocument,
  MediaWikiDocumentSection,
  MediaWikiList,
  MediaWikiTableBlock,
  MediaWikiTableCell,
} from "./mediawiki-document";
import {
  MAX_STRUCTURED_NARRATION_WORDS,
  hashNarrationText,
  type NarratedSection,
  type SectionNarration,
  type SectionNarrationSourceFormat,
} from "./section-narration";

type NarrationUnit = {
  text: string;
  sourceItems: number;
  adapted: boolean;
};

const normalizeSpaces = (value: string): string =>
  value.replace(/\s+/g, " ").trim();

const wordCount = (value: string): number =>
  normalizeSpaces(value) ? normalizeSpaces(value).split(" ").length : 0;

const sourceHash = (
  document: MediaWikiDocument,
  section: MediaWikiDocumentSection,
  text: string,
): string =>
  hashNarrationText(
    [
      document.identity.revisionId,
      section.key,
      document.documentHash,
      text,
    ].join("\u0000"),
  );

const listText = (list: MediaWikiList): string =>
  list.items
    .flatMap((item) =>
      item.parts.map((part) =>
        part.kind === "text" ? part.text : listText(part.list),
      ),
    )
    .filter(Boolean)
    .join(" ");

const semanticSectionText = (section: MediaWikiDocumentSection): string =>
  normalizeSpaces(
    [...section.blocks]
      .sort((left, right) => left.sourceOrder - right.sourceOrder)
      .flatMap((block) => {
        if (block.kind === "prose") return [block.text];
        if (block.kind === "list") return [listText(block.list)];
        if (block.kind === "table") {
          return [
            block.table.caption,
            ...[...block.table.cells]
              .sort(
                (left, right) =>
                  left.originRow - right.originRow ||
                  left.originColumn - right.originColumn,
              )
              .map((cell) => cell.text),
          ];
        }
        if (block.kind === "figure") {
          return [
            block.caption,
            ...block.media.map((media) => media.alt),
            ...block.regions.map((region) => region.label),
          ];
        }
        return [];
      })
      .filter(Boolean)
      .join(" "),
  );

const sectionSourceText = (
  section: MediaWikiDocumentSection,
  preferPlaintext: boolean,
): string => {
  const plaintext = normalizeSpaces(section.plaintextContent);
  const completeFallback = normalizeSpaces(section.fallback.text);
  const semantic = semanticSectionText(section);
  return preferPlaintext
    ? plaintext || completeFallback || semantic
    : completeFallback || plaintext || semantic;
};

const listItemCount = (list: MediaWikiList): number =>
  list.items.reduce(
    (total, item) =>
      total +
      1 +
      item.parts.reduce(
        (nestedTotal, part) =>
          nestedTotal + (part.kind === "list" ? listItemCount(part.list) : 0),
        0,
      ),
    0,
  );

const sentence = (value: string): string => {
  const text = normalizeSpaces(value);
  return /[.!?]$/.test(text) ? text : `${text}.`;
};

const narrateList = (list: MediaWikiList): NarrationUnit[] => {
  const totalItems = listItemCount(list);
  if (totalItems === 0) return [];
  let globalOrdinal = 0;

  const serializeList = (
    source: MediaWikiList,
    parentLabel?: string,
  ): NarrationUnit[] => {
    const units: NarrationUnit[] = [];
    source.items.forEach((item, localIndex) => {
      globalOrdinal += 1;
      const label = String(
        source.style === "ordered"
          ? (source.start ?? 1) + localIndex
          : globalOrdinal,
      );
      const prefix = `Item ${label}${
        parentLabel ? `, nested under item ${parentLabel}` : ""
      }`;
      let introduced = false;
      for (const part of item.parts) {
        if (part.kind === "text") {
          const text = sentence(part.text);
          units.push({
            text: introduced
              ? `Continuing item ${label}: ${text}`
              : `${prefix}: ${text}`,
            sourceItems: introduced ? 0 : 1,
            adapted: true,
          });
          introduced = true;
          continue;
        }
        if (!introduced) {
          units.push({ text: `${prefix}.`, sourceItems: 1, adapted: true });
          introduced = true;
        }
        units.push(...serializeList(part.list, label));
      }
    });
    return units;
  };

  return [
    { text: `List with ${totalItems} items.`, sourceItems: 0, adapted: true },
    ...serializeList(list),
  ];
};

const narrateTable = (block: MediaWikiTableBlock): NarrationUnit[] => {
  const cells = new Map(block.table.cells.map((cell) => [cell.id, cell]));
  const resolvedRows = block.table.grid.map((row) =>
    row.map((cellId) => cells.get(cellId)),
  );
  if (resolvedRows.some((row) => row.some((cell) => !cell))) return [];
  const dataRows = resolvedRows.filter((row) =>
    row.some((cell) => cell?.kind === "data"),
  );
  if (dataRows.length === 0) return [];
  const isRowHeader = (
    cell: MediaWikiTableCell,
    row: MediaWikiTableCell[],
  ): boolean =>
    cell.kind === "header" &&
    (cell.scope === "row" ||
      cell.scope === "row-group" ||
      (cell.scope == null &&
        row.some(
          (candidate) =>
            candidate?.kind === "data" &&
            candidate.originRow === cell.originRow &&
            candidate.originColumn > cell.originColumn,
        )));
  const columnPath = (
    cell: MediaWikiTableCell,
    row: MediaWikiTableCell[],
    columnIndex: number,
  ): string[] => {
    const associated = cell.associatedHeaderCellIds
      .map((id) => cells.get(id))
      .filter(
        (header): header is MediaWikiTableCell =>
          header != null && !isRowHeader(header, row),
      )
      .map((header) => header.text)
      .filter(Boolean);
    if (associated.length > 0) return associated;
    const columnHeader = resolvedRows
      .map((candidateRow) => candidateRow[columnIndex])
      .find(
        (candidate) =>
          candidate?.kind === "header" &&
          candidate.originRow < cell.originRow &&
          !isRowHeader(candidate, row),
      );
    return columnHeader?.text ? [columnHeader.text] : [];
  };
  const firstDataRow = dataRows[0].filter((cell): cell is MediaWikiTableCell =>
    Boolean(cell),
  );
  const columnLabels = dataRows[0].map((cell, columnIndex) => {
    if (!cell) return `Column ${columnIndex + 1}`;
    const path = columnPath(cell, firstDataRow, columnIndex);
    return (
      path.join(" — ") ||
      (isRowHeader(cell, firstDataRow)
        ? "Row heading"
        : `Column ${columnIndex + 1}`)
    );
  });
  const units: NarrationUnit[] = [];
  if (block.table.caption) {
    units.push({
      text: `Table: ${block.table.caption}.`,
      sourceItems: 0,
      adapted: true,
    });
  } else {
    units.push({ text: "Table.", sourceItems: 0, adapted: true });
  }
  units.push({
    text: `Columns: ${columnLabels.join("; ")}.`,
    sourceItems: 0,
    adapted: true,
  });
  dataRows.forEach((row, rowIndex) => {
    const seenCellIds = new Set<string>();
    const uniqueCells = row.filter((cell): cell is MediaWikiTableCell =>
      Boolean(cell),
    );
    const rowHeaders: string[] = [];
    const values = row.flatMap((cell, columnIndex) => {
      if (!cell || seenCellIds.has(cell.id)) return [];
      seenCellIds.add(cell.id);
      if (isRowHeader(cell, uniqueCells)) {
        rowHeaders.push(cell.text);
        return [];
      }
      const header =
        columnPath(cell, uniqueCells, columnIndex).join(" — ") ||
        columnLabels[columnIndex];
      return [`${header}: ${cell.text}`];
    });
    if (rowHeaders.length > 0 || values.length > 0) {
      units.push({
        text: `Row ${rowIndex + 1}${
          rowHeaders.length > 0 ? `, ${rowHeaders.join(" — ")}` : ""
        }: ${values.join("; ") || "No data values"}.`,
        sourceItems: 1,
        adapted: true,
      });
    }
  });
  return units;
};

const sectionFormat = (
  section: MediaWikiDocumentSection,
): SectionNarrationSourceFormat => {
  const kinds = new Set<"prose" | "list" | "table">();
  for (const block of section.blocks) {
    if (block.kind === "prose") kinds.add("prose");
    else if (block.kind === "list") kinds.add("list");
    else if (block.kind === "table") kinds.add("table");
    else if (block.kind === "unsupported") {
      if (block.sourceKind === "table") kinds.add("table");
      if (block.sourceKind === "list") kinds.add("list");
    }
  }
  if (kinds.size > 1) return "mixed";
  if (kinds.has("table")) return "table";
  if (kinds.has("list")) return "list";
  return "prose";
};

const capUnits = (
  title: string,
  units: NarrationUnit[],
): { text: string; remainingSourceItems?: number } => {
  const kept: string[] = [`${title}.`];
  let adaptedWords = 0;
  let consumedItems = 0;
  let adaptationCapped = false;
  const totalItems = units.reduce((sum, unit) => sum + unit.sourceItems, 0);
  for (const unit of units) {
    if (!unit.adapted) {
      kept.push(unit.text);
      continue;
    }
    if (adaptationCapped) continue;
    const unitWords = wordCount(unit.text);
    if (adaptedWords + unitWords > MAX_STRUCTURED_NARRATION_WORDS) {
      adaptationCapped = true;
      continue;
    }
    kept.push(unit.text);
    adaptedWords += unitWords;
    consumedItems += unit.sourceItems;
  }
  const remainingSourceItems = totalItems - consumedItems;
  if (remainingSourceItems > 0) {
    kept.push(
      `${remainingSourceItems} additional source ${
        remainingSourceItems === 1 ? "item remains" : "items remain"
      }; the complete data is available in the Wikipedia article.`,
    );
  }
  return {
    text: normalizeSpaces(kept.join(" ")),
    ...(remainingSourceItems > 0 ? { remainingSourceItems } : {}),
  };
};

const rawNarration = (
  document: MediaWikiDocument,
  section: MediaWikiDocumentSection,
  usedRawFallback: boolean,
): SectionNarration => {
  const text = normalizeSpaces(
    `${section.title}. ${sectionSourceText(section, !usedRawFallback)}`,
  );
  return {
    mode: "verbatim",
    text,
    sourceFormat: sectionFormat(section),
    adapted: false,
    usedRawFallback,
    sourceHash: sourceHash(document, section, text),
  };
};

const structuredNarration = (
  document: MediaWikiDocument,
  section: MediaWikiDocumentSection,
): SectionNarration | null => {
  const units: NarrationUnit[] = [];
  let failedStructuredBlock = false;
  for (const block of [...section.blocks].sort(
    (left, right) => left.sourceOrder - right.sourceOrder,
  )) {
    if (block.kind === "prose") {
      const text = normalizeSpaces(block.text);
      if (text) units.push({ text, sourceItems: 0, adapted: false });
    } else if (block.kind === "list") {
      const narrated = narrateList(block.list);
      if (narrated.length === 0) failedStructuredBlock = true;
      units.push(...narrated);
    } else if (block.kind === "table") {
      const narrated = narrateTable(block);
      if (narrated.length === 0) failedStructuredBlock = true;
      units.push(...narrated);
    }
  }
  if (failedStructuredBlock) return null;
  const assembled = capUnits(section.title, units);
  return {
    mode: "structured",
    text: assembled.text,
    sourceFormat: sectionFormat(section),
    adapted: true,
    usedRawFallback: false,
    ...(assembled.remainingSourceItems != null
      ? { remainingSourceItems: assembled.remainingSourceItems }
      : {}),
    sourceHash: sourceHash(document, section, assembled.text),
  };
};

const headingNarration = (
  document: MediaWikiDocument,
  section: MediaWikiDocumentSection,
  hasChild: boolean,
): SectionNarration => {
  const text = hasChild ? `Next section: ${section.title}.` : "";
  return {
    mode: hasChild ? "transition" : "none",
    text,
    sourceFormat: "heading",
    adapted: false,
    usedRawFallback: false,
    sourceHash: sourceHash(document, section, text),
  };
};

export const createSectionNarrationsFromDocument = (
  document: MediaWikiDocument,
): NarratedSection[] => {
  const sections = document.sections.filter(
    (section) => section.key !== "__summary__" && section.role === "body",
  );
  return sections.map((section, index) => {
    const hasText = Boolean(
      section.fallback.text.trim() ||
      section.plaintextContent.trim() ||
      semanticSectionText(section),
    );
    const hasUnsupportedNarration = section.blocks.some(
      (block) => block.kind === "unsupported" && block.affectsNarration,
    );
    const hasChild =
      !hasText &&
      index + 1 < sections.length &&
      sections[index + 1].level > section.level;
    const format = sectionFormat(section);
    const narration = !hasText
      ? headingNarration(document, section, hasChild)
      : section.fidelity !== "complete" || hasUnsupportedNarration
        ? rawNarration(document, section, true)
        : format === "prose"
          ? rawNarration(document, section, false)
          : (structuredNarration(document, section) ??
            rawNarration(document, section, true));
    return {
      wikiSectionIndex: section.key,
      title: section.title,
      level: section.level,
      content: section.plaintextContent || section.fallback.text,
      narration,
    };
  });
};
