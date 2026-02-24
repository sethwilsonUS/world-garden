"use client";

import { createContext, useContext } from "react";

export type SearchResult = {
  wikiPageId: string;
  title: string;
  description: string;
  url: string;
};

export type Section = {
  title: string;
  level: number;
  content: string;
};

export type Article = {
  wikiPageId: string;
  title: string;
  language: string;
  revisionId: string;
  lastEdited?: string;
  summary?: string;
  thumbnailUrl?: string;
  thumbnailWidth?: number;
  thumbnailHeight?: number;
  sections?: Section[];
};

export type LinkedArticle = {
  wikiPageId: string;
  title: string;
  description?: string;
};

export type Citation = {
  id: string;
  index: number;
  text: string;
  url?: string;
};

export type LinkCount = { title: string; count: number };

export type ArticleImage = {
  src: string;
  originalSrc?: string;
  alt: string;
  caption: string;
  width?: number;
  height?: number;
  videoSrc?: string;
};

export type DataContextValue = {
  search: (args: { term: string }) => Promise<SearchResult[]>;
  fetchArticle: (args: { slug: string }) => Promise<Article>;
  getSectionLinkCounts: (args: {
    wikiPageId: string;
  }) => Promise<LinkCount[]>;
  getCitationCounts: (args: {
    wikiPageId: string;
  }) => Promise<LinkCount[]>;
  getSectionLinks: (args: {
    wikiPageId: string;
    sectionTitle: string | null;
  }) => Promise<LinkedArticle[]>;
  getSectionCitations: (args: {
    wikiPageId: string;
    sectionTitle: string | null;
  }) => Promise<Citation[]>;
  getArticleImages: (args: {
    wikiPageId: string;
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
