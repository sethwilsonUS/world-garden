import { mkdtemp, readFile, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import {
  buildAuditReport,
  hasAuditDiscrepancies,
  hasCompleteSectionNarrationCoverage,
  parseAuditArgs,
  renderMarkdownReport,
  summarizeArticleAudit,
  writeAuditReports,
  type AuditFetchMetrics,
  type MediaWikiCorpusEntry,
} from "./mediawiki-corpus-audit";
import type { MediaWikiDocument } from "../lib/mediawiki-document";
import { createSectionNarrationsFromDocument } from "../lib/section-narration-document";

const entry: MediaWikiCorpusEntry = {
  wikiPageId: "384816",
  title: "Walter Savage Landor",
  revisionId: "1342291773",
  language: "en",
  expects: ["short-prose", "numeric-prose", "sections"],
  narrationExpectations: {
    playableBodySections: 2,
    sections: [
      {
        index: "2",
        title: "Recognition",
        mode: "verbatim",
        adapted: false,
        sourceFormat: "prose",
        containsNumericProse: true,
        proseWordCount: 4,
      },
    ],
  },
};

const document: MediaWikiDocument = {
  schemaVersion: 1,
  identity: {
    wikiPageId: entry.wikiPageId,
    title: entry.title,
    revisionId: entry.revisionId,
    language: "en",
  },
  sourceFormat: "parsoid",
  sourceHash: "source-hash",
  documentHash: "document-hash",
  citations: [],
  issues: [
    {
      code: "malformed-table",
      severity: "fallback",
      sectionKey: "1",
    },
  ],
  sections: [
    {
      key: "__summary__",
      title: "Summary",
      level: 0,
      sourceOrder: 0,
      role: "body",
      fidelity: "complete",
      plaintextContent: "Short lead.",
      fallback: { text: "Short lead.", source: "dom-text" },
      blocks: [
        {
          id: "summary-prose",
          sourceOrder: 1,
          contentHash: "prose-hash",
          kind: "prose",
          role: "paragraph",
          text: "Short lead.",
        },
      ],
      links: [],
      citationIds: [],
    },
    {
      key: "1",
      title: "Data",
      level: 1,
      sourceOrder: 2,
      parentKey: "__summary__",
      role: "body",
      fidelity: "partial",
      plaintextContent: "Year Value 1900 10",
      fallback: { text: "Year Value 1900 10", source: "dom-text" },
      blocks: [
        {
          id: "data-table",
          sourceOrder: 3,
          contentHash: "table-hash",
          kind: "table",
          table: {
            caption: "Values",
            rowCount: 2,
            columnCount: 2,
            cells: [
              {
                id: "year-header",
                kind: "header",
                text: "Year",
                originRow: 0,
                originColumn: 0,
                rowSpan: 1,
                columnSpan: 1,
                rowGroup: 0,
                scope: "column",
                explicitHeaderIds: [],
                associatedHeaderCellIds: [],
                headerPath: [],
              },
              {
                id: "value-header",
                kind: "header",
                text: "Value",
                originRow: 0,
                originColumn: 1,
                rowSpan: 1,
                columnSpan: 1,
                rowGroup: 0,
                scope: "column",
                explicitHeaderIds: [],
                associatedHeaderCellIds: [],
                headerPath: [],
              },
              {
                id: "year-value",
                kind: "data",
                text: "1900",
                originRow: 1,
                originColumn: 0,
                rowSpan: 1,
                columnSpan: 1,
                rowGroup: 1,
                explicitHeaderIds: [],
                associatedHeaderCellIds: ["year-header"],
                headerPath: ["Year"],
              },
              {
                id: "numeric-value",
                kind: "data",
                text: "10",
                originRow: 1,
                originColumn: 1,
                rowSpan: 1,
                columnSpan: 2,
                rowGroup: 1,
                explicitHeaderIds: [],
                associatedHeaderCellIds: ["value-header"],
                headerPath: ["Value"],
              },
            ],
            grid: [
              ["year-header", "value-header"],
              ["year-value", "numeric-value"],
            ],
          },
        },
      ],
      links: [],
      citationIds: [],
    },
    {
      key: "2",
      title: "Recognition",
      level: 1,
      sourceOrder: 4,
      parentKey: "__summary__",
      role: "body",
      fidelity: "complete",
      plaintextContent: "In 1828, recognition followed.",
      fallback: {
        text: "In 1828, recognition followed.",
        source: "dom-text",
      },
      blocks: [
        {
          id: "recognition-prose",
          sourceOrder: 5,
          contentHash: "recognition-prose-hash",
          kind: "prose",
          role: "paragraph",
          text: "In 1828, recognition followed.",
        },
      ],
      links: [],
      citationIds: [],
    },
    {
      key: "3",
      title: "References",
      level: 1,
      sourceOrder: 6,
      parentKey: "__summary__",
      role: "end-matter",
      fidelity: "complete",
      plaintextContent: "",
      fallback: { text: "", source: "dom-text" },
      blocks: [],
      links: [],
      citationIds: [],
    },
  ],
};

const fetchMetrics: AuditFetchMetrics = {
  requestCount: 1,
  cacheHits: 1,
  networkRequests: 0,
  responseBodyBytes: 2048,
  networkBodyBytes: 0,
  fetchDurationMs: 4.25,
};

describe("MediaWiki corpus audit", () => {
  it("parses refresh, limit, and output arguments strictly", () => {
    expect(
      parseAuditArgs(
        ["--refresh", "--limit=3", "--output", "audit-output"],
        "/workspace",
      ),
    ).toEqual({
      refresh: true,
      limit: 3,
      outputDirectory: "/workspace/audit-output",
      help: false,
    });
    expect(() => parseAuditArgs(["--limit", "0"])).toThrow(
      "--limit must be a positive integer.",
    );
    expect(() => parseAuditArgs(["--output", "--refresh"])).toThrow(
      "--output requires a value.",
    );
    expect(() => parseAuditArgs(["--surprise"])).toThrow(
      "Unknown argument: --surprise",
    );
  });

  it("aggregates section, block, issue, table, byte, and timing counts", () => {
    const article = summarizeArticleAudit({
      entry,
      document,
      durationMs: 12.5,
      fetch: fetchMetrics,
    });
    const report = buildAuditReport({
      generatedAt: new Date("2026-07-25T12:00:00.000Z"),
      corpusPath: "/workspace/scripts/mediawiki-corpus.json",
      availableArticles: 12,
      limit: 1,
      refresh: false,
      durationMs: 13,
      articles: [article],
    });

    expect(report.totals).toMatchObject({
      articles: 1,
      succeeded: 1,
      failed: 0,
      durationMs: 13,
      fetch: fetchMetrics,
      sourceFormats: { parsoid: 1 },
      sections: {
        total: 4,
        body: 3,
        endMatter: 1,
        complete: 3,
        partial: 1,
        plaintext: 0,
        empty: 1,
      },
      blocks: { prose: 2, table: 1 },
      issues: {
        total: 1,
        fallback: 1,
        skipped: 0,
        byCode: { "malformed-table": 1 },
      },
      tables: {
        tables: 1,
        rows: 2,
        columns: 2,
        cells: 4,
        spannedCells: 1,
        maximumRows: 2,
        maximumColumns: 2,
      },
      coverage: {
        passed: 1,
        failed: 0,
        expectedTags: 3,
        missingTags: 0,
        byMissingTag: {},
        narrationFailures: 0,
      },
    });
    expect(article.coverage).toMatchObject({
      passed: true,
      missing: [],
    });
    expect(article.coverage.detected).toEqual(
      expect.arrayContaining(["short-prose", "numeric-prose", "sections"]),
    );
    expect(article.projections).toMatchObject({
      narrations: 2,
      playableNarrations: 2,
      contextBlocks: 0,
      citations: 0,
      images: 0,
    });
    expect(hasAuditDiscrepancies(report)).toBe(false);

    const markdown = renderMarkdownReport(report);
    expect(markdown).toContain("# MediaWiki Corpus Audit");
    expect(markdown).toContain("- Response-cache hits: 1");
    expect(markdown).toContain("- malformed-table: 1");
    expect(markdown).toContain("### Walter Savage Landor");
    expect(markdown).toContain("Missing expected tags: none");
    expect(markdown).not.toContain("|");
  });

  it("reports and fails capability expectations that projections do not meet", () => {
    const article = summarizeArticleAudit({
      entry: { ...entry, expects: ["maps"] },
      document,
      durationMs: 12.5,
      fetch: fetchMetrics,
    });
    const report = buildAuditReport({
      generatedAt: new Date("2026-07-25T12:00:00.000Z"),
      corpusPath: "/workspace/scripts/mediawiki-corpus.json",
      availableArticles: 1,
      refresh: false,
      durationMs: 13,
      articles: [article],
    });

    expect(article.status).toBe("success");
    expect(article.coverage).toEqual({
      passed: false,
      detected: expect.any(Array),
      missing: ["maps"],
      narrationFailures: [],
    });
    expect(report.totals.coverage).toMatchObject({
      passed: 0,
      failed: 1,
      missingTags: 1,
      byMissingTag: { maps: 1 },
    });
    expect(hasAuditDiscrepancies(report)).toBe(true);
    expect(renderMarkdownReport(report)).toContain("- maps: 1");
  });

  it("fails section coverage when a substantive narration projection disappears", () => {
    const bodySections = document.sections.filter(
      (section) => section.role === "body",
    );
    const narrations = createSectionNarrationsFromDocument(document);

    expect(hasCompleteSectionNarrationCoverage(bodySections, narrations)).toBe(
      true,
    );
    expect(
      hasCompleteSectionNarrationCoverage(
        bodySections,
        narrations.filter((section) => section.wikiSectionIndex !== "2"),
      ),
    ).toBe(false);
  });

  it("rejects raw fallback for a section pinned as source-verbatim prose", () => {
    const sections = document.sections.map((section) =>
      section.key === "2"
        ? { ...section, fidelity: "partial" as const }
        : section,
    );
    const article = summarizeArticleAudit({
      entry,
      document: { ...document, sections },
      durationMs: 1,
      fetch: fetchMetrics,
    });

    expect(article.coverage.passed).toBe(false);
    expect(article.coverage.narrationFailures).toContain(
      "Section 2 (Recognition) unexpectedly used raw fallback narration.",
    );
  });

  it("pairs unsupported structures with raw fallback in the same section", () => {
    const unrelated = summarizeArticleAudit({
      entry: {
        ...entry,
        expects: ["unsupported-fallback"],
        narrationExpectations: undefined,
      },
      document,
      durationMs: 1,
      fetch: fetchMetrics,
    });
    expect(unrelated.coverage).toMatchObject({
      passed: false,
      missing: ["unsupported-fallback"],
    });

    const sections = document.sections.map((section) =>
      section.key === "1"
        ? {
            ...section,
            blocks: [
              {
                id: "unsupported-data-table",
                sourceOrder: 3,
                contentHash: "unsupported-data-table-hash",
                kind: "unsupported" as const,
                sourceKind: "table" as const,
                reason: "malformed-table" as const,
                affectsNarration: true,
              },
            ],
          }
        : section,
    );
    const paired = summarizeArticleAudit({
      entry: {
        ...entry,
        expects: ["unsupported-fallback"],
        narrationExpectations: undefined,
      },
      document: { ...document, sections },
      durationMs: 1,
      fetch: fetchMetrics,
    });
    expect(paired.coverage).toMatchObject({
      passed: true,
      missing: [],
    });
  });

  it("writes matching JSON and Markdown reports to the selected directory", async () => {
    const outputDirectory = await mkdtemp(
      path.join(os.tmpdir(), "mediawiki-corpus-audit-"),
    );
    try {
      const article = summarizeArticleAudit({
        entry,
        document,
        durationMs: 12.5,
        fetch: fetchMetrics,
      });
      const report = buildAuditReport({
        generatedAt: new Date("2026-07-25T12:00:00.000Z"),
        corpusPath: "/workspace/scripts/mediawiki-corpus.json",
        availableArticles: 12,
        refresh: false,
        durationMs: 13,
        articles: [article],
      });

      const paths = await writeAuditReports(report, outputDirectory);
      const [json, markdown] = await Promise.all([
        readFile(paths.jsonPath, "utf8"),
        readFile(paths.markdownPath, "utf8"),
      ]);

      expect(paths.jsonPath).toBe(
        path.join(outputDirectory, "mediawiki-corpus-audit.json"),
      );
      expect(JSON.parse(json)).toEqual(report);
      expect(markdown).toBe(renderMarkdownReport(report));
    } finally {
      await rm(outputDirectory, { recursive: true, force: true });
    }
  });
});
