import type {
  WikipediaArticle,
  WikipediaSearchResult,
} from "@curio-garden/domain";
import {
  createContext,
  useContext,
  type ReactElement,
  type ReactNode,
} from "react";

export interface WikipediaReader {
  search(args: { term: string }): Promise<WikipediaSearchResult[]>;
  fetchArticle(args: { slug: string }): Promise<WikipediaArticle>;
}

const WikipediaReaderContext = createContext<WikipediaReader | null>(null);

export function WikipediaReaderProvider({
  children,
  reader,
}: {
  children: ReactNode;
  reader: WikipediaReader;
}): ReactElement {
  return (
    <WikipediaReaderContext.Provider value={reader}>
      {children}
    </WikipediaReaderContext.Provider>
  );
}

export function useWikipediaReader(): WikipediaReader {
  const reader = useContext(WikipediaReaderContext);
  if (!reader) {
    throw new Error(
      "useWikipediaReader() must be used within WikipediaReaderProvider",
    );
  }
  return reader;
}
