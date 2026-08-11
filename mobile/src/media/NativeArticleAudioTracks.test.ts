import type { WikipediaSection } from "@curio-garden/domain";

import { buildNativeArticleAudioItems } from "./NativeArticleAudioTracks";

function section(title: string, content: string, level = 2): WikipediaSection {
  return {
    content,
    level,
    title,
    wikiSectionIndex: "1",
  };
}

describe("buildNativeArticleAudioItems", () => {
  it("keeps canonical source indexes while classifying summary, playable sections, transitions, and empty headings", () => {
    const items = buildNativeArticleAudioItems({
      sections: [
        section("Origins", "Pumpkins originated in the Americas."),
        section("Cultivation", "", 2),
        section("Planting", "Seeds are planted after frost.", 3),
        section("Empty appendix", "", 2),
      ],
      summary: "  A pumpkin is a cultivated winter squash.  ",
    });

    expect(items).toEqual([
      {
        includedInPlayAll: true,
        individuallyPlayable: true,
        kind: "summary",
        sectionIndex: null,
        sectionKey: "summary",
        title: "Summary",
      },
      {
        includedInPlayAll: true,
        individuallyPlayable: true,
        kind: "section",
        sectionIndex: 0,
        sectionKey: "section-0",
        title: "Origins",
      },
      {
        includedInPlayAll: true,
        individuallyPlayable: false,
        kind: "transition",
        sectionIndex: 1,
        sectionKey: "section-1",
        title: "Cultivation",
      },
      {
        includedInPlayAll: true,
        individuallyPlayable: true,
        kind: "section",
        sectionIndex: 2,
        sectionKey: "section-2",
        title: "Planting",
      },
      {
        includedInPlayAll: false,
        individuallyPlayable: false,
        kind: "unavailable",
        sectionIndex: 3,
        sectionKey: "section-3",
        title: "Empty appendix",
      },
    ]);
  });

  it("omits an empty summary and uses stable visible labels without changing section keys", () => {
    expect(
      buildNativeArticleAudioItems({
        sections: [section("  ", "Readable source text")],
        summary: " \n ",
      }),
    ).toEqual([
      {
        includedInPlayAll: true,
        individuallyPlayable: true,
        kind: "section",
        sectionIndex: 0,
        sectionKey: "section-0",
        title: "Section 1",
      },
    ]);
  });

  it("only creates a transition when the immediately following section is a child", () => {
    expect(
      buildNativeArticleAudioItems({
        sections: [
          section("Parent", "", 2),
          section("Sibling", "", 2),
          section("Grandchild of sibling", "Readable", 3),
        ],
      }).map(({ kind, sectionKey }) => ({ kind, sectionKey })),
    ).toEqual([
      { kind: "unavailable", sectionKey: "section-0" },
      { kind: "transition", sectionKey: "section-1" },
      { kind: "section", sectionKey: "section-2" },
    ]);
  });
});
