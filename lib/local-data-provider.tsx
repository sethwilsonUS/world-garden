"use client";

import { ReactNode, useMemo } from "react";
import { DataContext, type DataContextValue } from "./data-context";
import {
  requestLocalWikipedia,
  requestLocalWikipediaMetadata,
  requestLocalWikipediaRelatedArticles,
} from "@/lib/local-wikipedia-client";
import { createCoalescedMetadataMethods } from "@/lib/wikipedia-metadata-client";

export const LocalDataProvider = ({ children }: { children: ReactNode }) => {
  const value = useMemo<DataContextValue>(
    () => ({
      search: async ({ term }) => {
        const normalized = term.trim();
        if (!normalized) return { results: [] };
        return requestLocalWikipedia({
          operation: "search",
          term: normalized,
        });
      },

      suggestTitles: ({ term, signal }) => {
        const normalized = term.trim();
        if (!normalized) return Promise.resolve([]);
        return requestLocalWikipedia(
          {
            operation: "suggest",
            term: normalized,
          },
          signal,
        );
      },

      fetchArticle: ({ slug }) =>
        requestLocalWikipedia({ operation: "article", slug }),

      ...createCoalescedMetadataMethods({
        requestMetadata: requestLocalWikipediaMetadata,
      }),

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

      getRelatedArticles: ({ identity, signal }) =>
        requestLocalWikipediaRelatedArticles(identity, signal),
    }),
    [],
  );

  return <DataContext.Provider value={value}>{children}</DataContext.Provider>;
};
