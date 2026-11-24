"use client";

import { createContext, useContext } from "react";
import type {
  WikipediaArticle,
  WikipediaArticleImage,
  WikipediaCitation,
  WikipediaLinkedArticle,
  WikipediaRelatedArticle,
  WikipediaRevisionIdentity,
  WikipediaSearchResponse,
  WikipediaSearchResult,
  WikipediaSearchSuggestion,
  WikipediaSection,
  WikipediaSectionCount,
} from "@/lib/wikipedia-contracts";

export type SearchResult = WikipediaSearchResult;
export type SearchResponse = WikipediaSearchResponse;
export type SearchSuggestion = WikipediaSearchSuggestion;
export type Section = WikipediaSection;
export type Article = WikipediaArticle;
export type LinkedArticle = WikipediaLinkedArticle;
export type RelatedArticle = WikipediaRelatedArticle;
export type Citation = WikipediaCitation;
export type LinkCount = WikipediaSectionCount;
export type ArticleImage = WikipediaArticleImage;
export type { WikipediaRevisionIdentity } from "@/lib/wikipedia-contracts";

export type DataContextValue = {
  search: (args: {
    term: string;
  }) => Promise<SearchResult[] | SearchResponse>;
  suggestTitles: (args: {
    term: string;
    signal?: AbortSignal;
  }) => Promise<SearchSuggestion[]>;
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
  getRelatedArticles: (args: {
    identity: WikipediaRevisionIdentity;
    signal?: AbortSignal;
  }) => Promise<RelatedArticle[]>;
};

export const DataContext = createContext<DataContextValue | null>(null);

export const useData = (): DataContextValue => {
  const ctx = useContext(DataContext);
  if (!ctx) {
    throw new Error("useData() must be used within a DataProvider");
  }
  return ctx;
};
