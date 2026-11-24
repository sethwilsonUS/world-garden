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
import { AuthAwareTtsProfileProvider } from "@/lib/tts-audience";
import {
  DataContext,
  type DataContextValue,
} from "./data-context";
import {
  createCoalescedMetadataMethods,
  createRevisionMetadataClient,
} from "./wikipedia-metadata-client";

const convex = new ConvexReactClient(process.env.NEXT_PUBLIC_CONVEX_URL!);

const abortError = (): DOMException =>
  new DOMException("The request was aborted.", "AbortError");

/**
 * Convex React actions do not expose transport-level AbortSignal support.
 * This adapter still makes the DataContext request contract cancellable: an
 * aborted consumer stops awaiting the action immediately and ignores its
 * eventual completion without changing the public Convex action arguments.
 */
const runAbortableAction = <Result,>(
  start: () => Promise<Result>,
  signal?: AbortSignal,
): Promise<Result> => {
  if (!signal) return start();
  if (signal.aborted) return Promise.reject(abortError());

  return new Promise<Result>((resolve, reject) => {
    const handleAbort = () => reject(abortError());
    signal.addEventListener("abort", handleAbort, { once: true });
    void start().then(
      (result) => {
        signal.removeEventListener("abort", handleAbort);
        if (!signal.aborted) resolve(result);
      },
      (error: unknown) => {
        signal.removeEventListener("abort", handleAbort);
        if (!signal.aborted) reject(error);
      },
    );
  });
};

const ConvexDataProviderInner = ({ children }: { children: ReactNode }) => {
  const searchAction = useAction(api.search.search);
  const fetchAndCacheBySlug = useAction(api.articles.fetchAndCacheBySlug);
  const articleMetadataAction = useAction(api.articles.getArticleMetadata);
  const sectionLinksAction = useAction(api.articles.getSectionLinks);

  const metadataClient = useMemo(
    () =>
      createRevisionMetadataClient((identity) =>
        articleMetadataAction({
          wikiPageId: identity.wikiPageId,
          revisionId: identity.revisionId,
          title: identity.title,
          language: identity.language,
        }),
      ),
    [articleMetadataAction],
  );

  const value = useMemo<DataContextValue>(
    () => ({
      search: searchAction,

      fetchArticle: async ({ slug }) => {
        const result = await fetchAndCacheBySlug({ slug });
        return result;
      },

      ...createCoalescedMetadataMethods(metadataClient),

      getSectionLinks: ({ identity, sectionTitle, sectionIndex, signal }) =>
        runAbortableAction(
          () =>
            sectionLinksAction({
              wikiPageId: identity.wikiPageId,
              revisionId: identity.revisionId,
              title: identity.title,
              language: identity.language,
              sectionTitle,
              sectionIndex,
            }),
          signal,
        ),
    }),
    [searchAction, fetchAndCacheBySlug, metadataClient, sectionLinksAction],
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
      <AuthAwareTtsProfileProvider>
        <ConvexDataProviderInner>{children}</ConvexDataProviderInner>
      </AuthAwareTtsProfileProvider>
    </ConvexProviderWithClerk>
  );
};
