"use client";

import { useEffect, useState } from "react";
import { useData, type ArticleImage } from "@/lib/data-context";

type GalleryImagesState = {
  key: string;
  images: ArticleImage[];
  loading: boolean;
};

const loadingState = (key: string): GalleryImagesState => ({
  key,
  images: [],
  loading: true,
});

export const useArticleGalleryImages = (wikiPageId: string) => {
  const { getArticleImages } = useData();
  const [state, setState] = useState<GalleryImagesState>(() =>
    loadingState(wikiPageId),
  );

  useEffect(() => {
    const controller = new AbortController();
    const key = wikiPageId;

    void getArticleImages({ wikiPageId })
      .then((images) => {
        if (controller.signal.aborted) return;
        setState({ key, images, loading: false });
      })
      .catch(() => {
        if (controller.signal.aborted) return;
        // Gallery is supplemental; preserve the existing silent failure state.
        setState({ key, images: [], loading: false });
      });

    return () => controller.abort();
  }, [getArticleImages, wikiPageId]);

  return state.key === wikiPageId ? state : loadingState(wikiPageId);
};
