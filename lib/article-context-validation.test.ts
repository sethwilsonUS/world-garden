import { describe, expect, it } from "vitest";
import {
  ARTICLE_CONTEXT_EXTRACTOR_VERSION,
  ARTICLE_CONTEXT_SCHEMA_VERSION,
  type ContextDiagramBlock,
  type ContextManifest,
} from "./article-context-types";
import { validateContextManifest } from "./article-context-validation";

const diagram: ContextDiagramBlock = {
  id: "olympics-medal-map",
  kind: "diagram",
  title: "2024 Olympics medal map",
  caption: "World map showing medal achievements.",
  longDescription: "The map includes a complete source-derived legend.",
  section: { index: "1", title: "Medal table" },
  order: 0,
  sources: [
    {
      label: "Wikipedia revision",
      url: "https://en.wikipedia.org/w/index.php?oldid=1341989215",
      revisionId: "1341989215",
      accessedAt: "2026-07-26T00:00:00.000Z",
    },
  ],
  provenance: {
    articleUrl:
      "https://en.wikipedia.org/wiki/2024_Summer_Olympics_medal_table",
    articleRevisionUrl: "https://en.wikipedia.org/w/index.php?oldid=1341989215",
    sourceHash: "source-hash",
    extractorVersion: ARTICLE_CONTEXT_EXTRACTOR_VERSION,
    descriptionMethod: "deterministic",
  },
  diagram: {
    image: {
      src: "https://upload.wikimedia.org/wikipedia/commons/a/ab/Medal_map.png",
      alt: "World map showing medal achievements",
    },
    parts: [],
    relationships: [],
    walkthrough: ["World map showing medal achievements."],
    caption: "World map showing medal achievements and its source legend.",
    legend: {
      description: "World map showing medal achievements.",
      entries: [
        {
          color: "#FFD700",
          text: "represents countries that won at least one gold medal.",
        },
        {
          color: "rgb(192 192 192)",
          text: "represents countries that won silver but no gold.",
        },
      ],
      notes: ["Neutral athletes are not represented on the map."],
    },
  },
};

const manifest: ContextManifest = {
  schemaVersion: ARTICLE_CONTEXT_SCHEMA_VERSION,
  wikiPageId: "76850406",
  title: "2024 Summer Olympics medal table",
  revisionId: "1341989215",
  language: "en",
  sourceHash: "source-hash",
  extractorVersion: ARTICLE_CONTEXT_EXTRACTOR_VERSION,
  generatedAt: "2026-07-26T00:00:00.000Z",
  blocks: [diagram],
};

describe("article context legend validation", () => {
  it("accepts bounded source colors and rejects CSS-capable payloads", () => {
    expect(validateContextManifest(manifest)).toEqual([]);

    const unsafe: ContextManifest = {
      ...manifest,
      blocks: [
        {
          ...diagram,
          diagram: {
            ...diagram.diagram,
            legend: {
              description: "World map showing medal achievements.",
              entries: [
                {
                  color: "url(https://example.com/tracker)",
                  text: "Unsafe source color.",
                },
              ],
              notes: [],
            },
          },
        },
      ],
    };

    expect(validateContextManifest(unsafe)).toContain(
      "Diagram olympics-medal-map contains an invalid legend",
    );
  });

  it.each(["rgb(1)", "rgb(none none none)", "hsl(20 30 40)"])(
    "rejects malformed functional color %s",
    (color) => {
      const malformed: ContextManifest = {
        ...manifest,
        blocks: [
          {
            ...diagram,
            diagram: {
              ...diagram.diagram,
              legend: {
                description: "World map showing medal achievements.",
                entries: [{ color, text: "Malformed source color." }],
                notes: [],
              },
            },
          },
        ],
      };

      expect(validateContextManifest(malformed)).toContain(
        "Diagram olympics-medal-map contains an invalid legend",
      );
    },
  );
});
