"use client";

import {
  createContext,
  useCallback,
  useContext,
  useLayoutEffect,
  useMemo,
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

const ArticlePageContext = createContext<{
  register: (page: ArticlePage) => () => void;
  playing: ArticleSource | null;
} | null>(null);

export function useArticlePlayback(
  slug: string,
  fetchedArticle: ArticleSource["article"] | null,
  playAllButtonRef: ArticlePage["playAllButtonRef"],
) {
  const context = useContext(ArticlePageContext);
  if (!context)
    throw new Error("Article playback requires ArticlePlaybackProvider.");
  const { register, playing } = context;
  // Keep section indices, visible text and audio on the same Wikipedia revision.
  const article = playing?.slug === slug ? playing.article : fetchedArticle;
  const [controller, showController] = useState<Controller | null>(null);
  useLayoutEffect(() => {
    if (article)
      return register({ slug, article, playAllButtonRef, showController });
  }, [article, playAllButtonRef, register, slug]);
  return { article, controller };
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
  if (playing) sources.push(playing);
  if (page && page.slug !== playing?.slug) sources.push(page);
  const context = useMemo(() => ({ register, playing }), [register, playing]);

  return (
    <ArticlePageContext.Provider value={context}>
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
