import { describe, expect, it } from "vitest";
import type { FetchAndCacheResult } from "@/convex/articles";
import { getArticleExportSections } from "@/convex/articleExports";
import { buildPlayAllQueue } from "./article-audio-playback";
import { getPlayableSectionDurations } from "./article-audio-duration";
import { getPodcastSectionSources } from "./podcast-episode";
import { buildArticleNarrationTracks } from "./section-narration";
import { createTestSection } from "./test-section-narration";

describe("article narration consumers", () => {
  it("preserves the shared track text, order, key, and source hash everywhere", () => {
    const article = {
      _id: "article-1" as never,
      wikiPageId: "123",
      title: "Example article",
      language: "en",
      revisionId: "456",
      narrationVersion: 1,
      lastEdited: "2026-07-25T00:00:00.000Z",
      summary: "A concise source summary.",
      contentText: "unused",
      sections: [
        createTestSection({
          wikiSectionIndex: "1",
          title: "History",
          content: "The history is short but complete.",
        }),
        createTestSection({
          wikiSectionIndex: "2",
          title: "Works",
          content: "",
          narration: {
            mode: "transition",
            sourceFormat: "heading",
            text: "Next section: Works.",
          },
        }),
        createTestSection({
          wikiSectionIndex: "3",
          title: "Poetry",
          level: 3,
          content: "Lyric poems Narrative poems",
          narration: {
            mode: "structured",
            sourceFormat: "list",
            adapted: true,
            text: "Poetry. List with 2 items. Item 1: Lyric poems. Item 2: Narrative poems.",
          },
        }),
      ],
    } satisfies FetchAndCacheResult;
    const canonical = buildArticleNarrationTracks(article).map(
      ({ sectionKey, text, sourceHash }) => ({ sectionKey, text, sourceHash }),
    );

    expect(getArticleExportSections(article)).toEqual(canonical);
    expect(getPodcastSectionSources(article)).toEqual(canonical);
    expect(
      buildPlayAllQueue(article).map(({ sectionKey, text, sourceHash }) => ({
        sectionKey,
        text,
        sourceHash,
      })),
    ).toEqual(canonical);
    expect(
      getPlayableSectionDurations(article).map(({ sectionKey }) => sectionKey),
    ).toEqual(["summary", "section-0", "section-2"]);
  });
});
