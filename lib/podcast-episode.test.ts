import { afterEach, describe, expect, it, vi } from "vitest";
import type { FetchAndCacheResult } from "@/convex/articles";
import {
  ARTICLE_SECTION_NARRATION_VERSION,
  buildArticleNarrationHash,
  buildArticleNarrationTracks,
} from "./section-narration";
import { createTestSection } from "./test-section-narration";
import {
  doesTtsMetadataMatch,
  getPodcastSectionSources,
  hasCurrentFeaturedArtworkVersion,
  shouldReuseExistingFeaturedEpisode,
} from "./podcast-episode";
import { getTtsMetadata, getTtsProfile } from "./tts-profile";

describe("getPodcastSectionSources", () => {
  it("uses every narrated section for the featured podcast", () => {
    const article = {
      _id: "article-1" as never,
      wikiPageId: "123",
      title: "Example article",
      language: "en",
      revisionId: "1",
      narrationVersion: ARTICLE_SECTION_NARRATION_VERSION,
      lastEdited: "2026-03-10T00:00:00Z",
      summary: "Lead summary with enough content to speak aloud.",
      contentText: "unused",
      sections: [
        createTestSection({
          title: "History",
          level: 2,
          content:
            "The city rebuilt its harbor after the storm. Officials later expanded the rail connection to the capital.",
        }),
        createTestSection({
          title: "Results",
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
            text: "Results. Table. Columns: Year; Candidate; Vote. Row 1: Year: 2020; Candidate: Rivera; Vote: 51.2%. Row 2: Year: 2022; Candidate: Patel; Vote: 49.8%.",
          },
        }),
      ],
    } satisfies FetchAndCacheResult;
    const result = getPodcastSectionSources(article);
    const canonicalSources = buildArticleNarrationTracks(article).map(
      ({ sectionKey, text, sourceHash }) => ({ sectionKey, text, sourceHash }),
    );

    expect(result).toEqual(canonicalSources);
    expect(result.map(({ sectionKey }) => sectionKey)).toEqual([
      "summary",
      "section-0",
      "section-1",
    ]);
  });
});

describe("shouldReuseExistingFeaturedEpisode", () => {
  const edge = getTtsMetadata(getTtsProfile("edge"));
  afterEach(() => vi.unstubAllEnvs());
  const article = {
    _id: "article-1" as never,
    wikiPageId: "123",
    title: "Example article",
    language: "en",
    revisionId: "1",
    narrationVersion: ARTICLE_SECTION_NARRATION_VERSION,
    lastEdited: "2026-03-10T00:00:00Z",
    summary: "A current summary.",
    contentText: "unused",
    sections: [],
  } satisfies FetchAndCacheResult;
  const narrationHash = buildArticleNarrationHash(article);

  it("reuses an existing ready episode when it matches the current article", () => {
    expect(
      shouldReuseExistingFeaturedEpisode({
        force: false,
        regenArt: false,
        existingEpisode: {
          status: "ready",
          wikiPageId: "123",
          title: "Example article",
          artworkVersion: 2,
          audioUrl: "https://cdn.example.test/episode.mp3",
          narrationHash,
          ...edge,
        } as Parameters<
          typeof shouldReuseExistingFeaturedEpisode
        >[0]["existingEpisode"],
        article,
      }),
    ).toBe(true);
  });

  it("uses the public Edge cache identity even when a legacy primary is configured", () => {
    vi.stubEnv("TTS_PRIMARY_PROVIDER", "openai");

    expect(
      shouldReuseExistingFeaturedEpisode({
        force: false,
        regenArt: false,
        existingEpisode: {
          status: "ready",
          wikiPageId: "123",
          title: "Example article",
          artworkVersion: 2,
          audioUrl: "https://cdn.example.test/episode.mp3",
          narrationHash,
          ...edge,
        } as Parameters<
          typeof shouldReuseExistingFeaturedEpisode
        >[0]["existingEpisode"],
        article,
      }),
    ).toBe(true);
  });

  it("does not reuse a mismatched ready episode for the same featured date", () => {
    expect(
      shouldReuseExistingFeaturedEpisode({
        force: false,
        regenArt: false,
        existingEpisode: {
          status: "ready",
          wikiPageId: "999",
          title: "Older featured article",
          artworkVersion: 2,
          audioUrl: "https://cdn.example.test/episode.mp3",
          narrationHash,
          ...edge,
        } as Parameters<
          typeof shouldReuseExistingFeaturedEpisode
        >[0]["existingEpisode"],
        article,
      }),
    ).toBe(false);
  });

  it("does not reuse when force is enabled", () => {
    expect(
      shouldReuseExistingFeaturedEpisode({
        force: true,
        regenArt: false,
        existingEpisode: {
          status: "ready",
          wikiPageId: "123",
          title: "Example article",
          artworkVersion: 2,
          audioUrl: "https://cdn.example.test/episode.mp3",
          narrationHash,
          ...edge,
        } as Parameters<
          typeof shouldReuseExistingFeaturedEpisode
        >[0]["existingEpisode"],
        article,
      }),
    ).toBe(false);
  });

  it("does not reuse when regenArt is requested for an older artwork version", () => {
    expect(
      shouldReuseExistingFeaturedEpisode({
        force: false,
        regenArt: true,
        existingEpisode: {
          status: "ready",
          wikiPageId: "123",
          title: "Example article",
          artworkVersion: 1,
          audioUrl: "https://cdn.example.test/episode.mp3",
          narrationHash,
          ...edge,
        } as Parameters<
          typeof shouldReuseExistingFeaturedEpisode
        >[0]["existingEpisode"],
        article,
      }),
    ).toBe(false);
  });

  it("reuses when regenArt is requested but artwork is already current", () => {
    expect(
      shouldReuseExistingFeaturedEpisode({
        force: false,
        regenArt: true,
        existingEpisode: {
          status: "ready",
          wikiPageId: "123",
          title: "Example article",
          artworkVersion: 2,
          audioUrl: "https://cdn.example.test/episode.mp3",
          narrationHash,
          ...edge,
        } as Parameters<
          typeof shouldReuseExistingFeaturedEpisode
        >[0]["existingEpisode"],
        article,
      }),
    ).toBe(true);
  });

  it("does not reuse ready audio from a different TTS cache key", () => {
    expect(
      shouldReuseExistingFeaturedEpisode({
        force: false,
        regenArt: false,
        existingEpisode: {
          status: "ready",
          wikiPageId: "123",
          title: "Example article",
          artworkVersion: 2,
          audioUrl: "https://cdn.example.test/episode.mp3",
          narrationHash,
          ...edge,
          ttsCacheKey: getTtsProfile("openai").ttsCacheKey,
        } as Parameters<
          typeof shouldReuseExistingFeaturedEpisode
        >[0]["existingEpisode"],
        article,
      }),
    ).toBe(false);
  });

  it.each([
    ["provider", "openai"],
    ["model", "gpt-4o-mini-tts"],
    ["voiceId", "alloy"],
    ["promptVersion", "curio-warm-narrator-v1"],
  ] as const)(
    "does not reuse an Edge-keyed episode with spoofed %s metadata",
    (field, spoofedValue) => {
      expect(
        shouldReuseExistingFeaturedEpisode({
          force: false,
          regenArt: false,
          existingEpisode: {
            status: "ready",
            wikiPageId: "123",
            title: "Example article",
            artworkVersion: 2,
            audioUrl: "https://cdn.example.test/episode.mp3",
            narrationHash,
            ...edge,
            [field]: spoofedValue,
          },
          article,
        }),
      ).toBe(false);
    },
  );

  it("does not reuse ready audio from an older normalization version", () => {
    expect(
      shouldReuseExistingFeaturedEpisode({
        force: false,
        regenArt: false,
        existingEpisode: {
          status: "ready",
          wikiPageId: "123",
          title: "Example article",
          artworkVersion: 2,
          audioUrl: "https://cdn.example.test/episode.mp3",
          narrationHash,
          ...edge,
          ttsNormVersion: "ttsNorm:1",
        } as Parameters<
          typeof shouldReuseExistingFeaturedEpisode
        >[0]["existingEpisode"],
        article,
      }),
    ).toBe(false);
  });

  it("does not reuse ready audio from older narration text", () => {
    expect(
      shouldReuseExistingFeaturedEpisode({
        force: false,
        regenArt: false,
        existingEpisode: {
          status: "ready",
          wikiPageId: "123",
          title: "Example article",
          artworkVersion: 2,
          audioUrl: "https://cdn.example.test/episode.mp3",
          narrationHash: "older-narration",
          ...edge,
        } as Parameters<
          typeof shouldReuseExistingFeaturedEpisode
        >[0]["existingEpisode"],
        article,
      }),
    ).toBe(false);
  });

  it("does not reuse a ready row whose audio asset is unavailable", () => {
    expect(
      shouldReuseExistingFeaturedEpisode({
        force: false,
        regenArt: false,
        existingEpisode: {
          status: "ready",
          wikiPageId: "123",
          title: "Example article",
          artworkVersion: 2,
          audioUrl: null,
          narrationHash,
          ...edge,
        } as Parameters<
          typeof shouldReuseExistingFeaturedEpisode
        >[0]["existingEpisode"],
        article,
      }),
    ).toBe(false);
  });
});

describe("doesTtsMetadataMatch", () => {
  it("requires the full TTS profile to match", () => {
    const expected = getTtsMetadata(getTtsProfile("openai"));

    expect(doesTtsMetadataMatch({ ...expected }, expected)).toBe(true);
    expect(
      doesTtsMetadataMatch(
        { ...expected, voiceId: "alloy", ttsCacheKey: expected.ttsCacheKey },
        expected,
      ),
    ).toBe(false);
    expect(
      doesTtsMetadataMatch(
        { ...expected, ttsNormVersion: "ttsNorm:1" },
        expected,
      ),
    ).toBe(false);
  });
});

describe("hasCurrentFeaturedArtworkVersion", () => {
  it("detects the current artwork version", () => {
    expect(
      hasCurrentFeaturedArtworkVersion({
        artworkVersion: 2,
      } as Parameters<typeof hasCurrentFeaturedArtworkVersion>[0]),
    ).toBe(true);

    expect(
      hasCurrentFeaturedArtworkVersion({
        artworkVersion: 1,
      } as Parameters<typeof hasCurrentFeaturedArtworkVersion>[0]),
    ).toBe(false);
  });
});
