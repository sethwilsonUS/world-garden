import { describe, expect, it } from "vitest";
import {
  findReusableArticleAudioExport,
  getArticleExportSections,
} from "./articleExports";

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

describe("findReusableArticleAudioExport", () => {
  it("does not reuse ready exports generated for a different TTS cache key", () => {
    const reusable = findReusableArticleAudioExport(
      [
        {
          _id: "old-export",
          status: "ready",
          updatedAt: 1,
          ttsCacheKey: "tts:edge:edge-tts:en-US-AriaNeural:edge-default:ttsNorm:2",
        },
        {
          _id: "new-export",
          status: "ready",
          updatedAt: 2,
          ttsCacheKey:
            "tts:openai:gpt-4o-mini-tts:marin:curio-warm-narrator-v1:ttsNorm:2",
        },
      ],
      "tts:openai:gpt-4o-mini-tts:marin:curio-warm-narrator-v1:ttsNorm:2",
    );

    expect(reusable?._id).toBe("new-export");
  });
});
