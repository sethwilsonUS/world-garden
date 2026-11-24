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
import { normalizeMediaWikiNumericId } from "@/lib/wikipedia-utils";
import {
  DataContext,
  type DataContextValue,
  type RelatedArticle,
  type WikipediaRevisionIdentity,
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

const MAX_CLIENT_RELATED_CACHE_ENTRIES = 100;

const relatedCacheKey = (identity: WikipediaRevisionIdentity): string =>
  JSON.stringify([
    identity.language.trim().toLowerCase(),
    normalizeMediaWikiNumericId(identity.wikiPageId) ??
      identity.wikiPageId.trim(),
    identity.title.replaceAll("_", " ").replace(/\s+/g, " ").trim(),
  ]);

const ConvexDataProviderInner = ({ children }: { children: ReactNode }) => {
  const searchWithMetaAction = useAction(api.search.searchWithMeta);
  const suggestTitlesAction = useAction(api.search.suggestTitles);
  const fetchAndCacheBySlug = useAction(api.articles.fetchAndCacheBySlug);
  const articleMetadataAction = useAction(api.articles.getArticleMetadata);
  const sectionLinksAction = useAction(api.articles.getSectionLinks);
  const relatedArticlesAction = useAction(api.articles.getRelatedArticles);

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

  const relatedArticlesCache = useMemo(
    () => new Map<string, Promise<RelatedArticle[]>>(),
    [],
  );

  const value = useMemo<DataContextValue>(
    () => ({
      search: searchWithMetaAction,

      suggestTitles: ({ term, signal }) => {
        const normalized = term.trim();
        if (!normalized) return Promise.resolve([]);
        return runAbortableAction(
          () => suggestTitlesAction({ term: normalized }),
          signal,
        );
      },

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

      getRelatedArticles: ({ identity, signal }) =>
        runAbortableAction(() => {
          const key = relatedCacheKey(identity);
          const cached = relatedArticlesCache.get(key);
          if (cached) return cached;

          const pending = relatedArticlesAction({
            wikiPageId: identity.wikiPageId,
            revisionId: identity.revisionId,
            title: identity.title,
            language: identity.language,
          })
            .then((articles) => {
              // Keep non-empty results in SPA memory; let empty results fall
              // back to Convex's DB cache so transient upstream errors recover.
              if (
                articles.length === 0 &&
                relatedArticlesCache.get(key) === pending
              ) {
                relatedArticlesCache.delete(key);
              }
              return articles;
            })
            .catch((error: unknown) => {
              if (relatedArticlesCache.get(key) === pending) {
                relatedArticlesCache.delete(key);
              }
              throw error;
            });

          relatedArticlesCache.set(key, pending);
          if (relatedArticlesCache.size > MAX_CLIENT_RELATED_CACHE_ENTRIES) {
            const oldestKey = relatedArticlesCache.keys().next().value as
              | string
              | undefined;
            if (oldestKey && oldestKey !== key) {
              relatedArticlesCache.delete(oldestKey);
            }
          }
          return pending;
        }, signal),
    }),
    [
      searchWithMetaAction,
      suggestTitlesAction,
      fetchAndCacheBySlug,
      metadataClient,
      sectionLinksAction,
      relatedArticlesAction,
      relatedArticlesCache,
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
      <AuthAwareTtsProfileProvider>
        <ConvexDataProviderInner>{children}</ConvexDataProviderInner>
      </AuthAwareTtsProfileProvider>
    </ConvexProviderWithClerk>
  );
};
