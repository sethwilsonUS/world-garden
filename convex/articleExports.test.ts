import { describe, expect, it } from "vitest";
import {
  findReusableArticleAudioExport,
  getArticleExportSections,
} from "./articleExports";
import { hashNarrationText } from "../lib/section-narration";
import { createTestSection } from "../lib/test-section-narration";

describe("getArticleExportSections", () => {
  it("includes every narrated section", () => {
    const result = getArticleExportSections({
      _id: "article-1" as never,
      title: "Example article",
      summary: "Lead summary with enough content to speak aloud.",
      sections: [
        createTestSection({
          title: "History",
          level: 2,
          content:
            "The city rebuilt its harbor after the storm. Officials later expanded the rail connection to the capital.",
        }),
        createTestSection({
          title: "Election results",
          level: 2,
          content: [
            "Year  Candidate  Vote",
            "2020  Rivera     51.2%",
            "2022  Patel      49.8%",
          ].join("\n"),
          narration: {
            mode: "structured",
            sourceFormat: "table",
            adapted: true,
            text: "Election results. Table. Columns: Year; Candidate; Vote. Row 1: Year: 2020; Candidate: Rivera; Vote: 51.2%. Row 2: Year: 2022; Candidate: Patel; Vote: 49.8%.",
          },
        }),
      ],
    });

    expect(result).toEqual([
      {
        sectionKey: "summary",
        text: "Lead summary with enough content to speak aloud.",
        sourceHash: hashNarrationText(
          "Lead summary with enough content to speak aloud.",
        ),
      },
      {
        sectionKey: "section-0",
        text:
          "History. The city rebuilt its harbor after the storm. Officials later expanded the rail connection to the capital.",
        sourceHash: hashNarrationText(
          "History. The city rebuilt its harbor after the storm. Officials later expanded the rail connection to the capital.",
        ),
      },
      {
        sectionKey: "section-1",
        text: "Election results. Table. Columns: Year; Candidate; Vote. Row 1: Year: 2020; Candidate: Rivera; Vote: 51.2%. Row 2: Year: 2022; Candidate: Patel; Vote: 49.8%.",
        sourceHash: hashNarrationText(
          "Election results. Table. Columns: Year; Candidate; Vote. Row 1: Year: 2020; Candidate: Rivera; Vote: 51.2%. Row 2: Year: 2022; Candidate: Patel; Vote: 49.8%.",
        ),
      },
    ]);
  });

  it("keeps visual captions and descriptions out of packaged article audio", () => {
    const articleWithVisualContext = {
      _id: "article-1" as never,
      title: "Example article",
      summary: "Lead summary with enough content to speak aloud.",
      sections: [],
      contextBlocks: [
        {
          id: "timeline-context",
          title: "A short chronology",
          caption: "The milestone happened in 1969.",
          longDescription: "The chronology contains one milestone in 1969.",
        },
      ],
    };

    const result = getArticleExportSections(articleWithVisualContext);

    expect(result).toEqual([
      {
        sectionKey: "summary",
        text: "Lead summary with enough content to speak aloud.",
        sourceHash: hashNarrationText(
          "Lead summary with enough content to speak aloud.",
        ),
      },
    ]);
    expect(JSON.stringify(result)).not.toContain("milestone");
    expect(JSON.stringify(result)).not.toContain("context-");
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
          narrationHash: "current-narration",
          ttsCacheKey: "tts:edge:edge-tts:en-US-AriaNeural:edge-default:ttsNorm:2",
        },
        {
          _id: "new-export",
          status: "ready",
          updatedAt: 2,
          narrationHash: "current-narration",
          ttsCacheKey:
            "tts:openai:gpt-4o-mini-tts:marin:curio-warm-narrator-v1:ttsNorm:2",
        },
      ],
      "tts:openai:gpt-4o-mini-tts:marin:curio-warm-narrator-v1:ttsNorm:2",
      "current-narration",
    );

    expect(reusable?._id).toBe("new-export");
  });

  it("does not reuse an export from older narration", () => {
    expect(
      findReusableArticleAudioExport(
        [
          {
            _id: "old-export",
            status: "ready",
            updatedAt: 1,
            narrationHash: "old-narration",
            ttsCacheKey: "current-tts",
          },
        ],
        "current-tts",
        "current-narration",
      ),
    ).toBeUndefined();
  });
});
