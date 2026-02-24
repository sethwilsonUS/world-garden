"use client";

import { ReactNode, useMemo } from "react";
import {
  DataContext,
  type DataContextValue,
  type Article,
} from "./data-context";
import {
  searchWikipedia,
  fetchArticleByTitle,
  slugToTitle,
  fetchParsedPageData,
  fetchSectionLinksByIndex,
  type ParsedPageData,
} from "@/convex/lib/wikipedia";

const parsedCache = new Map<string, ParsedPageData>();

const getOrFetchParsed = async (wikiPageId: string): Promise<ParsedPageData> => {
  const cached = parsedCache.get(wikiPageId);
  if (cached) return cached;
  const data = await fetchParsedPageData(wikiPageId);
  parsedCache.set(wikiPageId, data);
  return data;
};

export const LocalDataProvider = ({ children }: { children: ReactNode }) => {
  const value = useMemo<DataContextValue>(
    () => ({
      search: async ({ term }) => {
        if (!term.trim()) return [];
        return searchWikipedia(term.trim());
      },

      fetchArticle: async ({ slug }) => {
        const title = slugToTitle(slug);
        const data = await fetchArticleByTitle(title);
        const article: Article = {
          wikiPageId: data.wikiPageId,
          title: data.title,
          language: data.language,
          revisionId: data.revisionId,
          lastEdited: data.lastEdited,
          summary: data.summary,
          sections: data.sections,
        };
        return article;
      },

      getSectionLinkCounts: async ({ wikiPageId }) => {
        const data = await getOrFetchParsed(wikiPageId);
        return data.linkCounts;
      },

      getCitationCounts: async ({ wikiPageId }) => {
        const data = await getOrFetchParsed(wikiPageId);
        return data.sectionCitations.map(({ title, count }) => ({
          title,
          count,
        }));
      },

      getSectionLinks: async ({ wikiPageId, sectionTitle }) => {
        let sectionIndex = "0";

        if (sectionTitle !== null) {
          const parseData = await getOrFetchParsed(wikiPageId);
          const normalise = (s: string) =>
            s.replace(/<[^>]+>/g, "").trim().toLowerCase();
          const target = normalise(sectionTitle);
          const match = parseData.sectionIndexMap.find(
            (s) => normalise(s.title) === target,
          );
          if (!match) return [];
          sectionIndex = match.index;
        }

        return fetchSectionLinksByIndex(wikiPageId, sectionIndex);
      },

      getSectionCitations: async ({ wikiPageId, sectionTitle }) => {
        const data = await getOrFetchParsed(wikiPageId);
        const key = sectionTitle ?? "__summary__";
        const normalise = (s: string) =>
          s.replace(/<[^>]+>/g, "").trim().toLowerCase();
        const target = normalise(key);

        const sectionInfo = data.sectionCitations.find(
          (s) => normalise(s.title) === target,
        );
        if (!sectionInfo) return [];

        const idSet = new Set(sectionInfo.citationIds);
        return data.citations.filter((c) => idSet.has(c.id));
      },

      getArticleImages: async ({ wikiPageId }) => {
        const data = await getOrFetchParsed(wikiPageId);
        return data.images;
      },
    }),
    [],
  );

  return <DataContext.Provider value={value}>{children}</DataContext.Provider>;
};
