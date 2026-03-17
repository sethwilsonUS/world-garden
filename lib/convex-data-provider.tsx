"use client";

import { ReactNode, useMemo } from "react";
import { useAuth } from "@clerk/nextjs";
import { ConvexReactClient, useAction } from "convex/react";
import { ConvexProviderWithClerk } from "convex/react-clerk";
import { api } from "@/convex/_generated/api";
import { ArticleAudioExportProvider } from "@/components/ArticleAudioExportProvider";
import { BadgeProgressToastProvider } from "@/components/BadgeProgressToastProvider";
import { HybridBookmarkProvider } from "@/hooks/useBookmarks";
import { PersonalPlaylistProvider } from "@/hooks/usePersonalPlaylist";
import {
  DataContext,
  type DataContextValue,
  type Article,
} from "./data-context";

const convex = new ConvexReactClient(process.env.NEXT_PUBLIC_CONVEX_URL!);

const ConvexDataProviderInner = ({ children }: { children: ReactNode }) => {
  const searchAction = useAction(api.search.search);
  const fetchAndCacheBySlug = useAction(api.articles.fetchAndCacheBySlug);
  const linkCountsAction = useAction(api.articles.getSectionLinkCounts);
  const citationCountsAction = useAction(api.articles.getCitationCounts);
  const sectionLinksAction = useAction(api.articles.getSectionLinks);
  const sectionCitationsAction = useAction(api.articles.getSectionCitations);
  const articleImagesAction = useAction(api.articles.getArticleImages);

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
      getArticleImages: articleImagesAction,
    }),
    [
      searchAction,
      fetchAndCacheBySlug,
      linkCountsAction,
      citationCountsAction,
      sectionLinksAction,
      sectionCitationsAction,
      articleImagesAction,
    ],
  );

  return (
    <DataContext.Provider value={value}>
      <HybridBookmarkProvider>
        <PersonalPlaylistProvider>
          <ArticleAudioExportProvider>
            <BadgeProgressToastProvider>{children}</BadgeProgressToastProvider>
          </ArticleAudioExportProvider>
        </PersonalPlaylistProvider>
      </HybridBookmarkProvider>
    </DataContext.Provider>
  );
};

export const ConvexDataProvider = ({ children }: { children: ReactNode }) => {
  return (
    <ConvexProviderWithClerk client={convex} useAuth={useAuth}>
      <ConvexDataProviderInner>{children}</ConvexDataProviderInner>
    </ConvexProviderWithClerk>
  );
};
