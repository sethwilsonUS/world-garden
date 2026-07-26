"use client";

import { ReactNode, useMemo } from "react";
import { DataContext, type DataContextValue } from "./data-context";
import {
  requestLocalWikipedia,
  requestLocalWikipediaMetadata,
} from "@/lib/local-wikipedia-client";
import { findWikipediaSectionMetadata } from "@/lib/wikipedia-utils";

export const LocalDataProvider = ({ children }: { children: ReactNode }) => {
  const value = useMemo<DataContextValue>(
    () => ({
      search: async ({ term }) => {
        if (!term.trim()) return [];
        return requestLocalWikipedia({
          operation: "search",
          term: term.trim(),
        });
      },

      fetchArticle: ({ slug }) =>
        requestLocalWikipedia({ operation: "article", slug }),

      getSectionLinkCounts: async ({ identity, signal }) => {
        const data = await requestLocalWikipediaMetadata(identity, signal);
        return data.linkCounts;
      },

      getCitationCounts: async ({ identity, signal }) => {
        const data = await requestLocalWikipediaMetadata(identity, signal);
        return data.sectionCitations.map(({ index, title, count }) => ({
          ...(index !== undefined ? { index } : {}),
          title,
          count,
        }));
      },

      getSectionLinks: ({ identity, sectionTitle, sectionIndex, signal }) =>
        requestLocalWikipedia(
          {
            operation: "section-links",
            identity,
            sectionTitle,
            sectionIndex,
          },
          signal,
        ),

      getSectionCitations: async ({
        identity,
        sectionTitle,
        sectionIndex,
        signal,
      }) => {
        const data = await requestLocalWikipediaMetadata(identity, signal);
        const sectionInfo = findWikipediaSectionMetadata(
          data.sectionCitations,
          { sectionTitle, sectionIndex },
        );
        if (!sectionInfo) return [];

        const idSet = new Set(sectionInfo.citationIds);
        return data.citations.filter((c) => idSet.has(c.id));
      },

      getArticleImages: async ({ identity, signal }) => {
        const data = await requestLocalWikipediaMetadata(identity, signal);
        return data.images;
      },
    }),
    [],
  );

  return <DataContext.Provider value={value}>{children}</DataContext.Provider>;
};
