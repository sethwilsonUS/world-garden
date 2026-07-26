import { useCallback, useContext } from "react";
import { DataContext } from "@/lib/data-context";
import { warmSummaryAudio, warmArticleImage } from "@/lib/audio-prefetch";
import { useTtsProfile } from "@/lib/tts-audience";

/**
 * Returns a stable callback that pre-fetches summary audio and the hero
 * image for an article, given its title.  Idempotent — safe to call
 * multiple times for the same title.
 */
export const usePrefetch = () => {
  const data = useContext(DataContext);
  const fetchArticle = data?.fetchArticle;
  const ttsProfile = useTtsProfile();

  return useCallback(
    (title: string) => {
      if (!fetchArticle) return;
      const slug = title.replace(/ /g, "_");
      warmSummaryAudio(slug, fetchArticle, ttsProfile);
      warmArticleImage(slug, fetchArticle);
    },
    [fetchArticle, ttsProfile],
  );
};
