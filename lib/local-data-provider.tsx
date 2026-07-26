"use client";

import { ReactNode, useMemo } from "react";
import { DataContext, type DataContextValue } from "./data-context";
import { requestLocalWikipedia } from "@/lib/local-wikipedia-client";
import type {
  WikipediaParsedPageData,
  WikipediaRevisionIdentity,
} from "@/lib/wikipedia-contracts";
import {
  findWikipediaSectionMetadata,
  wikipediaRevisionKey,
} from "@/lib/wikipedia-utils";

const parsedCache = new Map<string, WikipediaParsedPageData>();
const MAX_PARSED_CACHE_ENTRIES = 32;

const cacheParsedPage = (key: string, data: WikipediaParsedPageData): void => {
  parsedCache.set(key, data);
  if (parsedCache.size <= MAX_PARSED_CACHE_ENTRIES) return;
  const oldestKey = parsedCache.keys().next().value as string | undefined;
  if (oldestKey && oldestKey !== key) parsedCache.delete(oldestKey);
};

const getOrFetchParsed = async (
  identity: WikipediaRevisionIdentity,
  signal?: AbortSignal,
): Promise<WikipediaParsedPageData> => {
  const key = wikipediaRevisionKey(identity);
  const cached = parsedCache.get(key);
  if (cached) return cached;
  const data = await requestLocalWikipedia(
    { operation: "metadata", identity },
    signal,
  );
  cacheParsedPage(key, data);
  return data;
};

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
        const data = await getOrFetchParsed(identity, signal);
        return data.linkCounts;
      },

      getCitationCounts: async ({ identity, signal }) => {
        const data = await getOrFetchParsed(identity, signal);
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
        const data = await getOrFetchParsed(identity, signal);
        const sectionInfo = findWikipediaSectionMetadata(
          data.sectionCitations,
          { sectionTitle, sectionIndex },
        );
        if (!sectionInfo) return [];

        const idSet = new Set(sectionInfo.citationIds);
        return data.citations.filter((c) => idSet.has(c.id));
      },

      getArticleImages: async ({ identity, signal }) => {
        const data = await getOrFetchParsed(identity, signal);
        return data.images;
      },
    }),
    [],
  );

  return <DataContext.Provider value={value}>{children}</DataContext.Provider>;
};
