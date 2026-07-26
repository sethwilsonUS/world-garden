#!/usr/bin/env -S npx tsx

import { createHash, randomUUID } from "node:crypto";
import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { performance } from "node:perf_hooks";
import {
  loadMediaWikiDocument,
  MediaWikiSourceError,
  normalizeMediaWikiNumericId,
  type MediaWikiBlock,
  type MediaWikiDocument,
  type MediaWikiDocumentSection,
  type MediaWikiDocumentSourceFormat,
  type MediaWikiRevisionRequest,
} from "../lib/mediawiki-document/index";
import { createSectionNarrationsFromDocument } from "../lib/section-narration-document";
import type { SectionNarrationMode } from "../lib/section-narration";
import { extractArticleContextFromDocument } from "../lib/article-context-document";
import { getRankedChartPresentation } from "../lib/article-context-chart";
import { createParsedPageDataFromDocument } from "../lib/mediawiki-document-metadata";

const SCRIPT_DIRECTORY = path.dirname(fileURLToPath(import.meta.url));
const DEFAULT_CORPUS_PATH = path.join(
  SCRIPT_DIRECTORY,
  "mediawiki-corpus.json",
);
const DEFAULT_CACHE_DIRECTORY = path.resolve(".cache/mediawiki-corpus");
const DEFAULT_OUTPUT_DIRECTORY = ".reports/mediawiki-corpus";
const REPORT_BASENAME = "mediawiki-corpus-audit";
const CACHE_SCHEMA_VERSION = 1;
const REPORT_SCHEMA_VERSION = 2;

const AUDIT_CAPABILITY_TAGS = [
  "charts",
  "colspans",
  "complex-tables",
  "diagrams",
  "easy-timeline",
  "external-data-declined",
  "figures",
  "geojson",
  "imagemap",
  "maps",
  "numeric-prose",
  "osm-location-map",
  "ranking-chart",
  "rowspans",
  "sections",
  "short-prose",
  "tables",
  "unsupported-fallback",
  "video",
  "wiki-chart",
] as const;

export type AuditCapabilityTag = (typeof AUDIT_CAPABILITY_TAGS)[number];
const auditCapabilityTags = new Set<string>(AUDIT_CAPABILITY_TAGS);

export type AuditSectionNarrationExpectation = Readonly<{
  index: string;
  title: string;
  mode: "verbatim" | "structured";
  adapted: boolean;
  sourceFormat: "prose" | "table" | "list" | "mixed";
  containsNumericProse?: boolean;
  proseWordCount?: number;
}>;

export type AuditNarrationExpectations = Readonly<{
  playableBodySections: number;
  sections: readonly AuditSectionNarrationExpectation[];
}>;

type CountRecord = Record<string, number>;

export type MediaWikiCorpusEntry = MediaWikiRevisionRequest &
  Readonly<{
    expects: readonly AuditCapabilityTag[];
    narrationExpectations?: AuditNarrationExpectations;
  }>;

type CorpusFile = Readonly<{
  schemaVersion: 1;
  articles: readonly MediaWikiCorpusEntry[];
}>;

export type AuditCliOptions = Readonly<{
  refresh: boolean;
  limit?: number;
  outputDirectory: string;
  help: boolean;
}>;

export type AuditFetchMetrics = Readonly<{
  requestCount: number;
  cacheHits: number;
  networkRequests: number;
  responseBodyBytes: number;
  networkBodyBytes: number;
  fetchDurationMs: number;
}>;

export type AuditSectionCounts = Readonly<{
  total: number;
  body: number;
  endMatter: number;
  complete: number;
  partial: number;
  plaintext: number;
  empty: number;
}>;

export type AuditTableCounts = Readonly<{
  tables: number;
  rows: number;
  columns: number;
  cells: number;
  spannedCells: number;
  maximumRows: number;
  maximumColumns: number;
}>;

export type AuditIssueCounts = Readonly<{
  total: number;
  fallback: number;
  skipped: number;
  byCode: CountRecord;
}>;

export type AuditProjectionCounts = Readonly<{
  narrations: number;
  playableNarrations: number;
  adaptedNarrations: number;
  rawFallbackNarrations: number;
  contextBlocks: number;
  contextByKind: CountRecord;
  links: number;
  citations: number;
  images: number;
}>;

export type AuditCoverage = Readonly<{
  passed: boolean;
  detected: readonly AuditCapabilityTag[];
  missing: readonly AuditCapabilityTag[];
  narrationFailures: readonly string[];
}>;

export type ArticleAudit = Readonly<{
  identity: MediaWikiRevisionRequest;
  expects: readonly string[];
  status: "success" | "error";
  durationMs: number;
  fetch: AuditFetchMetrics;
  sourceFormat?: MediaWikiDocumentSourceFormat;
  fallbackReason?: string;
  sourceHash?: string;
  documentHash?: string;
  sections: AuditSectionCounts;
  blocks: CountRecord;
  issues: AuditIssueCounts;
  tables: AuditTableCounts;
  projections: AuditProjectionCounts;
  coverage: AuditCoverage;
  error?: Readonly<{
    name: string;
    message: string;
    code?: string;
  }>;
}>;

export type CorpusAuditReport = Readonly<{
  schemaVersion: typeof REPORT_SCHEMA_VERSION;
  generatedAt: string;
  corpus: Readonly<{
    path: string;
    availableArticles: number;
    selectedArticles: number;
    limit?: number;
    refresh: boolean;
  }>;
  totals: Readonly<{
    articles: number;
    succeeded: number;
    failed: number;
    durationMs: number;
    fetch: AuditFetchMetrics;
    sourceFormats: CountRecord;
    sections: AuditSectionCounts;
    blocks: CountRecord;
    issues: AuditIssueCounts;
    tables: AuditTableCounts;
    coverage: Readonly<{
      passed: number;
      failed: number;
      expectedTags: number;
      detectedTags: number;
      missingTags: number;
      byMissingTag: CountRecord;
      narrationFailures: number;
    }>;
  }>;
  articles: readonly ArticleAudit[];
}>;

type CachedResponse = Readonly<{
  schemaVersion: typeof CACHE_SCHEMA_VERSION;
  url: string;
  fetchedAt: string;
  status: number;
  statusText: string;
  headers: Record<string, string>;
  bodyBase64: string;
  bodyBytes: number;
}>;

const emptyFetchMetrics = (): AuditFetchMetrics => ({
  requestCount: 0,
  cacheHits: 0,
  networkRequests: 0,
  responseBodyBytes: 0,
  networkBodyBytes: 0,
  fetchDurationMs: 0,
});

const emptySectionCounts = (): AuditSectionCounts => ({
  total: 0,
  body: 0,
  endMatter: 0,
  complete: 0,
  partial: 0,
  plaintext: 0,
  empty: 0,
});

const emptyTableCounts = (): AuditTableCounts => ({
  tables: 0,
  rows: 0,
  columns: 0,
  cells: 0,
  spannedCells: 0,
  maximumRows: 0,
  maximumColumns: 0,
});

const emptyIssueCounts = (): AuditIssueCounts => ({
  total: 0,
  fallback: 0,
  skipped: 0,
  byCode: {},
});

const emptyProjectionCounts = (): AuditProjectionCounts => ({
  narrations: 0,
  playableNarrations: 0,
  adaptedNarrations: 0,
  rawFallbackNarrations: 0,
  contextBlocks: 0,
  contextByKind: {},
  links: 0,
  citations: 0,
  images: 0,
});

const increment = (counts: CountRecord, key: string, amount = 1): void => {
  counts[key] = (counts[key] ?? 0) + amount;
};

const sortedCounts = (counts: CountRecord): CountRecord =>
  Object.fromEntries(
    Object.entries(counts).sort(
      ([leftKey, leftCount], [rightKey, rightCount]) =>
        rightCount - leftCount || leftKey.localeCompare(rightKey),
    ),
  );

const addFetchMetrics = (
  left: AuditFetchMetrics,
  right: AuditFetchMetrics,
): AuditFetchMetrics => ({
  requestCount: left.requestCount + right.requestCount,
  cacheHits: left.cacheHits + right.cacheHits,
  networkRequests: left.networkRequests + right.networkRequests,
  responseBodyBytes: left.responseBodyBytes + right.responseBodyBytes,
  networkBodyBytes: left.networkBodyBytes + right.networkBodyBytes,
  fetchDurationMs: left.fetchDurationMs + right.fetchDurationMs,
});

const addSectionCounts = (
  left: AuditSectionCounts,
  right: AuditSectionCounts,
): AuditSectionCounts => ({
  total: left.total + right.total,
  body: left.body + right.body,
  endMatter: left.endMatter + right.endMatter,
  complete: left.complete + right.complete,
  partial: left.partial + right.partial,
  plaintext: left.plaintext + right.plaintext,
  empty: left.empty + right.empty,
});

const addTableCounts = (
  left: AuditTableCounts,
  right: AuditTableCounts,
): AuditTableCounts => ({
  tables: left.tables + right.tables,
  rows: left.rows + right.rows,
  columns: left.columns + right.columns,
  cells: left.cells + right.cells,
  spannedCells: left.spannedCells + right.spannedCells,
  maximumRows: Math.max(left.maximumRows, right.maximumRows),
  maximumColumns: Math.max(left.maximumColumns, right.maximumColumns),
});

const addIssueCounts = (
  left: AuditIssueCounts,
  right: AuditIssueCounts,
): AuditIssueCounts => {
  const byCode = { ...left.byCode };
  for (const [code, count] of Object.entries(right.byCode)) {
    increment(byCode, code, count);
  }
  return {
    total: left.total + right.total,
    fallback: left.fallback + right.fallback,
    skipped: left.skipped + right.skipped,
    byCode: sortedCounts(byCode),
  };
};

const countDocument = (
  document: MediaWikiDocument,
): Pick<ArticleAudit, "sections" | "blocks" | "issues" | "tables"> => {
  let sections = emptySectionCounts();
  let tables = emptyTableCounts();
  const blocks: CountRecord = {};
  const issueCodes: CountRecord = {};

  for (const section of document.sections) {
    sections = {
      ...sections,
      total: sections.total + 1,
      [section.role === "body" ? "body" : "endMatter"]:
        sections[section.role === "body" ? "body" : "endMatter"] + 1,
      [section.fidelity]: sections[section.fidelity] + 1,
      empty:
        sections.empty +
        (section.blocks.length === 0 && !section.fallback.text.trim() ? 1 : 0),
    };

    for (const block of section.blocks) {
      increment(blocks, block.kind);
      if (block.kind !== "table") continue;
      const spannedCells = block.table.cells.filter(
        (cell) => cell.rowSpan > 1 || cell.columnSpan > 1,
      ).length;
      tables = {
        tables: tables.tables + 1,
        rows: tables.rows + block.table.rowCount,
        columns: tables.columns + block.table.columnCount,
        cells: tables.cells + block.table.cells.length,
        spannedCells: tables.spannedCells + spannedCells,
        maximumRows: Math.max(tables.maximumRows, block.table.rowCount),
        maximumColumns: Math.max(
          tables.maximumColumns,
          block.table.columnCount,
        ),
      };
    }
  }

  for (const issue of document.issues) increment(issueCodes, issue.code);
  const issues: AuditIssueCounts = {
    total: document.issues.length,
    fallback: document.issues.filter((issue) => issue.severity === "fallback")
      .length,
    skipped: document.issues.filter((issue) => issue.severity === "skipped")
      .length,
    byCode: sortedCounts(issueCodes),
  };

  return {
    sections,
    blocks: sortedCounts(blocks),
    issues,
    tables,
  };
};

const wordCount = (value: string): number => {
  const normalized = value.trim().split(/\s+/u).filter(Boolean);
  return normalized.length;
};

const normalizeAuditText = (value: string): string =>
  value.replace(/\s+/gu, " ").trim();

const isPlayableNarrationMode = (mode: SectionNarrationMode): boolean =>
  mode === "verbatim" || mode === "structured";

export const hasCompleteSectionNarrationCoverage = (
  bodySections: readonly MediaWikiDocumentSection[],
  narrations: ReturnType<typeof createSectionNarrationsFromDocument>,
): boolean => {
  const sections = bodySections.filter(
    (section) => section.key !== "__summary__",
  );
  const narrationByIndex = new Map(
    narrations.map((section) => [section.wikiSectionIndex, section.narration]),
  );
  const narrationKeys = new Set(narrationByIndex.keys());
  const substantive = sections.filter((section) =>
    Boolean(
      section.plaintextContent.trim() ||
      section.fallback.text.trim() ||
      section.blocks.length,
    ),
  );
  return (
    sections.length > 0 &&
    narrations.length === sections.length &&
    sections.every((section) => narrationKeys.has(section.key)) &&
    substantive.every((section) => {
      const narration = narrationByIndex.get(section.key);
      return narration != null && isPlayableNarrationMode(narration.mode);
    })
  );
};

const detectArticleCapabilities = (
  document: MediaWikiDocument,
): {
  detected: AuditCapabilityTag[];
  projections: AuditProjectionCounts;
  narrations: ReturnType<typeof createSectionNarrationsFromDocument>;
} => {
  // Exercise the same three named projections that production consumers use.
  // An adapter exception is an audit failure rather than a silently skipped tag.
  const narrations = createSectionNarrationsFromDocument(document);
  const context = extractArticleContextFromDocument(document, {
    now: () => new Date("1970-01-01T00:00:00.000Z"),
  });
  const metadata = createParsedPageDataFromDocument(document);
  const bodySections = document.sections.filter(
    (section) => section.role === "body",
  );
  const allBlocks = document.sections.flatMap((section) => section.blocks);
  const blocks = bodySections.flatMap((section) => section.blocks);
  const proseEntries = bodySections.flatMap((section) =>
    section.key === "__summary__"
      ? []
      : section.blocks.flatMap((block) =>
          block.kind === "prose" ? [{ section, block }] : [],
        ),
  );
  const tableBlocks = blocks.filter(
    (block): block is Extract<MediaWikiBlock, { kind: "table" }> =>
      block.kind === "table",
  );
  const figureBlocks = blocks.filter(
    (block): block is Extract<MediaWikiBlock, { kind: "figure" }> =>
      block.kind === "figure",
  );
  const extensionBlocks = blocks.filter(
    (block): block is Extract<MediaWikiBlock, { kind: "extension" }> =>
      block.kind === "extension",
  );
  const narrationByIndex = new Map(
    narrations.map((section) => [section.wikiSectionIndex, section.narration]),
  );
  const contextByKind: CountRecord = {};
  context.blocks.forEach((block) => increment(contextByKind, block.kind));

  const detected = new Set<AuditCapabilityTag>();
  const addWhen = (tag: AuditCapabilityTag, condition: boolean): void => {
    if (condition) detected.add(tag);
  };
  const hasSourceFaithfulVerbatimProse = (
    sectionKey: string,
    sourceText: string,
  ): boolean => {
    const narration = narrationByIndex.get(sectionKey);
    const normalizedSource = normalizeAuditText(sourceText);
    return Boolean(
      narration &&
      narration.mode === "verbatim" &&
      !narration.adapted &&
      !narration.usedRawFallback &&
      narration.sourceFormat === "prose" &&
      normalizedSource &&
      normalizeAuditText(narration.text).includes(normalizedSource),
    );
  };
  addWhen(
    "sections",
    hasCompleteSectionNarrationCoverage(bodySections, narrations),
  );
  addWhen(
    "short-prose",
    proseEntries.some(({ section, block }) => {
      const words = wordCount(block.text);
      return (
        words > 0 &&
        words <= 25 &&
        hasSourceFaithfulVerbatimProse(section.key, block.text)
      );
    }),
  );
  addWhen(
    "numeric-prose",
    proseEntries.some(
      ({ section, block }) =>
        /\p{Number}/u.test(block.text) &&
        hasSourceFaithfulVerbatimProse(section.key, block.text),
    ),
  );
  addWhen("tables", tableBlocks.length > 0);
  addWhen(
    "rowspans",
    tableBlocks.some((block) =>
      block.table.cells.some((cell) => cell.rowSpan > 1),
    ),
  );
  addWhen(
    "colspans",
    tableBlocks.some((block) =>
      block.table.cells.some((cell) => cell.columnSpan > 1),
    ),
  );
  addWhen(
    "complex-tables",
    tableBlocks.some(
      (block) =>
        block.table.rowCount > 250 ||
        block.table.columnCount > 12 ||
        block.table.cells.some(
          (cell) => cell.rowSpan > 1 || cell.columnSpan > 1,
        ),
    ) ||
      blocks.some(
        (block) => block.kind === "unsupported" && block.sourceKind === "table",
      ),
  );
  addWhen("figures", figureBlocks.length > 0);
  addWhen(
    "video",
    figureBlocks.some((block) =>
      block.media.some((media) => media.kind === "video"),
    ),
  );
  addWhen(
    "imagemap",
    allBlocks.some(
      (block) => block.kind === "figure" && block.regions.length > 0,
    ),
  );
  addWhen(
    "geojson",
    extensionBlocks.some(
      (block) =>
        block.extension.kind === "kartographer" &&
        block.extension.geoJson != null,
    ),
  );
  addWhen(
    "osm-location-map",
    extensionBlocks.some(
      (block) => block.extension.kind === "osm-location-map",
    ),
  );
  addWhen(
    "easy-timeline",
    extensionBlocks.some((block) => block.extension.kind === "easy-timeline"),
  );
  addWhen(
    "external-data-declined",
    document.issues.some((issue) => issue.code === "unversioned-external-data"),
  );
  addWhen(
    "wiki-chart",
    extensionBlocks.some((block) => block.extension.kind === "chart"),
  );
  addWhen(
    "unsupported-fallback",
    bodySections.some(
      (section) =>
        section.blocks.some(
          (block) => block.kind === "unsupported" && block.affectsNarration,
        ) && narrationByIndex.get(section.key)?.usedRawFallback === true,
    ),
  );
  addWhen(
    "charts",
    context.blocks.some((block) => block.kind === "chart"),
  );
  addWhen(
    "maps",
    context.blocks.some((block) => block.kind === "map"),
  );
  addWhen(
    "diagrams",
    context.blocks.some((block) => block.kind === "diagram"),
  );
  addWhen(
    "ranking-chart",
    context.blocks.some(
      (block) => block.kind === "chart" && getRankedChartPresentation(block),
    ),
  );

  return {
    detected: AUDIT_CAPABILITY_TAGS.filter((tag) => detected.has(tag)),
    projections: {
      narrations: narrations.length,
      playableNarrations: narrations.filter(
        (section) => isPlayableNarrationMode(section.narration.mode),
      ).length,
      adaptedNarrations: narrations.filter(
        (section) => section.narration.adapted,
      ).length,
      rawFallbackNarrations: narrations.filter(
        (section) => section.narration.usedRawFallback,
      ).length,
      contextBlocks: context.blocks.length,
      contextByKind: sortedCounts(contextByKind),
      links: metadata.linkCounts.reduce(
        (total, section) => total + section.count,
        0,
      ),
      citations: metadata.citations.length,
      images: metadata.images.length,
    },
    narrations,
  };
};

const evaluateNarrationExpectations = (
  entry: MediaWikiCorpusEntry,
  document: MediaWikiDocument,
  narrations: ReturnType<typeof createSectionNarrationsFromDocument>,
): string[] => {
  const expectations = entry.narrationExpectations;
  if (!expectations) return [];
  const failures: string[] = [];
  const playable = narrations.filter(
    (section) =>
      section.narration.mode === "verbatim" ||
      section.narration.mode === "structured",
  );
  if (playable.length !== expectations.playableBodySections) {
    failures.push(
      `Expected ${expectations.playableBodySections} playable body sections; found ${playable.length}.`,
    );
  }

  for (const expected of expectations.sections) {
    const section = document.sections.find(
      (candidate) =>
        candidate.role === "body" && candidate.key === expected.index,
    );
    const narration = narrations.find(
      (candidate) => candidate.wikiSectionIndex === expected.index,
    )?.narration;
    const label = `Section ${expected.index} (${expected.title})`;
    if (!section) {
      failures.push(`${label} is missing from the semantic document.`);
      continue;
    }
    if (section.title !== expected.title) {
      failures.push(`${label} resolved to title ${section.title}.`);
    }
    if (!narration) {
      failures.push(`${label} is missing from the narration projection.`);
      continue;
    }
    if (
      narration.mode !== expected.mode ||
      narration.adapted !== expected.adapted ||
      narration.sourceFormat !== expected.sourceFormat
    ) {
      failures.push(
        `${label} narration was ${narration.mode}/${narration.sourceFormat}/adapted=${String(narration.adapted)}.`,
      );
    }
    const prose = section.blocks.filter(
      (block): block is Extract<MediaWikiBlock, { kind: "prose" }> =>
        block.kind === "prose",
    );
    if (expected.mode === "verbatim") {
      if (narration.usedRawFallback) {
        failures.push(`${label} unexpectedly used raw fallback narration.`);
      }
      const normalizedNarration = normalizeAuditText(narration.text);
      if (
        prose.some(
          (block) =>
            !normalizedNarration.includes(normalizeAuditText(block.text)),
        )
      ) {
        failures.push(
          `${label} narration no longer contains every source prose block.`,
        );
      }
    }
    if (
      expected.containsNumericProse &&
      !prose.some((block) => /\p{Number}/u.test(block.text))
    ) {
      failures.push(`${label} no longer contains numeric prose.`);
    }
    if (expected.proseWordCount != null) {
      const actualWords = prose.reduce(
        (total, block) => total + wordCount(block.text),
        0,
      );
      if (actualWords !== expected.proseWordCount) {
        failures.push(
          `${label} expected ${expected.proseWordCount} prose words; found ${actualWords}.`,
        );
      }
    }
  }
  return failures;
};

export const summarizeArticleAudit = ({
  entry,
  document,
  durationMs,
  fetch,
}: {
  entry: MediaWikiCorpusEntry;
  document: MediaWikiDocument;
  durationMs: number;
  fetch: AuditFetchMetrics;
}): ArticleAudit => {
  const { detected, projections, narrations } =
    detectArticleCapabilities(document);
  const detectedSet = new Set(detected);
  const missing = entry.expects.filter((tag) => !detectedSet.has(tag));
  const narrationFailures = evaluateNarrationExpectations(
    entry,
    document,
    narrations,
  );
  return {
    identity: document.identity,
    expects: entry.expects,
    status: "success",
    durationMs,
    fetch,
    sourceFormat: document.sourceFormat,
    ...(document.fallbackReason
      ? { fallbackReason: document.fallbackReason }
      : {}),
    sourceHash: document.sourceHash,
    documentHash: document.documentHash,
    ...countDocument(document),
    projections,
    coverage: {
      passed: missing.length === 0 && narrationFailures.length === 0,
      detected,
      missing,
      narrationFailures,
    },
  };
};

const failedArticleAudit = ({
  entry,
  error,
  durationMs,
  fetch,
}: {
  entry: MediaWikiCorpusEntry;
  error: unknown;
  durationMs: number;
  fetch: AuditFetchMetrics;
}): ArticleAudit => {
  const normalizedError =
    error instanceof Error
      ? error
      : new Error(typeof error === "string" ? error : "Unknown audit failure");
  return {
    identity: {
      wikiPageId: entry.wikiPageId,
      title: entry.title,
      revisionId: entry.revisionId,
      language: "en",
    },
    expects: entry.expects,
    status: "error",
    durationMs,
    fetch,
    sections: emptySectionCounts(),
    blocks: {},
    issues: emptyIssueCounts(),
    tables: emptyTableCounts(),
    projections: emptyProjectionCounts(),
    coverage: {
      passed: false,
      detected: [],
      missing: [...entry.expects],
      narrationFailures: [],
    },
    error: {
      name: normalizedError.name,
      message: normalizedError.message,
      ...(error instanceof MediaWikiSourceError ? { code: error.code } : {}),
    },
  };
};

const parseFlagValue = (
  argv: readonly string[],
  index: number,
): { value: string; consumed: number } => {
  const current = argv[index];
  const separator = current.indexOf("=");
  if (separator >= 0) {
    const value = current.slice(separator + 1).trim();
    if (!value)
      throw new Error(`${current.slice(0, separator)} requires a value.`);
    return { value, consumed: 0 };
  }
  const value = argv[index + 1];
  if (!value || value.startsWith("-")) {
    throw new Error(`${current} requires a value.`);
  }
  return { value, consumed: 1 };
};

export const parseAuditArgs = (
  argv: readonly string[],
  cwd = process.cwd(),
): AuditCliOptions => {
  let refresh = false;
  let limit: number | undefined;
  let outputDirectory = path.resolve(cwd, DEFAULT_OUTPUT_DIRECTORY);
  let help = false;

  for (let index = 0; index < argv.length; index += 1) {
    const argument = argv[index];
    if (argument === "--refresh") {
      refresh = true;
      continue;
    }
    if (argument === "--help" || argument === "-h") {
      help = true;
      continue;
    }
    if (argument === "--limit" || argument.startsWith("--limit=")) {
      const parsed = parseFlagValue(argv, index);
      limit = Number(parsed.value);
      index += parsed.consumed;
      continue;
    }
    if (argument === "--output" || argument.startsWith("--output=")) {
      const parsed = parseFlagValue(argv, index);
      outputDirectory = path.resolve(cwd, parsed.value);
      index += parsed.consumed;
      continue;
    }
    throw new Error(`Unknown argument: ${argument}`);
  }

  if (limit !== undefined && (!Number.isSafeInteger(limit) || limit <= 0)) {
    throw new Error("--limit must be a positive integer.");
  }

  return { refresh, limit, outputDirectory, help };
};

const isSectionNarrationExpectation = (
  value: unknown,
): value is AuditSectionNarrationExpectation => {
  if (!value || typeof value !== "object") return false;
  const expectation = value as Record<string, unknown>;
  return (
    typeof expectation.index === "string" &&
    /^\d+(?:\.\d+)*$/.test(expectation.index) &&
    typeof expectation.title === "string" &&
    Boolean(expectation.title.trim()) &&
    (expectation.mode === "verbatim" || expectation.mode === "structured") &&
    typeof expectation.adapted === "boolean" &&
    ["prose", "table", "list", "mixed"].includes(
      String(expectation.sourceFormat),
    ) &&
    (expectation.containsNumericProse == null ||
      typeof expectation.containsNumericProse === "boolean") &&
    (expectation.proseWordCount == null ||
      (Number.isSafeInteger(expectation.proseWordCount) &&
        Number(expectation.proseWordCount) >= 0))
  );
};

const isNarrationExpectations = (
  value: unknown,
): value is AuditNarrationExpectations => {
  if (!value || typeof value !== "object") return false;
  const expectations = value as Record<string, unknown>;
  return (
    Number.isSafeInteger(expectations.playableBodySections) &&
    Number(expectations.playableBodySections) >= 0 &&
    Array.isArray(expectations.sections) &&
    expectations.sections.every(isSectionNarrationExpectation) &&
    new Set(
      expectations.sections.map(
        (section: AuditSectionNarrationExpectation) => section.index,
      ),
    ).size === expectations.sections.length
  );
};

const isCorpusEntry = (value: unknown): value is MediaWikiCorpusEntry => {
  if (!value || typeof value !== "object") return false;
  const entry = value as Record<string, unknown>;
  return (
    typeof entry.wikiPageId === "string" &&
    normalizeMediaWikiNumericId(entry.wikiPageId) != null &&
    typeof entry.revisionId === "string" &&
    normalizeMediaWikiNumericId(entry.revisionId) != null &&
    typeof entry.title === "string" &&
    Boolean(entry.title.trim()) &&
    entry.language === "en" &&
    Array.isArray(entry.expects) &&
    entry.expects.every(
      (item) => typeof item === "string" && auditCapabilityTags.has(item),
    ) &&
    new Set(entry.expects).size === entry.expects.length &&
    (entry.narrationExpectations == null ||
      isNarrationExpectations(entry.narrationExpectations))
  );
};

export const loadCorpus = async (
  corpusPath = DEFAULT_CORPUS_PATH,
): Promise<CorpusFile> => {
  const parsed = JSON.parse(await readFile(corpusPath, "utf8")) as unknown;
  if (!parsed || typeof parsed !== "object") {
    throw new Error("MediaWiki corpus must be a JSON object.");
  }
  const candidate = parsed as { schemaVersion?: unknown; articles?: unknown };
  if (
    candidate.schemaVersion !== 1 ||
    !Array.isArray(candidate.articles) ||
    !candidate.articles.every(isCorpusEntry)
  ) {
    throw new Error("MediaWiki corpus does not match schema version 1.");
  }
  return {
    schemaVersion: 1,
    articles: candidate.articles.map((entry) => ({
      ...entry,
      wikiPageId: normalizeMediaWikiNumericId(entry.wikiPageId)!,
      revisionId: normalizeMediaWikiNumericId(entry.revisionId)!,
    })),
  };
};

const isCachedResponse = (
  value: unknown,
  expectedUrl: string,
): value is CachedResponse => {
  if (!value || typeof value !== "object") return false;
  const candidate = value as Partial<CachedResponse>;
  return (
    candidate.schemaVersion === CACHE_SCHEMA_VERSION &&
    candidate.url === expectedUrl &&
    typeof candidate.status === "number" &&
    candidate.status >= 200 &&
    candidate.status < 300 &&
    typeof candidate.statusText === "string" &&
    Boolean(candidate.headers) &&
    typeof candidate.headers === "object" &&
    typeof candidate.bodyBase64 === "string" &&
    typeof candidate.bodyBytes === "number"
  );
};

export class CachedMediaWikiFetch {
  private mutableMetrics = {
    requestCount: 0,
    cacheHits: 0,
    networkRequests: 0,
    responseBodyBytes: 0,
    networkBodyBytes: 0,
    fetchDurationMs: 0,
  };

  constructor(
    private readonly cacheDirectory: string,
    private readonly refresh: boolean,
  ) {}

  get metrics(): AuditFetchMetrics {
    return { ...this.mutableMetrics };
  }

  readonly fetch: typeof fetch = async (input, init) => {
    const startedAt = performance.now();
    const url = input instanceof Request ? input.url : String(input);
    const signal =
      init?.signal ?? (input instanceof Request ? input.signal : null);
    signal?.throwIfAborted();
    const cacheKey = createHash("sha256").update(url).digest("hex");
    const cachePath = path.join(this.cacheDirectory, `${cacheKey}.json`);
    this.mutableMetrics.requestCount += 1;

    try {
      if (!this.refresh) {
        const cached = await this.read(cachePath, url);
        if (cached) {
          signal?.throwIfAborted();
          const body = Buffer.from(cached.bodyBase64, "base64");
          this.mutableMetrics.cacheHits += 1;
          this.mutableMetrics.responseBodyBytes += body.byteLength;
          return new Response(body, {
            status: cached.status,
            statusText: cached.statusText,
            headers: cached.headers,
          });
        }
      }

      this.mutableMetrics.networkRequests += 1;
      const response = await fetch(input, init);
      const body = Buffer.from(await response.arrayBuffer());
      const cached: CachedResponse = {
        schemaVersion: CACHE_SCHEMA_VERSION,
        url,
        fetchedAt: new Date().toISOString(),
        status: response.status,
        statusText: response.statusText,
        headers: Object.fromEntries(response.headers.entries()),
        bodyBase64: body.toString("base64"),
        bodyBytes: body.byteLength,
      };
      if (response.ok) {
        await this.write(cachePath, cached);
      }
      this.mutableMetrics.responseBodyBytes += body.byteLength;
      this.mutableMetrics.networkBodyBytes += body.byteLength;
      return new Response(body, {
        status: response.status,
        statusText: response.statusText,
        headers: response.headers,
      });
    } finally {
      this.mutableMetrics.fetchDurationMs += performance.now() - startedAt;
    }
  };

  private async read(
    cachePath: string,
    expectedUrl: string,
  ): Promise<CachedResponse | null> {
    let source: string;
    try {
      source = await readFile(cachePath, "utf8");
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === "ENOENT") return null;
      throw error;
    }
    try {
      const parsed = JSON.parse(source) as unknown;
      return isCachedResponse(parsed, expectedUrl) ? parsed : null;
    } catch {
      return null;
    }
  }

  private async write(
    cachePath: string,
    response: CachedResponse,
  ): Promise<void> {
    await mkdir(this.cacheDirectory, { recursive: true });
    const temporaryPath = `${cachePath}.${process.pid}.${randomUUID()}.tmp`;
    await writeFile(temporaryPath, `${JSON.stringify(response)}\n`, "utf8");
    await rename(temporaryPath, cachePath);
  }
}

export const buildAuditReport = ({
  generatedAt,
  corpusPath,
  availableArticles,
  limit,
  refresh,
  durationMs,
  articles,
}: {
  generatedAt: Date;
  corpusPath: string;
  availableArticles: number;
  limit?: number;
  refresh: boolean;
  durationMs: number;
  articles: readonly ArticleAudit[];
}): CorpusAuditReport => {
  let fetch = emptyFetchMetrics();
  let sections = emptySectionCounts();
  let tables = emptyTableCounts();
  let issues = emptyIssueCounts();
  const blocks: CountRecord = {};
  const sourceFormats: CountRecord = {};
  const missingTags: CountRecord = {};
  let coveragePassed = 0;
  let coverageFailed = 0;
  let expectedTags = 0;
  let detectedTags = 0;
  let missingTagCount = 0;
  let narrationFailures = 0;

  for (const article of articles) {
    fetch = addFetchMetrics(fetch, article.fetch);
    sections = addSectionCounts(sections, article.sections);
    tables = addTableCounts(tables, article.tables);
    issues = addIssueCounts(issues, article.issues);
    for (const [kind, count] of Object.entries(article.blocks)) {
      increment(blocks, kind, count);
    }
    if (article.sourceFormat) increment(sourceFormats, article.sourceFormat);
    if (article.coverage.passed) coveragePassed += 1;
    else coverageFailed += 1;
    expectedTags += article.expects.length;
    detectedTags += article.coverage.detected.length;
    missingTagCount += article.coverage.missing.length;
    narrationFailures += article.coverage.narrationFailures.length;
    article.coverage.missing.forEach((tag) => increment(missingTags, tag));
  }

  return {
    schemaVersion: REPORT_SCHEMA_VERSION,
    generatedAt: generatedAt.toISOString(),
    corpus: {
      path: corpusPath,
      availableArticles,
      selectedArticles: articles.length,
      ...(limit === undefined ? {} : { limit }),
      refresh,
    },
    totals: {
      articles: articles.length,
      succeeded: articles.filter((article) => article.status === "success")
        .length,
      failed: articles.filter((article) => article.status === "error").length,
      durationMs,
      fetch,
      sourceFormats: sortedCounts(sourceFormats),
      sections,
      blocks: sortedCounts(blocks),
      issues,
      tables,
      coverage: {
        passed: coveragePassed,
        failed: coverageFailed,
        expectedTags,
        detectedTags,
        missingTags: missingTagCount,
        byMissingTag: sortedCounts(missingTags),
        narrationFailures,
      },
    },
    articles,
  };
};

export const hasAuditDiscrepancies = (report: CorpusAuditReport): boolean =>
  report.totals.failed > 0 || report.totals.coverage.failed > 0;

const formatBytes = (bytes: number): string => {
  if (bytes < 1024) return `${bytes} B`;
  const units = ["KiB", "MiB", "GiB"];
  let value = bytes / 1024;
  let unit = units[0];
  for (let index = 1; index < units.length && value >= 1024; index += 1) {
    value /= 1024;
    unit = units[index];
  }
  return `${value.toFixed(1)} ${unit}`;
};

const countLines = (
  counts: CountRecord,
  emptyMessage: string,
  indentation = "",
): string[] => {
  const entries = Object.entries(counts);
  return entries.length > 0
    ? entries.map(([key, count]) => `${indentation}- ${key}: ${count}`)
    : [`${indentation}- ${emptyMessage}`];
};

export const renderMarkdownReport = (report: CorpusAuditReport): string => {
  const { totals } = report;
  const lines = [
    "# MediaWiki Corpus Audit",
    "",
    `Generated: ${report.generatedAt}`,
    "",
    "## Run summary",
    "",
    `- Corpus articles available: ${report.corpus.availableArticles}`,
    `- Articles audited: ${totals.articles}`,
    `- Successful: ${totals.succeeded}`,
    `- Failed: ${totals.failed}`,
    `- Capability checks passed: ${totals.coverage.passed}`,
    `- Capability checks failed: ${totals.coverage.failed}`,
    `- Missing expected capability tags: ${totals.coverage.missingTags}`,
    `- Narration contract failures: ${totals.coverage.narrationFailures}`,
    `- Total elapsed time: ${totals.durationMs.toFixed(1)} ms`,
    `- Fetch time: ${totals.fetch.fetchDurationMs.toFixed(1)} ms`,
    `- Response body bytes inspected: ${formatBytes(totals.fetch.responseBodyBytes)}`,
    `- Response body bytes fetched from the network: ${formatBytes(totals.fetch.networkBodyBytes)}`,
    `- Fetch requests: ${totals.fetch.requestCount}`,
    `- Response-cache hits: ${totals.fetch.cacheHits}`,
    `- Refresh requested: ${report.corpus.refresh ? "yes" : "no"}`,
    "",
    "## Section counts",
    "",
    `- Total: ${totals.sections.total}`,
    `- Body: ${totals.sections.body}`,
    `- End matter: ${totals.sections.endMatter}`,
    `- Complete fidelity: ${totals.sections.complete}`,
    `- Partial fidelity: ${totals.sections.partial}`,
    `- Plaintext fidelity: ${totals.sections.plaintext}`,
    `- Empty: ${totals.sections.empty}`,
    "",
    "## Block counts",
    "",
    ...countLines(totals.blocks, "No blocks found."),
    "",
    "## Issue counts",
    "",
    `- Total: ${totals.issues.total}`,
    `- Fallback severity: ${totals.issues.fallback}`,
    `- Skipped severity: ${totals.issues.skipped}`,
    "- By code:",
    ...countLines(totals.issues.byCode, "No issues found.", "  "),
    "",
    "## Table counts",
    "",
    `- Tables: ${totals.tables.tables}`,
    `- Rows: ${totals.tables.rows}`,
    `- Columns summed across tables: ${totals.tables.columns}`,
    `- Source cells: ${totals.tables.cells}`,
    `- Cells with row or column spans: ${totals.tables.spannedCells}`,
    `- Largest table row count: ${totals.tables.maximumRows}`,
    `- Largest table column count: ${totals.tables.maximumColumns}`,
    "",
    "## Capability discrepancies",
    "",
    ...countLines(
      totals.coverage.byMissingTag,
      "No expected capabilities are missing.",
    ),
    "",
    "## Article results",
    "",
  ];

  for (const article of report.articles) {
    lines.push(
      `### ${article.identity.title}`,
      "",
      `- Status: ${article.status}`,
      `- Revision: ${article.identity.revisionId}`,
      `- Expected coverage tags: ${article.expects.join(", ") || "none"}`,
      `- Detected coverage tags: ${article.coverage.detected.join(", ") || "none"}`,
      `- Missing expected tags: ${article.coverage.missing.join(", ") || "none"}`,
      `- Narration expectation failures: ${article.coverage.narrationFailures.join("; ") || "none"}`,
      `- Elapsed time: ${article.durationMs.toFixed(1)} ms`,
      `- Response bytes inspected: ${formatBytes(article.fetch.responseBodyBytes)}`,
      `- Network bytes: ${formatBytes(article.fetch.networkBodyBytes)}`,
      `- Cache hits: ${article.fetch.cacheHits} of ${article.fetch.requestCount} requests`,
    );
    if (article.status === "error") {
      lines.push(
        `- Error: ${article.error?.code ? `${article.error.code}: ` : ""}${article.error?.message ?? "Unknown error"}`,
        "",
      );
      continue;
    }
    lines.push(
      `- Source format: ${article.sourceFormat}`,
      `- Sections: ${article.sections.total} total; ${article.sections.body} body; ${article.sections.endMatter} end matter; ${article.sections.partial} partial`,
      `- Tables: ${article.tables.tables}; ${article.tables.rows} rows; ${article.tables.cells} source cells`,
      `- Issues: ${article.issues.total}`,
      `- Projections: ${article.projections.narrations} narrations (${article.projections.playableNarrations} playable, ${article.projections.adaptedNarrations} adapted, ${article.projections.rawFallbackNarrations} raw fallback); ${article.projections.contextBlocks} context blocks; ${article.projections.links} links; ${article.projections.citations} citations; ${article.projections.images} images`,
      "- Context blocks by kind:",
      ...countLines(
        article.projections.contextByKind,
        "No context blocks found.",
        "  ",
      ),
      "- Blocks:",
      ...countLines(article.blocks, "No blocks found.", "  "),
      "- Issues by code:",
      ...countLines(article.issues.byCode, "No issues found.", "  "),
      "",
    );
  }

  return `${lines.join("\n").trimEnd()}\n`;
};

export const writeAuditReports = async (
  report: CorpusAuditReport,
  outputDirectory: string,
): Promise<{ jsonPath: string; markdownPath: string }> => {
  await mkdir(outputDirectory, { recursive: true });
  const jsonPath = path.join(outputDirectory, `${REPORT_BASENAME}.json`);
  const markdownPath = path.join(outputDirectory, `${REPORT_BASENAME}.md`);
  await Promise.all([
    writeFile(jsonPath, `${JSON.stringify(report, null, 2)}\n`, "utf8"),
    writeFile(markdownPath, renderMarkdownReport(report), "utf8"),
  ]);
  return { jsonPath, markdownPath };
};

const HELP_TEXT = `MediaWiki corpus audit (networked and opt-in)

Usage:
  npx tsx scripts/mediawiki-corpus-audit.ts [options]

Options:
  --limit <count>   Audit only the first count corpus entries.
  --output <dir>    Write JSON and Markdown reports to this directory.
  --refresh         Bypass and replace cached MediaWiki responses.
  --help, -h        Show this help.

Response cache:
  .cache/mediawiki-corpus/ (gitignored)
`;

export const runMediaWikiCorpusAudit = async (
  options: AuditCliOptions,
): Promise<{
  report: CorpusAuditReport;
  jsonPath: string;
  markdownPath: string;
}> => {
  const corpus = await loadCorpus();
  const selected = corpus.articles.slice(0, options.limit);
  const startedAt = performance.now();
  const articles: ArticleAudit[] = [];

  for (const [index, entry] of selected.entries()) {
    console.error(
      `[mediawiki-corpus] ${index + 1}/${selected.length}: ${entry.title} (revision ${entry.revisionId})`,
    );
    const cachedFetch = new CachedMediaWikiFetch(
      DEFAULT_CACHE_DIRECTORY,
      options.refresh,
    );
    const articleStartedAt = performance.now();
    try {
      const document = await loadMediaWikiDocument(entry, {
        fetchImpl: cachedFetch.fetch,
      });
      articles.push(
        summarizeArticleAudit({
          entry,
          document,
          durationMs: performance.now() - articleStartedAt,
          fetch: cachedFetch.metrics,
        }),
      );
    } catch (error) {
      articles.push(
        failedArticleAudit({
          entry,
          error,
          durationMs: performance.now() - articleStartedAt,
          fetch: cachedFetch.metrics,
        }),
      );
    }
  }

  const report = buildAuditReport({
    generatedAt: new Date(),
    corpusPath: DEFAULT_CORPUS_PATH,
    availableArticles: corpus.articles.length,
    limit: options.limit,
    refresh: options.refresh,
    durationMs: performance.now() - startedAt,
    articles,
  });
  const paths = await writeAuditReports(report, options.outputDirectory);
  return { report, ...paths };
};

const isMain =
  Boolean(process.argv[1]) &&
  path.resolve(process.argv[1]) === fileURLToPath(import.meta.url);

if (isMain) {
  Promise.resolve()
    .then(async () => {
      const options = parseAuditArgs(process.argv.slice(2));
      if (options.help) {
        process.stdout.write(HELP_TEXT);
        return;
      }
      const result = await runMediaWikiCorpusAudit(options);
      process.stdout.write(
        `Wrote ${result.jsonPath}\nWrote ${result.markdownPath}\n`,
      );
      if (hasAuditDiscrepancies(result.report)) process.exitCode = 1;
    })
    .catch((error: unknown) => {
      const message = error instanceof Error ? error.message : String(error);
      console.error(`[mediawiki-corpus] ${message}`);
      process.exitCode = 1;
    });
}
