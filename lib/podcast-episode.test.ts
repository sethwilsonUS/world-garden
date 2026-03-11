import { describe, expect, it } from "vitest";
import { getPodcastSectionSources } from "./podcast-episode";

describe("getPodcastSectionSources", () => {
  it("uses only full-audio sections for the featured podcast", () => {
    const result = getPodcastSectionSources({
      _id: "article-1" as never,
      wikiPageId: "123",
      title: "Example article",
      language: "en",
      revisionId: "1",
      lastEdited: "2026-03-10T00:00:00Z",
      summary: "Lead summary with enough content to speak aloud.",
      contentText: "unused",
      sections: [
        {
          title: "History",
          level: 2,
          content:
            "The city rebuilt its harbor after the storm. Officials later expanded the rail connection to the capital.",
          audioMode: "full",
          audioReason: "eligible",
        },
        {
          title: "Results",
          level: 2,
          content: [
            "Year  Candidate  Vote",
            "2020  Rivera     51.2%",
            "2022  Patel      49.8%",
          ].join("\n"),
          audioMode: "unavailable",
          audioReason: "table_like",
        },
      ],
    });

    expect(result).toEqual([
      {
        sectionKey: "summary",
        text: "Lead summary with enough content to speak aloud.",
      },
      {
        sectionKey: "section-0",
        text:
          "History. The city rebuilt its harbor after the storm. Officials later expanded the rail connection to the capital.",
      },
    ]);
  });
});
