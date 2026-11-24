"use client";

import { ReactNode, useMemo } from "react";
import { DataContext, type DataContextValue } from "./data-context";
import {
  requestLocalWikipedia,
  requestLocalWikipediaMetadata,
} from "@/lib/local-wikipedia-client";
import { createCoalescedMetadataMethods } from "@/lib/wikipedia-metadata-client";

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
    }),
    [],
  );

  return <DataContext.Provider value={value}>{children}</DataContext.Provider>;
};
