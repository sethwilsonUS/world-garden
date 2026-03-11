import { describe, expect, it } from "vitest";
import { getArticleExportSections } from "./articleExports";

describe("getArticleExportSections", () => {
  it("includes only sections marked for full audio", () => {
    const result = getArticleExportSections({
      _id: "article-1" as never,
      title: "Example article",
      summary: "Lead summary with enough content to speak aloud.",
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
          title: "Election results",
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
