import { useCallback, useContext } from "react";
import { DataContext } from "@/lib/data-context";
import { warmSummaryAudio, warmArticleImage } from "@/lib/audio-prefetch";

/**
 * Returns a stable callback that pre-fetches summary audio and the hero
 * image for an article, given its title.  Idempotent — safe to call
 * multiple times for the same title.
 */
export const usePrefetch = () => {
  const data = useContext(DataContext);
  const fetchArticle = data?.fetchArticle;

  return useCallback(
    (title: string) => {
      if (!fetchArticle) return;
      const slug = title.replace(/ /g, "_");
      warmSummaryAudio(slug, fetchArticle);
      warmArticleImage(slug, fetchArticle);
    },
    [fetchArticle],
  );
};
