import { describe, expect, it } from "vitest";
import { serializeArticleContextCsv } from "./article-context-download";
import {
  ARTICLE_CONTEXT_EXTRACTOR_VERSION,
  type ContextManifest,
} from "./article-context-types";

const manifest: ContextManifest = {
  schemaVersion: 1,
  wikiPageId: "42",
  title: "Formula safety",
  revisionId: "100",
  language: "en",
  sourceHash: "abc123",
  extractorVersion: ARTICLE_CONTEXT_EXTRACTOR_VERSION,
  generatedAt: "2026-07-13T00:00:00.000Z",
  blocks: [
    {
      id: "context-diagram-formula-safety",
      kind: "diagram",
      title: "Formula safety diagram",
      takeaway: "Four labels are shown.",
      spokenSummary: "Four externally sourced labels are listed.",
      longDescription: "The source labels are preserved as data.",
      section: { index: "1", title: "Example" },
      order: 0,
      sources: [
        {
          label: "Wikipedia revision",
          url: "https://en.wikipedia.org/w/index.php?oldid=100",
          revisionId: "100",
          accessedAt: "2026-07-13T00:00:00.000Z",
        },
      ],
      provenance: {
        articleUrl: "https://en.wikipedia.org/wiki/Formula_safety",
        articleRevisionUrl:
          "https://en.wikipedia.org/w/index.php?oldid=100",
        sourceHash: "abc123",
        extractorVersion: ARTICLE_CONTEXT_EXTRACTOR_VERSION,
        descriptionMethod: "deterministic",
      },
      diagram: {
        image: {
          src: "https://upload.wikimedia.org/example.svg",
          alt: "Formula safety diagram",
        },
        caption: "Formula safety",
        parts: [
          { id: "part-1", label: "=2+2" },
          { id: "part-2", label: "+CMD" },
          { id: "part-3", label: "-10+20" },
          { id: "part-4", label: "@SUM(A1:A2)" },
        ],
        relationships: [],
        walkthrough: [],
      },
    },
  ],
};

describe("article context CSV downloads", () => {
  it("neutralizes spreadsheet formulas from source-controlled strings", () => {
    const csv = serializeArticleContextCsv(manifest);
    expect(csv).toContain("'=2+2");
    expect(csv).toContain("'+CMD");
    expect(csv).toContain("'-10+20");
    expect(csv).toContain("'@SUM(A1:A2)");
  });
});
