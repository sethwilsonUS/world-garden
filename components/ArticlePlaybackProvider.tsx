"use client";

import {
  createContext,
  useCallback,
  useContext,
  useLayoutEffect,
  useState,
  type ReactNode,
  type RefObject,
} from "react";
import dynamic from "next/dynamic";
import type { useArticleAudioController } from "@/hooks/useArticleAudioController";
import type { Article } from "@/lib/data-context";
const ArticlePlaybackSession = dynamic(
  () => import("./ArticlePlaybackSession"),
);

type Controller = ReturnType<typeof useArticleAudioController>;
export type ArticleSource = {
  slug: string;
  article: Article & { _id?: string };
};
export type ArticlePage = ArticleSource & {
  playAllButtonRef: RefObject<HTMLButtonElement | null>;
  showController: (controller: Controller) => void;
};

const ArticlePageContext = createContext<
  ((page: ArticlePage) => () => void) | null
>(null);

export function useArticlePlayback(
  slug: string,
  article: ArticleSource["article"] | null,
  playAllButtonRef: ArticlePage["playAllButtonRef"],
) {
  const register = useContext(ArticlePageContext);
  if (!register)
    throw new Error("Article playback requires ArticlePlaybackProvider.");
  const [controller, showController] = useState<Controller | null>(null);
  useLayoutEffect(() => {
    if (article)
      return register({ slug, article, playAllButtonRef, showController });
  }, [article, playAllButtonRef, register, slug]);
  return controller;
}

export function ArticlePlaybackProvider({ children }: { children: ReactNode }) {
  const [page, setPage] = useState<ArticlePage | null>(null);
  const [playing, setPlaying] = useState<ArticleSource | null>(null);
  const register = useCallback((next: ArticlePage) => {
    setPage(next);
    return () => setPage((current) => (current === next ? null : current));
  }, []);
  const release = useCallback((slug: string) => {
    setPlaying((current) => (current?.slug === slug ? null : current));
  }, []);

  // Keep only the visible article and the article the listener started.
  // Their keys preserve the controller and audio element through navigation.
  const sources: ArticleSource[] = [];
  if (page) sources.push(page);
  if (playing && page?.slug !== playing.slug) sources.push(playing);

  return (
    <ArticlePageContext.Provider value={register}>
      {children}
      {sources.map((source) => (
        <ArticlePlaybackSession
          key={source.slug}
          source={source}
          page={page?.slug === source.slug ? page : null}
          ownsPlayback={playing?.slug === source.slug}
          claim={setPlaying}
          release={release}
        />
      ))}
    </ArticlePageContext.Provider>
  );
}
