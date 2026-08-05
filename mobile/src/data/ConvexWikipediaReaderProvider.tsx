import type {
  WikipediaArticle,
  WikipediaSearchResult,
} from "@curio-garden/domain";
import { useAction } from "convex/react";
import { useMemo, type ReactElement, type ReactNode } from "react";

import { convexClientApi } from "./convexClientApi";
import {
  WikipediaReaderProvider,
  type WikipediaReader,
} from "./WikipediaReaderContext";

type PublicReaderActions = {
  searchAction(args: { term: string }): Promise<WikipediaSearchResult[]>;
  fetchArticleAction(args: { slug: string }): Promise<WikipediaArticle>;
};

export function createWikipediaReader({
  fetchArticleAction,
  searchAction,
}: PublicReaderActions): WikipediaReader {
  return {
    search: (args) => searchAction(args),
    fetchArticle: (args) => fetchArticleAction(args),
  };
}

export function ConvexWikipediaReaderProvider({
  children,
}: {
  children: ReactNode;
}): ReactElement {
  const searchAction = useAction(convexClientApi.wikipedia.search);
  const fetchArticleAction = useAction(convexClientApi.wikipedia.fetchArticle);
  const reader = useMemo(
    () => createWikipediaReader({ fetchArticleAction, searchAction }),
    [fetchArticleAction, searchAction],
  );

  return (
    <WikipediaReaderProvider reader={reader}>
      {children}
    </WikipediaReaderProvider>
  );
}
