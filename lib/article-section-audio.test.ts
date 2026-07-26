import { describe, expect, it } from "vitest";
import { resolveCanonicalArticleNarrationTrack } from "./article-section-audio";
import { buildArticleNarrationTracks } from "./section-narration";

const article = {
  title: "The Silmarillion",
  summary: "A history of the elder days of Middle-earth.",
  sections: [
    {
      wikiSectionIndex: "1",
      title: "First Age",
      level: 2,
      content: "Raw source text",
      narration: {
        mode: "verbatim" as const,
        text: "Canonical narration for the First Age.",
        sourceFormat: "prose" as const,
        adapted: false,
        usedRawFallback: false,
        sourceHash: "section-source-hash",
      },
    },
  ],
};

describe("resolveCanonicalArticleNarrationTrack", () => {
  it("returns only the server-derived track matching key and source hash", () => {
    const summary = buildArticleNarrationTracks(article).find(
      (track) => track.sectionKey === "summary",
    )!;

    expect(
      resolveCanonicalArticleNarrationTrack(
        article,
        summary.sectionKey,
        summary.sourceHash,
      ),
    ).toEqual(summary);
  });

  it("rejects stale source hashes and unknown section keys", () => {
    expect(
      resolveCanonicalArticleNarrationTrack(article, "summary", "stale"),
    ).toBeNull();
    expect(
      resolveCanonicalArticleNarrationTrack(
        article,
        "section-999",
        "section-source-hash",
      ),
    ).toBeNull();
  });
});
