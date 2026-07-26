import { describe, expect, it } from "vitest";
import {
  findReusableArticleAudioExport,
  getArticleExportSections,
  isArticleAudioExportCompatible,
  isArticleAudioExportReusable,
  isRequestedTtsMetadataValid,
} from "./articleExports";
import { buildTtsCacheKey, type TtsMetadata } from "../lib/tts-profile";
import {
  ARTICLE_SECTION_NARRATION_VERSION,
  buildArticleNarrationTracks,
} from "../lib/section-narration";
import { createTestSection } from "../lib/test-section-narration";

describe("getArticleExportSections", () => {
  it("includes every narrated section", () => {
    const article = {
      _id: "article-1" as never,
      title: "Example article",
      revisionId: "100",
      narrationVersion: ARTICLE_SECTION_NARRATION_VERSION,
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
    };
    const result = getArticleExportSections(article);
    const sourceHashes = new Map(
      buildArticleNarrationTracks(article).map((track) => [
        track.sectionKey,
        track.sourceHash,
      ]),
    );

    expect(result).toEqual([
      {
        sectionKey: "summary",
        text: "Lead summary with enough content to speak aloud.",
        sourceHash: sourceHashes.get("summary"),
      },
      {
        sectionKey: "section-0",
        text: "History. The city rebuilt its harbor after the storm. Officials later expanded the rail connection to the capital.",
        sourceHash: sourceHashes.get("section-0"),
      },
      {
        sectionKey: "section-1",
        text: "Election results. Table. Columns: Year; Candidate; Vote. Row 1: Year: 2020; Candidate: Rivera; Vote: 51.2%. Row 2: Year: 2022; Candidate: Patel; Vote: 49.8%.",
        sourceHash: sourceHashes.get("section-1"),
      },
    ]);
  });

  it("keeps visual captions and descriptions out of packaged article audio", () => {
    const articleWithVisualContext = {
      _id: "article-1" as never,
      title: "Example article",
      revisionId: "100",
      narrationVersion: ARTICLE_SECTION_NARRATION_VERSION,
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
    const summarySourceHash = buildArticleNarrationTracks(
      articleWithVisualContext,
    )[0].sourceHash;

    expect(result).toEqual([
      {
        sectionKey: "summary",
        text: "Lead summary with enough content to speak aloud.",
        sourceHash: summarySourceHash,
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
          ttsCacheKey:
            "tts:edge:edge-tts:en-US-AriaNeural:edge-default:ttsNorm:2",
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

  it("keeps a fallback export deliverable but does not reuse it as primary-profile audio", () => {
    const fallbackExport = {
      _id: "fallback-export",
      status: "ready",
      updatedAt: 1,
      narrationHash: "current-narration",
      ttsCacheKey: "requested-primary-profile",
      producedTtsCacheKey: "produced-fallback-profile",
    };

    expect(
      isArticleAudioExportCompatible(
        fallbackExport,
        "requested-primary-profile",
        "current-narration",
      ),
    ).toBe(true);
    expect(
      isArticleAudioExportReusable(
        fallbackExport,
        "requested-primary-profile",
        "current-narration",
      ),
    ).toBe(false);
    expect(
      findReusableArticleAudioExport(
        [fallbackExport],
        "requested-primary-profile",
        "current-narration",
      ),
    ).toBeUndefined();
  });
});

describe("isArticleAudioExportCompatible", () => {
  it("rejects exports from a different TTS profile even when narration matches", () => {
    expect(
      isArticleAudioExportCompatible(
        {
          narrationHash: "current-narration",
          ttsCacheKey: "previous-profile",
        },
        "current-profile",
        "current-narration",
      ),
    ).toBe(false);
  });

  it("accepts an export only when both TTS profile and narration match", () => {
    expect(
      isArticleAudioExportCompatible(
        {
          narrationHash: "current-narration",
          ttsCacheKey: "current-profile",
        },
        "current-profile",
        "current-narration",
      ),
    ).toBe(true);
  });
});

describe("isRequestedTtsMetadataValid", () => {
  const metadata = (() => {
    const profile = {
      provider: "edge" as const,
      model: "edge-tts",
      voiceId: "en-US-AriaNeural",
      promptVersion: "edge-default",
      ttsNormVersion: "ttsNorm:2",
    };
    return {
      ...profile,
      ttsCacheKey: buildTtsCacheKey(profile),
    } satisfies TtsMetadata;
  })();

  it("accepts a complete profile supplied by the initiating server", () => {
    expect(isRequestedTtsMetadataValid(metadata)).toBe(true);
  });

  it("rejects a profile whose cache identity does not match its fields", () => {
    expect(
      isRequestedTtsMetadataValid({
        ...metadata,
        voiceId: "en-US-GuyNeural",
      }),
    ).toBe(false);
  });
});
