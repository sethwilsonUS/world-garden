import { describe, expect, it } from "vitest";
import type { MediaWikiDocument } from "./mediawiki-document";
import { createParsedPageDataFromDocument } from "./mediawiki-document-metadata";

describe("createParsedPageDataFromDocument", () => {
  it("preserves MediaWiki section identity when headings repeat", () => {
    const repeatedSection = (
      key: string,
      sourceOrder: number,
      linkCount: number,
      citationId: string,
    ): MediaWikiDocument["sections"][number] => ({
      key,
      title: "History",
      level: 2,
      sourceOrder,
      parentKey: "__summary__",
      role: "body",
      fidelity: "complete",
      plaintextContent: `History ${key}.`,
      fallback: { text: `History ${key}.`, source: "dom-text" },
      links: Array.from({ length: linkCount }, (_, index) => ({
        targetTitle: `Linked article ${key}-${index}`,
        href: `https://en.wikipedia.org/wiki/Linked_article_${key}_${index}`,
        sourceOrder: sourceOrder + index + 1,
      })),
      citationIds: [citationId],
      blocks: [],
    });
    const document: MediaWikiDocument = {
      schemaVersion: 1,
      identity: {
        wikiPageId: "1",
        revisionId: "10",
        title: "Example",
        language: "en",
      },
      sourceFormat: "parsoid",
      sourceHash: "source",
      documentHash: "document",
      issues: [],
      citations: [
        { id: "cite-first", index: 1, text: "First source" },
        { id: "cite-second", index: 2, text: "Second source" },
      ],
      sections: [
        repeatedSection("3", 1, 1, "cite-first"),
        repeatedSection("8", 10, 2, "cite-second"),
      ],
    };

    const parsed = createParsedPageDataFromDocument(document);

    expect(parsed.linkCounts).toEqual([
      { index: "3", title: "History", count: 1 },
      { index: "8", title: "History", count: 2 },
    ]);
    expect(parsed.sectionCitations).toEqual([
      {
        index: "3",
        title: "History",
        count: 1,
        citationIds: ["cite-first"],
      },
      {
        index: "8",
        title: "History",
        count: 1,
        citationIds: ["cite-second"],
      },
    ]);
  });

  it("projects revision-matched links, citations, sections, and figure media", () => {
    const document: MediaWikiDocument = {
      schemaVersion: 1,
      identity: {
        wikiPageId: "1",
        revisionId: "10",
        title: "Example",
        language: "en",
      },
      sourceFormat: "parsoid",
      sourceHash: "source",
      documentHash: "document",
      issues: [],
      citations: [
        {
          id: "cite-note-1",
          index: 1,
          text: "Reliable source",
          url: "https://example.com/source",
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
          plaintextContent: "Lead.",
          fallback: { text: "Lead.", source: "dom-text" },
          links: [
            {
              targetTitle: "Poetry",
              href: "https://en.wikipedia.org/wiki/Poetry",
              sourceOrder: 1,
            },
          ],
          citationIds: ["cite-note-1"],
          blocks: [],
        },
        {
          key: "1",
          title: "History",
          level: 1,
          sourceOrder: 2,
          parentKey: "__summary__",
          anchor: "History",
          role: "body",
          fidelity: "complete",
          plaintextContent: "History.",
          fallback: { text: "History.", source: "dom-text" },
          links: [
            {
              targetTitle: "Poetry",
              href: "https://en.wikipedia.org/wiki/Poetry",
              sourceOrder: 3,
            },
            {
              targetTitle: "Drama",
              href: "https://en.wikipedia.org/wiki/Drama",
              sourceOrder: 4,
            },
          ],
          citationIds: ["cite-note-1"],
          blocks: [
            {
              kind: "figure",
              id: "figure-1",
              sourceOrder: 5,
              contentHash: "figure",
              caption: "A labeled historical diagram.",
              regions: [],
              media: [
                {
                  kind: "image",
                  src: "https://upload.wikimedia.org/wikipedia/commons/thumb/a/ab/History.png/640px-History.png",
                  resourceTitle: "File:History.png",
                  alt: "Historical diagram",
                  width: 640,
                  height: 480,
                },
                {
                  kind: "image",
                  src: "https://upload.wikimedia.org/wikipedia/commons/a/ab/Icon.png",
                  alt: "Tiny icon",
                  width: 48,
                  height: 48,
                },
                {
                  kind: "image",
                  src: "https://upload.wikimedia.org/wikipedia/commons/a/ab/Vector.svg",
                  alt: "Vector placeholder",
                  width: 640,
                  height: 480,
                },
              ],
            },
          ],
        },
      ],
    };

    expect(createParsedPageDataFromDocument(document)).toEqual({
      linkCounts: [
        { index: "__summary__", title: "__summary__", count: 1 },
        { index: "1", title: "History", count: 2 },
      ],
      citations: [
        {
          id: "cite-note-1",
          index: 1,
          text: "Reliable source",
          url: "https://example.com/source",
        },
      ],
      sectionCitations: [
        {
          index: "__summary__",
          title: "__summary__",
          count: 1,
          citationIds: ["cite-note-1"],
        },
        {
          index: "1",
          title: "History",
          count: 1,
          citationIds: ["cite-note-1"],
        },
      ],
      sectionIndexMap: [{ title: "History", index: "1" }],
      images: [
        {
          src: "https://upload.wikimedia.org/wikipedia/commons/thumb/a/ab/History.png/640px-History.png",
          alt: "Historical diagram",
          caption: "A labeled historical diagram.",
          width: 640,
          height: 480,
          attribution: expect.objectContaining({
            sourceTitle: "File:History.png",
          }),
        },
      ],
    });
  });
});
