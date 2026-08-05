import type {
  WikipediaArticle,
  WikipediaSearchResult,
} from "@curio-garden/domain";
import { ConvexProvider, ConvexReactClient, useAction } from "convex/react";
import { useMemo, useState, type ReactElement, type ReactNode } from "react";

import { publicWikipediaApi } from "./convexPublicApi";
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

function ConvexWikipediaReaderProvider({
  children,
}: {
  children: ReactNode;
}): ReactElement {
  const searchAction = useAction(publicWikipediaApi.search);
  const fetchArticleAction = useAction(publicWikipediaApi.fetchArticle);
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

export function PublicWikipediaDataProvider({
  children,
  convexUrl,
}: {
  children: ReactNode;
  convexUrl: string;
}): ReactElement {
  const [client] = useState(() => new ConvexReactClient(convexUrl));

  return (
    <ConvexProvider client={client}>
      <ConvexWikipediaReaderProvider>{children}</ConvexWikipediaReaderProvider>
    </ConvexProvider>
  );
}
