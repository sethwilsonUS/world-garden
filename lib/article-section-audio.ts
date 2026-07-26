import {
  buildArticleNarrationTracks,
  type ArticleNarrationSource,
  type ArticleNarrationTrack,
} from "./section-narration";

/**
 * Resolves narration from the persisted article instead of accepting text
 * from the browser. This is the cache-poisoning boundary for shared audio.
 */
export const resolveCanonicalArticleNarrationTrack = (
  article: ArticleNarrationSource,
  sectionKey: string,
  sourceHash: string,
): ArticleNarrationTrack | null =>
  buildArticleNarrationTracks(article).find(
    (track) =>
      track.sectionKey === sectionKey && track.sourceHash === sourceHash,
  ) ?? null;
