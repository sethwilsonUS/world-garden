"use client";

import { createContext, useContext } from "react";
import type {
  WikipediaArticle,
  WikipediaArticleImage,
  WikipediaCitation,
  WikipediaLinkedArticle,
  WikipediaRevisionIdentity,
  WikipediaSearchResult,
  WikipediaSection,
  WikipediaSectionCount,
} from "@/lib/wikipedia-contracts";

export type SearchResult = WikipediaSearchResult;
export type Section = WikipediaSection;
export type Article = WikipediaArticle;
export type LinkedArticle = WikipediaLinkedArticle;
export type Citation = WikipediaCitation;
export type LinkCount = WikipediaSectionCount;
export type ArticleImage = WikipediaArticleImage;
export type { WikipediaRevisionIdentity } from "@/lib/wikipedia-contracts";

export type DataContextValue = {
  search: (args: { term: string }) => Promise<SearchResult[]>;
  fetchArticle: (args: { slug: string }) => Promise<Article>;
  getSectionLinkCounts: (args: {
    identity: WikipediaRevisionIdentity;
    signal?: AbortSignal;
  }) => Promise<LinkCount[]>;
  getCitationCounts: (args: {
    identity: WikipediaRevisionIdentity;
    signal?: AbortSignal;
  }) => Promise<LinkCount[]>;
  getSectionLinks: (args: {
    identity: WikipediaRevisionIdentity;
    sectionTitle: string | null;
    sectionIndex?: string;
    signal?: AbortSignal;
  }) => Promise<LinkedArticle[]>;
  getSectionCitations: (args: {
    identity: WikipediaRevisionIdentity;
    sectionTitle: string | null;
    sectionIndex?: string;
    signal?: AbortSignal;
  }) => Promise<Citation[]>;
  getArticleImages: (args: {
    identity: WikipediaRevisionIdentity;
    signal?: AbortSignal;
  }) => Promise<ArticleImage[]>;
};

export const DataContext = createContext<DataContextValue | null>(null);

export const useData = (): DataContextValue => {
  const ctx = useContext(DataContext);
  if (!ctx) {
    throw new Error("useData() must be used within a DataProvider");
  }
  return ctx;
};
