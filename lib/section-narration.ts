export const ARTICLE_SECTION_NARRATION_VERSION = 1 as const;
export const MAX_STRUCTURED_NARRATION_WORDS = 800;

export type SectionNarrationMode =
  | "verbatim"
  | "structured"
  | "transition"
  | "none";

export type SectionNarrationSourceFormat =
  | "prose"
  | "table"
  | "list"
  | "mixed"
  | "heading";

export type SectionNarration = {
  mode: SectionNarrationMode;
  text: string;
  sourceFormat: SectionNarrationSourceFormat;
  adapted: boolean;
  usedRawFallback: boolean;
  remainingSourceItems?: number;
  sourceHash: string;
};

export type SectionNarrationSource = {
  wikiSectionIndex: string;
  title: string;
  level: number;
  content: string;
};

export type NarratedSection = SectionNarrationSource & {
  narration: SectionNarration;
};

export type ParsedSectionNarrationSource = {
  html: string;
  sections: Array<{
    index: string;
    line: string;
    anchor?: string;
    level?: string;
  }>;
};

export type ArticleNarrationTrack = {
  sectionKey: string;
  sectionIdx: number | null;
  title: string;
  text: string;
  sourceHash: string;
  mode: "summary" | SectionNarrationMode;
  individuallyPlayable: boolean;
  countsTowardProgress: boolean;
};

export type ArticleNarrationSource = {
  title: string;
  summary?: string;
  sections?: Array<{
    wikiSectionIndex?: string;
    title: string;
    level: number;
    content: string;
    narration?: SectionNarration;
  }>;
};

const normalizeSpaces = (value: string): string =>
  value.replace(/\s+/g, " ").trim();

const decodeHtmlEntities = (value: string): string =>
  value
    .replace(/&#x([0-9a-f]+);?/gi, (_match, hex: string) =>
      String.fromCodePoint(Number.parseInt(hex, 16)),
    )
    .replace(/&#(\d+);?/g, (_match, decimal: string) =>
      String.fromCodePoint(Number.parseInt(decimal, 10)),
    )
    .replace(/&nbsp;/gi, " ")
    .replace(/&amp;/gi, "&")
    .replace(/&lt;/gi, "<")
    .replace(/&gt;/gi, ">")
    .replace(/&quot;/gi, '"')
    .replace(/&apos;|&#39;/gi, "'")
    .replace(/&ndash;/gi, "–")
    .replace(/&mdash;/gi, "—");

const sanitizeHtmlText = (value: string): string =>
  normalizeSpaces(
    decodeHtmlEntities(
      value
        .replace(/<(?:script|style|template|noscript)\b[^>]*>[\s\S]*?<\/\w+>/gi, " ")
        .replace(
          /<sup\b[^>]*class=(?:"[^"]*\breference\b[^"]*"|'[^']*\breference\b[^']*')[^>]*>[\s\S]*?<\/sup>/gi,
          " ",
        )
        .replace(
          /<(?:span|div)\b[^>]*class=(?:"[^"]*\bmw-editsection\b[^"]*"|'[^']*\bmw-editsection\b[^']*')[^>]*>[\s\S]*?<\/(?:span|div)>/gi,
          " ",
        )
        .replace(/<br\s*\/?>/gi, " ")
        .replace(/<[^>]+>/g, " "),
    ),
  );

const normalizeTitle = (value: string): string =>
  sanitizeHtmlText(value).toLocaleLowerCase();

const getParsedSectionHtml = (
  source: ParsedSectionNarrationSource,
): Map<string, string> => {
  const headings = [
    ...source.html.matchAll(/<h([2-6])\b[^>]*>([\s\S]*?)<\/h\1>/gi),
  ];
  const byIndex = new Map<string, string>();
  let sectionCursor = 0;

  for (let index = 0; index < headings.length; index += 1) {
    const heading = headings[index];
    const title = normalizeTitle(heading[2]);
    const parsedIndex = source.sections.findIndex(
      (section, candidateIndex) =>
        candidateIndex >= sectionCursor && normalizeTitle(section.line) === title,
    );
    if (parsedIndex < 0) continue;
    const start = (heading.index ?? 0) + heading[0].length;
    const end =
      index + 1 < headings.length
        ? (headings[index + 1].index ?? source.html.length)
        : source.html.length;
    byIndex.set(source.sections[parsedIndex].index, source.html.slice(start, end));
    sectionCursor = parsedIndex + 1;
  }

  return byIndex;
};

type StructuredBlock = {
  kind: "prose" | "list" | "table";
  prefix: string;
  units: string[];
};

const narrateList = (html: string): StructuredBlock | null => {
  const items: Array<{
    parts: string[];
    depth: number;
    parentIndex?: number;
  }> = [];
  const itemStack: number[] = [];
  let listDepth = 0;
  let malformed = false;

  for (const match of html.matchAll(/<[^>]+>|[^<]+/g)) {
    const token = match[0];
    const listTag = token.match(/^<\s*(\/?)\s*(ol|ul)\b[^>]*>/i);
    if (listTag) {
      if (listTag[1]) {
        if (listDepth === 0) malformed = true;
        else listDepth -= 1;
      } else {
        listDepth += 1;
      }
      continue;
    }

    const itemTag = token.match(/^<\s*(\/?)\s*li\b[^>]*>/i);
    if (itemTag) {
      if (itemTag[1]) {
        if (itemStack.length === 0) malformed = true;
        else itemStack.pop();
      } else {
        const parentIndex = itemStack.at(-1);
        const itemIndex = items.length;
        items.push({
          parts: [],
          depth: listDepth,
          ...(parentIndex != null ? { parentIndex } : {}),
        });
        itemStack.push(itemIndex);
      }
      continue;
    }

    const currentItem = itemStack.at(-1);
    if (currentItem != null && items[currentItem].depth === listDepth) {
      items[currentItem].parts.push(token);
    }
  }

  if (malformed || listDepth !== 0 || itemStack.length !== 0) return null;
  const narratedItems = items.map((item, index) => ({
    text: sanitizeHtmlText(item.parts.join("")),
    label:
      item.parentIndex == null
        ? `Item ${index + 1}`
        : `Item ${index + 1}, nested under item ${item.parentIndex + 1}`,
  }));
  if (
    narratedItems.length === 0 ||
    narratedItems.some((item) => !item.text)
  ) {
    return null;
  }
  return {
    kind: "list",
    prefix: `List with ${narratedItems.length} ${narratedItems.length === 1 ? "item" : "items"}.`,
    units: narratedItems.map((item) => `${item.label}: ${item.text}.`),
  };
};

const extractStructuredBlocks = (
  html: string,
): { blocks: Array<{ kind: string; html: string }>; malformed: boolean } => {
  const blocks: Array<{ kind: string; html: string }> = [];
  const stack: string[] = [];
  let root: { kind: string; start: number } | null = null;
  let malformed = false;

  for (const match of html.matchAll(/<\s*(\/?)\s*(p|ol|ul|table)\b[^>]*>/gi)) {
    const closing = Boolean(match[1]);
    const kind = match[2].toLowerCase();
    if (!closing) {
      if (stack.length === 0) {
        root = { kind, start: match.index ?? 0 };
      }
      stack.push(kind);
      continue;
    }

    if (stack.at(-1) !== kind) {
      malformed = true;
      continue;
    }
    stack.pop();
    if (stack.length === 0 && root) {
      blocks.push({
        kind: root.kind,
        html: html.slice(root.start, (match.index ?? 0) + match[0].length),
      });
      root = null;
    }
  }

  return { blocks, malformed: malformed || stack.length !== 0 };
};

const getAttribute = (source: string, name: string): string | undefined => {
  const match = source.match(
    new RegExp(`${name}\\s*=\\s*(?:"([^"]*)"|'([^']*)'|([^\\s>]+))`, "i"),
  );
  return match?.[1] ?? match?.[2] ?? match?.[3];
};

const narrateTable = (html: string): StructuredBlock | null => {
  if (
    /<(?:table|ol|ul|dl)\b/i.test(html.replace(/^<table\b[^>]*>/i, ""))
  ) {
    return null;
  }
  const rows = [...html.matchAll(/<tr\b[^>]*>([\s\S]*?)<\/tr>/gi)].map(
    (row) => [
      ...row[1].matchAll(/<(th|td)\b([^>]*)>([\s\S]*?)<\/\1>/gi),
    ].map((cell) => ({
      header: cell[1].toLowerCase() === "th",
      text: sanitizeHtmlText(cell[3]),
      colspan: getAttribute(cell[2], "colspan") ?? "1",
      rowspan: getAttribute(cell[2], "rowspan") ?? "1",
    })),
  );
  if (
    rows.some((row) =>
      row.some((cell) => cell.colspan !== "1" || cell.rowspan !== "1"),
    )
  ) {
    return null;
  }
  const headerIndex = rows.findIndex(
    (row) => row.length >= 2 && row.every((cell) => cell.header && cell.text),
  );
  if (headerIndex < 0) return null;
  const headers = rows[headerIndex].map((cell) => cell.text);
  const dataRows = rows
    .slice(headerIndex + 1)
    .filter((row) => row.some((cell) => Boolean(cell.text)));
  if (dataRows.some((row) => row.length !== headers.length)) return null;
  if (dataRows.length === 0) return null;
  const caption = sanitizeHtmlText(
    html.match(/<caption\b[^>]*>([\s\S]*?)<\/caption>/i)?.[1] ?? "",
  );
  const rowNarration = dataRows.map(
    (row, rowIndex) =>
      `Row ${rowIndex + 1}: ${row
        .map((cell, cellIndex) => `${headers[cellIndex]}: ${cell.text}`)
        .join("; ")}.`,
  );
  return {
    kind: "table",
    prefix: [
      caption ? `Table: ${caption}.` : "Table.",
      `Columns: ${headers.join("; ")}.`,
    ].join(" "),
    units: rowNarration,
  };
};

const countWords = (value: string): number =>
  value.split(/\s+/).filter(Boolean).length;

const REMAINDER_SUFFIX = (remaining: number): string =>
  `This audio adaptation omits ${remaining} remaining source ${
    remaining === 1 ? "row or item" : "rows or items"
  }; the complete data is available in the Wikipedia article.`;

const assembleStructuredBlocks = (
  title: string,
  blocks: StructuredBlock[],
): { text: string; remainingSourceItems?: number } => {
  const output = [`${title}.`];
  const structuralBlocks = blocks.filter((block) => block.kind !== "prose");
  const totalSourceItems = structuralBlocks.reduce(
    (total, block) => total + block.units.length,
    0,
  );
  let includedSourceItems = 0;
  let structuredWordCount = 0;
  let capped = false;

  for (const block of blocks) {
    if (block.kind === "prose") {
      if (block.prefix) output.push(block.prefix);
      continue;
    }
    if (capped) continue;

    const prefixWords = countWords(block.prefix);
    const remainingAfterPrefix = totalSourceItems - includedSourceItems;
    const prefixRemainderWords = countWords(REMAINDER_SUFFIX(remainingAfterPrefix));
    if (
      structuredWordCount + prefixWords + prefixRemainderWords >
      MAX_STRUCTURED_NARRATION_WORDS
    ) {
      capped = true;
      continue;
    }
    output.push(block.prefix);
    structuredWordCount += prefixWords;

    for (const unit of block.units) {
      const unitWords = countWords(unit);
      const remainingAfterUnit =
        totalSourceItems - (includedSourceItems + 1);
      const suffixWords = remainingAfterUnit
        ? countWords(REMAINDER_SUFFIX(remainingAfterUnit))
        : 0;
      if (
        structuredWordCount + unitWords + suffixWords >
        MAX_STRUCTURED_NARRATION_WORDS
      ) {
        capped = true;
        break;
      }
      output.push(unit);
      structuredWordCount += unitWords;
      includedSourceItems += 1;
    }
  }

  const remainingSourceItems = totalSourceItems - includedSourceItems;
  if (remainingSourceItems > 0) {
    output.push(REMAINDER_SUFFIX(remainingSourceItems));
  }
  return {
    text: normalizeSpaces(output.join(" ")),
    ...(remainingSourceItems > 0 ? { remainingSourceItems } : {}),
  };
};

const createStructuredNarration = (
  section: SectionNarrationSource,
  html: string,
): SectionNarration | null => {
  if (!/<(?:ol|ul|table)\b/i.test(html)) return null;
  const blocks: StructuredBlock[] = [];
  const extracted = extractStructuredBlocks(html);
  let failedStructure =
    extracted.malformed || /<(?:blockquote|dl|pre|math|gallery)\b/i.test(html);
  for (const sourceBlock of extracted.blocks) {
    const kind = sourceBlock.kind;
    if (kind === "p") {
      const text = sanitizeHtmlText(sourceBlock.html);
      if (text) blocks.push({ kind: "prose", prefix: text, units: [] });
      continue;
    }
    const block =
      kind === "table"
        ? narrateTable(sourceBlock.html)
        : narrateList(sourceBlock.html);
    if (!block) {
      failedStructure = true;
      break;
    }
    blocks.push(block);
  }

  const structuralKinds = new Set(
    blocks.filter((block) => block.kind !== "prose").map((block) => block.kind),
  );
  if (failedStructure || structuralKinds.size === 0) {
    const fallback = createVerbatimNarration(section);
    const hasTable = /<table\b/i.test(html);
    const hasList = /<(?:ol|ul)\b/i.test(html);
    const hasProse = /<p\b/i.test(html);
    return {
      ...fallback,
      sourceFormat:
        Number(hasTable) + Number(hasList) + Number(hasProse) > 1
          ? "mixed"
          : hasTable
            ? "table"
            : "list",
      usedRawFallback: true,
    };
  }

  const assembled = assembleStructuredBlocks(section.title, blocks);
  const text = assembled.text;
  const sourceFormat: SectionNarrationSourceFormat =
    structuralKinds.size > 1 || blocks.some((block) => block.kind === "prose")
      ? "mixed"
      : structuralKinds.has("table")
        ? "table"
        : "list";
  return {
    mode: "structured",
    text,
    sourceFormat,
    adapted: true,
    usedRawFallback: false,
    ...("remainingSourceItems" in assembled
      ? { remainingSourceItems: assembled.remainingSourceItems }
      : {}),
    sourceHash: hashNarrationText(text),
  };
};

/**
 * A compact deterministic content identity that works in browser, Convex, and
 * Node runtimes without introducing an asynchronous hashing seam.
 */
export const hashNarrationText = (text: string): string => {
  let first = 0x811c9dc5;
  let second = 0x9e3779b9;
  for (let index = 0; index < text.length; index += 1) {
    const code = text.charCodeAt(index);
    first = Math.imul(first ^ code, 0x01000193);
    second = Math.imul(second ^ code, 0x85ebca6b);
    second ^= second >>> 13;
  }
  return [
    `section-narration:${ARTICLE_SECTION_NARRATION_VERSION}`,
    (first >>> 0).toString(16).padStart(8, "0"),
    (second >>> 0).toString(16).padStart(8, "0"),
    text.length.toString(16),
  ].join(":");
};

const createVerbatimNarration = (
  section: SectionNarrationSource,
): SectionNarration => {
  const text = normalizeSpaces(`${section.title}. ${section.content}`);
  return {
    mode: "verbatim",
    text,
    sourceFormat: "prose",
    adapted: false,
    usedRawFallback: false,
    sourceHash: hashNarrationText(text),
  };
};

const createHeadingNarration = (
  section: SectionNarrationSource,
  hasChildSection: boolean,
): SectionNarration => {
  const text = hasChildSection ? `Next section: ${section.title}.` : "";
  return {
    mode: hasChildSection ? "transition" : "none",
    text,
    sourceFormat: "heading",
    adapted: false,
    usedRawFallback: false,
    sourceHash: hashNarrationText(text),
  };
};

export const createSectionNarrations = ({
  sections,
  parsedSource,
}: {
  sections: SectionNarrationSource[];
  parsedSource?: ParsedSectionNarrationSource;
}): NarratedSection[] => {
  const parsedHtml = parsedSource
    ? getParsedSectionHtml(parsedSource)
    : new Map<string, string>();
  return sections.map((section, index) => {
    const hasContent = Boolean(section.content.trim());
    const hasChildSection =
      !hasContent &&
      index + 1 < sections.length &&
      sections[index + 1].level > section.level;
    return {
      ...section,
      narration: hasContent
        ? parsedHtml.has(section.wikiSectionIndex)
          ? createStructuredNarration(
              section,
              parsedHtml.get(section.wikiSectionIndex)!,
            ) ?? createVerbatimNarration(section)
          : { ...createVerbatimNarration(section), usedRawFallback: true }
        : createHeadingNarration(section, hasChildSection),
    };
  });
};

const normalizeArticleSections = (
  sections: NonNullable<ArticleNarrationSource["sections"]>,
): NarratedSection[] => {
  const generated = createSectionNarrations({
    sections: sections.map((section, index) => ({
      wikiSectionIndex: section.wikiSectionIndex ?? String(index + 1),
      title: section.title,
      level: section.level,
      content: section.content,
    })),
  });
  return generated.map((section, index) => ({
    ...section,
    ...(sections[index].narration
      ? { narration: sections[index].narration }
      : {}),
  }));
};

export const buildArticleNarrationTracks = (
  article: ArticleNarrationSource,
): ArticleNarrationTrack[] => {
  const tracks: ArticleNarrationTrack[] = [];
  const summary = normalizeSpaces(article.summary ?? "");
  if (summary) {
    tracks.push({
      sectionKey: "summary",
      sectionIdx: null,
      title: `${article.title} — Summary`,
      text: summary,
      sourceHash: hashNarrationText(summary),
      mode: "summary",
      individuallyPlayable: true,
      countsTowardProgress: true,
    });
  }

  const sections = normalizeArticleSections(article.sections ?? []);
  for (let index = 0; index < sections.length; index += 1) {
    const section = sections[index];
    if (!section || section.narration.mode === "none" || !section.narration.text) {
      continue;
    }
    tracks.push({
      sectionKey: `section-${index}`,
      sectionIdx: index,
      title: `${section.title} — ${article.title}`,
      text: section.narration.text,
      sourceHash: section.narration.sourceHash,
      mode: section.narration.mode,
      individuallyPlayable:
        section.narration.mode === "verbatim" ||
        section.narration.mode === "structured",
      countsTowardProgress:
        section.narration.mode === "verbatim" ||
        section.narration.mode === "structured",
    });
  }

  return tracks;
};

export const buildArticleNarrationHash = (
  article: ArticleNarrationSource,
): string =>
  hashNarrationText(
    buildArticleNarrationTracks(article)
      .map((track) => `${track.sectionKey}:${track.sourceHash}`)
      .join("\n"),
  );
