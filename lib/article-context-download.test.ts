import { describe, expect, it } from "vitest";
import {
  serializeArticleContextCsv,
  serializeArticleContextJson,
} from "./article-context-download";
import {
  ARTICLE_CONTEXT_EXTRACTOR_VERSION,
  ARTICLE_CONTEXT_SCHEMA_VERSION,
  type ContextManifest,
} from "./article-context-types";

const manifest: ContextManifest = {
  schemaVersion: ARTICLE_CONTEXT_SCHEMA_VERSION,
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
      caption: "Four labels are shown.",
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
          { id: "part-5", label: "\tformula trigger" },
          { id: "part-6", label: "\rformula trigger" },
        ],
        relationships: [],
        walkthrough: [],
      },
    },
  ],
};

describe("article context CSV downloads", () => {
  it("keeps the structured CSV contract unchanged for schema v2", () => {
    const [header] = serializeArticleContextCsv(manifest).split("\r\n");
    expect(header).toBe(
      "block_id,kind,section_index,section_title,item_type,item_id,label,start,end,latitude,longitude,series,x,value,unit,description,source_url,revision_id",
    );
  });

  it("neutralizes spreadsheet formulas from source-controlled strings", () => {
    const csv = serializeArticleContextCsv(manifest);
    expect(csv).toContain("'=2+2");
    expect(csv).toContain("'+CMD");
    expect(csv).toContain("'-10+20");
    expect(csv).toContain("'@SUM(A1:A2)");
    expect(csv).toContain("'\tformula trigger");
    expect(csv).toContain("'\rformula trigger");
  });

  it("serializes the schema-v2 caption contract without legacy audio copy", () => {
    const json = JSON.parse(serializeArticleContextJson(manifest));

    expect(json.schemaVersion).toBe(2);
    expect(json.blocks[0].caption).toBe("Four labels are shown.");
    expect(json.blocks[0]).not.toHaveProperty("takeaway");
    expect(json.blocks[0]).not.toHaveProperty("spokenSummary");
  });
});
