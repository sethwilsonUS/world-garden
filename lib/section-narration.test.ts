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

    expect(ARTICLE_SECTION_NARRATION_VERSION).toBe(2);
    expect(sections.map((section) => section.narration)).toEqual([
      expect.objectContaining({
        mode: "verbatim",
        sourceFormat: "prose",
        adapted: false,
        usedRawFallback: true,
        text: "Early life. In 1775 Landor was born. By 1794 he had left Oxford after a dispute involving several dates and people.",
      }),
      expect.objectContaining({
        mode: "verbatim",
        sourceFormat: "prose",
        adapted: false,
        usedRawFallback: true,
        text: "Artistic recognition. A bust dated 1828 is held in the National Portrait Gallery, London.",
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
    expect(hashNarrationText("Same text.")).toBe(
      hashNarrationText("Same text."),
    );
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
});
