"use client";

import { useEffect, useState } from "react";
import {
  useData,
  type Citation,
  type LinkedArticle,
  type LinkCount,
  type WikipediaRevisionIdentity,
} from "@/lib/data-context";
import { wikipediaRevisionKey } from "@/lib/wikipedia-utils";

type SectionCountMap = Record<string, number>;

type SectionCountsState = {
  key: string;
  linkCounts: SectionCountMap | null;
  citationCounts: SectionCountMap | null;
};

type SectionDetailsArgs = {
  identity: WikipediaRevisionIdentity;
  sectionTitle: string | null;
  sectionIndex?: string;
  hasLinks: boolean;
  hasCitations: boolean;
};

type SectionDetailsState = {
  key: string;
  links: LinkedArticle[] | null;
  citations: Citation[] | null;
};

const toCountMap = (counts: LinkCount[]): SectionCountMap => {
  const result: SectionCountMap = {};
  for (const { index, title, count } of counts) {
    result[index ?? title] = count;
  }
  return result;
};

const emptyCounts = (key: string): SectionCountsState => ({
  key,
  linkCounts: null,
  citationCounts: null,
});

const detailsKey = ({
  identity,
  sectionTitle,
  sectionIndex,
  hasLinks,
  hasCitations,
}: SectionDetailsArgs): string =>
  JSON.stringify([
    wikipediaRevisionKey(identity),
    sectionTitle,
    sectionIndex,
    hasLinks,
    hasCitations,
  ]);

const emptyDetails = (
  key: string,
  hasLinks: boolean,
  hasCitations: boolean,
): SectionDetailsState => ({
  key,
  links: hasLinks ? null : [],
  citations: hasCitations ? null : [],
});

export const useArticleSectionCounts = (
  identity: WikipediaRevisionIdentity,
) => {
  const { getSectionLinkCounts, getCitationCounts } = useData();
  const { wikiPageId, revisionId, title, language } = identity;
  const identityKey = wikipediaRevisionKey(identity);
  const [state, setState] = useState<SectionCountsState>(() =>
    emptyCounts(identityKey),
  );

  useEffect(() => {
    const controller = new AbortController();
    const key = identityKey;
    const requestIdentity = { wikiPageId, revisionId, title, language };

    void getSectionLinkCounts({
      identity: requestIdentity,
      signal: controller.signal,
    })
      .then((counts) => {
        if (controller.signal.aborted) return;
        setState((current) => ({
          ...(current.key === key ? current : emptyCounts(key)),
          linkCounts: toCountMap(counts),
        }));
      })
      .catch(() => {
        if (controller.signal.aborted) return;
        setState((current) => ({
          ...(current.key === key ? current : emptyCounts(key)),
          linkCounts: {},
        }));
      });

    void getCitationCounts({
      identity: requestIdentity,
      signal: controller.signal,
    })
      .then((counts) => {
        if (controller.signal.aborted) return;
        setState((current) => ({
          ...(current.key === key ? current : emptyCounts(key)),
          citationCounts: toCountMap(counts),
        }));
      })
      .catch(() => {
        if (controller.signal.aborted) return;
        setState((current) => ({
          ...(current.key === key ? current : emptyCounts(key)),
          citationCounts: {},
        }));
      });

    return () => controller.abort();
  }, [
    getCitationCounts,
    getSectionLinkCounts,
    identityKey,
    language,
    revisionId,
    title,
    wikiPageId,
  ]);

  return state.key === identityKey ? state : emptyCounts(identityKey);
};

export const useArticleSectionDetails = (args: SectionDetailsArgs) => {
  const { getSectionLinks, getSectionCitations } = useData();
  const key = detailsKey(args);
  const { identity, sectionTitle, sectionIndex, hasLinks, hasCitations } = args;
  const { wikiPageId, revisionId, title, language } = identity;
  const [state, setState] = useState<SectionDetailsState>(() =>
    emptyDetails(key, hasLinks, hasCitations),
  );

  useEffect(() => {
    const controller = new AbortController();
    const requestIdentity = { wikiPageId, revisionId, title, language };

    if (hasLinks) {
      void getSectionLinks({
        identity: requestIdentity,
        sectionTitle,
        sectionIndex,
        signal: controller.signal,
      })
        .then((links) => {
          if (controller.signal.aborted) return;
          setState((current) => ({
            ...(current.key === key
              ? current
              : emptyDetails(key, hasLinks, hasCitations)),
            links,
          }));
        })
        .catch(() => {
          if (controller.signal.aborted) return;
          setState((current) => ({
            ...(current.key === key
              ? current
              : emptyDetails(key, hasLinks, hasCitations)),
            links: [],
          }));
        });
    }

    if (hasCitations) {
      void getSectionCitations({
        identity: requestIdentity,
        sectionTitle,
        sectionIndex,
        signal: controller.signal,
      })
        .then((citations) => {
          if (controller.signal.aborted) return;
          setState((current) => ({
            ...(current.key === key
              ? current
              : emptyDetails(key, hasLinks, hasCitations)),
            citations,
          }));
        })
        .catch(() => {
          if (controller.signal.aborted) return;
          setState((current) => ({
            ...(current.key === key
              ? current
              : emptyDetails(key, hasLinks, hasCitations)),
            citations: [],
          }));
        });
    }

    return () => controller.abort();
  }, [
    getSectionCitations,
    getSectionLinks,
    hasCitations,
    hasLinks,
    key,
    sectionTitle,
    sectionIndex,
    language,
    revisionId,
    title,
    wikiPageId,
  ]);

  const effective =
    state.key === key ? state : emptyDetails(key, hasLinks, hasCitations);
  return {
    links: effective.links,
    citations: effective.citations,
    linksLoading: effective.links === null,
    citationsLoading: effective.citations === null,
  };
};
