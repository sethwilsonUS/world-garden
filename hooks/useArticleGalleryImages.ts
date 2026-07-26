"use client";

import { useEffect, useState } from "react";
import {
  useData,
  type ArticleImage,
  type WikipediaRevisionIdentity,
} from "@/lib/data-context";
import { wikipediaRevisionKey } from "@/lib/wikipedia-utils";

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

export const useArticleGalleryImages = (
  identity: WikipediaRevisionIdentity,
) => {
  const { getArticleImages } = useData();
  const { wikiPageId, revisionId, title, language } = identity;
  const identityKey = wikipediaRevisionKey(identity);
  const [state, setState] = useState<GalleryImagesState>(() =>
    loadingState(identityKey),
  );

  useEffect(() => {
    const controller = new AbortController();
    const key = identityKey;
    const requestIdentity = { wikiPageId, revisionId, title, language };

    void getArticleImages({
      identity: requestIdentity,
      signal: controller.signal,
    })
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
  }, [getArticleImages, identityKey, language, revisionId, title, wikiPageId]);

  return state.key === identityKey ? state : loadingState(identityKey);
};
