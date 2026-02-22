"use client";

import { ReactNode, useMemo } from "react";
import { ConvexProvider, ConvexReactClient, useAction } from "convex/react";
import { api } from "@/convex/_generated/api";
import {
  DataContext,
  type DataContextValue,
  type Article,
} from "./data-context";
import { slugToTitle, titleToSlug } from "@/convex/lib/wikipedia";

const convex = new ConvexReactClient(process.env.NEXT_PUBLIC_CONVEX_URL!);

const ConvexDataProviderInner = ({ children }: { children: ReactNode }) => {
  const searchAction = useAction(api.search.search);
  const fetchAndCacheBySlug = useAction(api.articles.fetchAndCacheBySlug);
  const linkCountsAction = useAction(api.articles.getSectionLinkCounts);
  const citationCountsAction = useAction(api.articles.getCitationCounts);
  const sectionLinksAction = useAction(api.articles.getSectionLinks);
  const sectionCitationsAction = useAction(api.articles.getSectionCitations);

  const value = useMemo<DataContextValue>(
    () => ({
      search: searchAction,

      fetchArticle: async ({ slug }) => {
        const result = await fetchAndCacheBySlug({ slug });
        return result as unknown as Article;
      },

      getSectionLinkCounts: linkCountsAction,
      getCitationCounts: citationCountsAction,
      getSectionLinks: sectionLinksAction,
      getSectionCitations: sectionCitationsAction,
    }),
    [
      searchAction,
      fetchAndCacheBySlug,
      linkCountsAction,
      citationCountsAction,
      sectionLinksAction,
      sectionCitationsAction,
    ],
  );

  return <DataContext.Provider value={value}>{children}</DataContext.Provider>;
};

export const ConvexDataProvider = ({ children }: { children: ReactNode }) => {
  return (
    <ConvexProvider client={convex}>
      <ConvexDataProviderInner>{children}</ConvexDataProviderInner>
    </ConvexProvider>
  );
};
