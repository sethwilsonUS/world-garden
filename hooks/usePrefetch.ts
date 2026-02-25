import { useCallback } from "react";
import { useData } from "@/lib/data-context";
import { warmSummaryAudio, warmArticleImage } from "@/lib/audio-prefetch";

/**
 * Returns a stable callback that pre-fetches summary audio and the hero
 * image for an article, given its title.  Idempotent — safe to call
 * multiple times for the same title.
 */
export const usePrefetch = () => {
  const { fetchArticle } = useData();

  return useCallback(
    (title: string) => {
      const slug = title.replace(/ /g, "_");
      warmSummaryAudio(slug, fetchArticle);
      warmArticleImage(slug, fetchArticle);
    },
    [fetchArticle],
  );
};
