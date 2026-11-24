import type {
  WikipediaCitation,
  WikipediaParsedPageData,
  WikipediaRevisionIdentity,
  WikipediaSectionCount,
} from "@/lib/wikipedia-contracts";
import {
  findWikipediaSectionMetadata,
  wikipediaRevisionKey,
} from "@/lib/wikipedia-utils";

export const DEFAULT_MAX_METADATA_CACHE_ENTRIES = 32;

const abortReason = (signal: AbortSignal): unknown =>
  signal.reason ?? new DOMException("The operation was aborted.", "AbortError");

const waitForCaller = <Value>(
  pending: Promise<Value>,
  signal?: AbortSignal,
): Promise<Value> => {
  if (!signal) return pending;
  if (signal.aborted) return Promise.reject(abortReason(signal));

  return new Promise<Value>((resolve, reject) => {
    const handleAbort = () => reject(abortReason(signal));
    signal.addEventListener("abort", handleAbort, { once: true });
    pending.then(resolve, reject).finally(() => {
      signal.removeEventListener("abort", handleAbort);
    });
  });
};

export type RevisionMetadataClient = {
  requestMetadata: (
    identity: WikipediaRevisionIdentity,
    signal?: AbortSignal,
  ) => Promise<WikipediaParsedPageData>;
  reset: () => void;
};

/**
 * Coalesce concurrent metadata reads for the same canonical revision identity
 * and cache completed results in an insertion-ordered bounded Map.
 *
 * Caller cancellation stops only that caller from observing the result so one
 * unmounting hook never poisons a shared in-flight request for sibling hooks.
 */
export const createRevisionMetadataClient = (
  loadMetadata: (
    identity: WikipediaRevisionIdentity,
  ) => Promise<WikipediaParsedPageData>,
  options: { maxEntries?: number } = {},
): RevisionMetadataClient => {
  const maxEntries =
    options.maxEntries !== undefined &&
    Number.isInteger(options.maxEntries) &&
    options.maxEntries > 0
      ? options.maxEntries
      : DEFAULT_MAX_METADATA_CACHE_ENTRIES;
  const cache = new Map<string, WikipediaParsedPageData>();
  const inFlight = new Map<string, Promise<WikipediaParsedPageData>>();
  let generation = 0;

  const remember = (key: string, data: WikipediaParsedPageData): void => {
    cache.set(key, data);
    if (cache.size <= maxEntries) return;
    const oldestKey = cache.keys().next().value as string | undefined;
    if (oldestKey && oldestKey !== key) cache.delete(oldestKey);
  };

  return {
    requestMetadata: (identity, signal) => {
      if (signal?.aborted) return Promise.reject(abortReason(signal));

      const key = wikipediaRevisionKey(identity);
      const cached = cache.get(key);
      if (cached) return waitForCaller(Promise.resolve(cached), signal);

      let pending = inFlight.get(key);
      if (!pending) {
        const requestGeneration = generation;
        pending = loadMetadata({
          wikiPageId: identity.wikiPageId,
          revisionId: identity.revisionId,
          title: identity.title,
          language: identity.language,
        })
          .then((data) => {
            if (requestGeneration === generation) {
              remember(key, data);
            }
            return data;
          })
          .finally(() => {
            if (inFlight.get(key) === pending) inFlight.delete(key);
          });
        inFlight.set(key, pending);
      }

      return waitForCaller(pending, signal);
    },

    reset: () => {
      generation += 1;
      cache.clear();
      inFlight.clear();
    },
  };
};

export const projectCitationCounts = (
  data: WikipediaParsedPageData,
): WikipediaSectionCount[] =>
  data.sectionCitations.map(({ index, title, count }) => ({
    ...(index !== undefined ? { index } : {}),
    title,
    count,
  }));

export const projectSectionCitations = (
  data: WikipediaParsedPageData,
  section: { sectionTitle: string | null; sectionIndex?: string },
): WikipediaCitation[] => {
  const sectionInfo = findWikipediaSectionMetadata(
    data.sectionCitations,
    section,
  );
  if (!sectionInfo) return [];
  const idSet = new Set(sectionInfo.citationIds);
  return data.citations.filter((citation) => idSet.has(citation.id));
};

export const createCoalescedMetadataMethods = (
  metadataClient: Pick<RevisionMetadataClient, "requestMetadata">,
) => ({
  getSectionLinkCounts: async ({
    identity,
    signal,
  }: {
    identity: WikipediaRevisionIdentity;
    signal?: AbortSignal;
  }) => {
    const data = await metadataClient.requestMetadata(identity, signal);
    return data.linkCounts;
  },

  getCitationCounts: async ({
    identity,
    signal,
  }: {
    identity: WikipediaRevisionIdentity;
    signal?: AbortSignal;
  }) => {
    const data = await metadataClient.requestMetadata(identity, signal);
    return projectCitationCounts(data);
  },

  getSectionCitations: async ({
    identity,
    sectionTitle,
    sectionIndex,
    signal,
  }: {
    identity: WikipediaRevisionIdentity;
    sectionTitle: string | null;
    sectionIndex?: string;
    signal?: AbortSignal;
  }) => {
    const data = await metadataClient.requestMetadata(identity, signal);
    return projectSectionCitations(data, { sectionTitle, sectionIndex });
  },

  getArticleImages: async ({
    identity,
    signal,
  }: {
    identity: WikipediaRevisionIdentity;
    signal?: AbortSignal;
  }) => {
    const data = await metadataClient.requestMetadata(identity, signal);
    return data.images;
  },
});
