import { describe, expect, it } from "vitest";
import {
  ARTICLE_SECTION_NARRATION_VERSION,
  buildArticleNarrationHash,
  buildArticleNarrationTracks,
  createSectionNarrations,
  hashNarrationText,
} from "./section-narration";

describe("section narration", () => {
  it("keeps short and numeric prose available verbatim", () => {
    const sections = createSectionNarrations({
      sections: [
        {
          wikiSectionIndex: "1",
          title: "Early life",
          level: 2,
          content:
            "In 1775 Landor was born. By 1794 he had left Oxford after a dispute involving several dates and people.",
        },
        {
          wikiSectionIndex: "2",
          title: "Artistic recognition",
          level: 2,
          content:
            "A bust dated 1828 is held in the National Portrait Gallery, London.",
        },
      ],
    });

    expect(ARTICLE_SECTION_NARRATION_VERSION).toBe(1);
    expect(sections.map((section) => section.narration)).toEqual([
      expect.objectContaining({
        mode: "verbatim",
        sourceFormat: "prose",
        adapted: false,
        usedRawFallback: true,
        text:
          "Early life. In 1775 Landor was born. By 1794 he had left Oxford after a dispute involving several dates and people.",
      }),
      expect.objectContaining({
        mode: "verbatim",
        sourceFormat: "prose",
        adapted: false,
        usedRawFallback: true,
        text:
          "Artistic recognition. A bust dated 1828 is held in the National Portrait Gallery, London.",
      }),
    ]);
    expect(
      buildArticleNarrationTracks({
        title: "Walter Savage Landor",
        summary: "An English writer, poet, and activist.",
        sections,
      }).map(({ sectionKey, text, individuallyPlayable }) => ({
        sectionKey,
        text,
        individuallyPlayable,
      })),
    ).toEqual([
      {
        sectionKey: "summary",
        text: "An English writer, poet, and activist.",
        individuallyPlayable: true,
      },
      {
        sectionKey: "section-0",
        text: sections[0].narration.text,
        individuallyPlayable: true,
      },
      {
        sectionKey: "section-1",
        text: sections[1].narration.text,
        individuallyPlayable: true,
      },
    ]);
  });

  it("produces stable, text-sensitive narration identities", () => {
    expect(hashNarrationText("Same text.")).toBe(hashNarrationText("Same text."));
    expect(hashNarrationText("Same text.")).not.toBe(
      hashNarrationText("Same texts."),
    );
    expect(hashNarrationText("")).toContain(
      `section-narration:${ARTICLE_SECTION_NARRATION_VERSION}`,
    );

    const article = {
      title: "Example",
      summary: "Lead.",
      sections: createSectionNarrations({
        sections: [
          {
            wikiSectionIndex: "1",
            title: "A",
            level: 2,
            content: "Body text.",
          },
        ],
      }),
    };
    expect(buildArticleNarrationHash(article)).toBe(
      buildArticleNarrationHash(article),
    );
    expect(
      buildArticleNarrationHash({ ...article, summary: "Different lead." }),
    ).not.toBe(buildArticleNarrationHash(article));
  });

  it("turns an empty parent into a queue-only transition and leaves an empty leaf silent", () => {
    const sections = createSectionNarrations({
      sections: [
        {
          wikiSectionIndex: "1",
          title: "Career",
          level: 2,
          content: "",
        },
        {
          wikiSectionIndex: "2",
          title: "Poetry",
          level: 3,
          content: "His poetry developed over several decades.",
        },
        {
          wikiSectionIndex: "3",
          title: "Unwritten appendix",
          level: 2,
          content: "",
        },
      ],
    });

    expect(sections[0].narration).toMatchObject({
      mode: "transition",
      sourceFormat: "heading",
      text: "Next section: Career.",
    });
    expect(sections[1].narration.mode).toBe("verbatim");
    expect(sections[2].narration).toMatchObject({
      mode: "none",
      sourceFormat: "heading",
      text: "",
    });

    const tracks = buildArticleNarrationTracks({
      title: "Example",
      sections,
    });
    expect(tracks.map((track) => track.sectionKey)).toEqual([
      "section-0",
      "section-1",
    ]);
    expect(tracks[0]).toMatchObject({
      mode: "transition",
      individuallyPlayable: false,
      countsTowardProgress: false,
    });
  });

  it("verbalizes semantic lists and tables in source order", () => {
    const [section] = createSectionNarrations({
      sections: [
        {
          wikiSectionIndex: "1",
          title: "Recognition",
          level: 2,
          content: "The gallery records two works. 2020 Example 2021 Another",
        },
      ],
      parsedSource: {
        html: [
          '<h2 id="Recognition">Recognition</h2>',
          "<p>The gallery records two works.</p>",
          "<ol><li>Portrait commission</li><li>Public memorial</li></ol>",
          "<table class=\"wikitable\"><caption>Awards</caption>",
          "<tr><th>Year</th><th>Work</th></tr>",
          "<tr><td>2020</td><td>Example</td></tr>",
          "<tr><td>2021</td><td>Another</td></tr></table>",
        ].join(""),
        sections: [
          {
            index: "1",
            line: "Recognition",
            anchor: "Recognition",
            level: "2",
          },
        ],
      },
    });

    expect(section.narration).toMatchObject({
      mode: "structured",
      sourceFormat: "mixed",
      adapted: true,
      usedRawFallback: false,
      text:
        "Recognition. The gallery records two works. List with 2 items. Item 1: Portrait commission. Item 2: Public memorial. Table: Awards. Columns: Year; Work. Row 1: Year: 2020; Work: Example. Row 2: Year: 2021; Work: Another.",
    });
  });

  it("removes complete script blocks even when their text contains closing tags", () => {
    const [section] = createSectionNarrations({
      sections: [
        {
          wikiSectionIndex: "1",
          title: "Items",
          level: 2,
          content: "Visible item.",
        },
      ],
      parsedSource: {
        html: [
          "<h2>Items</h2>",
          "<ul><li>Visible<script>const fake = '</b>'; forbidden words</script> item</li></ul>",
        ].join(""),
        sections: [{ index: "1", line: "Items", level: "2" }],
      },
    });

    expect(section.narration.text).toContain("Visible item");
    expect(section.narration.text).not.toContain("forbidden words");
  });

  it("caps large structured adaptations between complete items and announces the remainder", () => {
    const items = Array.from(
      { length: 500 },
      (_, index) => `<li>Source item ${index + 1}</li>`,
    ).join("");
    const [section] = createSectionNarrations({
      sections: [
        {
          wikiSectionIndex: "1",
          title: "Catalogue",
          level: 2,
          content: "A long catalogue.",
        },
      ],
      parsedSource: {
        html: `<h2>Catalogue</h2><ul>${items}</ul>`,
        sections: [{ index: "1", line: "Catalogue", level: "2" }],
      },
    });

    expect(section.narration.mode).toBe("structured");
    expect(section.narration.remainingSourceItems).toBeGreaterThan(0);
    expect(section.narration.text).toContain(
      "the complete data is available in the Wikipedia article",
    );
    expect(section.narration.text).not.toMatch(/Item \d+: Source item \d+ Source item/);
    expect(section.narration.text.split(/\s+/).length).toBeLessThanOrEqual(805);
  });

  it("preserves nested-list source order without folding children into parents", () => {
    const [section] = createSectionNarrations({
      sections: [
        {
          wikiSectionIndex: "1",
          title: "Works",
          level: 2,
          content: "Poetry Early poems Late poems Prose Essays",
        },
      ],
      parsedSource: {
        html: [
          "<h2>Works</h2>",
          "<ul>",
          "<li>Poetry<ul><li>Early poems</li><li>Late poems</li></ul></li>",
          "<li>Prose<ul><li>Essays</li></ul></li>",
          "</ul>",
        ].join(""),
        sections: [{ index: "1", line: "Works", level: "2" }],
      },
    });

    expect(section.narration).toMatchObject({
      mode: "structured",
      sourceFormat: "list",
      text:
        "Works. List with 5 items. Item 1: Poetry. Item 2, nested under item 1: Early poems. Item 3, nested under item 1: Late poems. Item 4: Prose. Item 5, nested under item 4: Essays.",
    });
  });

  it("falls back to the complete plaintext section for malformed structures", () => {
    const content = "Year Work 1828 Bust";
    const [section] = createSectionNarrations({
      sections: [
        {
          wikiSectionIndex: "1",
          title: "Recognition",
          level: 2,
          content,
        },
      ],
      parsedSource: {
        html: "<h2>Recognition</h2><table><tr><th>Year</th><th>Work</th></tr><tr><td rowspan=\"2\">1828</td><td>Bust</td></tr></table>",
        sections: [{ index: "1", line: "Recognition", level: "2" }],
      },
    });

    expect(section.narration).toMatchObject({
      mode: "verbatim",
      sourceFormat: "table",
      usedRawFallback: true,
      text: `Recognition. ${content}`,
    });
  });
});
