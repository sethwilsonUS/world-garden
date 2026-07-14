"use client";

import { useEffect, useState } from "react";
import {
  useData,
  type Citation,
  type LinkedArticle,
  type LinkCount,
} from "@/lib/data-context";

type SectionCountMap = Record<string, number>;

type SectionCountsState = {
  key: string;
  linkCounts: SectionCountMap | null;
  citationCounts: SectionCountMap | null;
};

type SectionDetailsArgs = {
  wikiPageId: string;
  sectionTitle: string | null;
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
  for (const { title, count } of counts) result[title] = count;
  return result;
};

const emptyCounts = (key: string): SectionCountsState => ({
  key,
  linkCounts: null,
  citationCounts: null,
});

const detailsKey = ({
  wikiPageId,
  sectionTitle,
  hasLinks,
  hasCitations,
}: SectionDetailsArgs): string =>
  JSON.stringify([wikiPageId, sectionTitle, hasLinks, hasCitations]);

const emptyDetails = (
  key: string,
  hasLinks: boolean,
  hasCitations: boolean,
): SectionDetailsState => ({
  key,
  links: hasLinks ? null : [],
  citations: hasCitations ? null : [],
});

export const useArticleSectionCounts = (wikiPageId: string) => {
  const { getSectionLinkCounts, getCitationCounts } = useData();
  const [state, setState] = useState<SectionCountsState>(() =>
    emptyCounts(wikiPageId),
  );

  useEffect(() => {
    const controller = new AbortController();
    const key = wikiPageId;

    void getSectionLinkCounts({ wikiPageId })
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

    void getCitationCounts({ wikiPageId })
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
  }, [getCitationCounts, getSectionLinkCounts, wikiPageId]);

  return state.key === wikiPageId ? state : emptyCounts(wikiPageId);
};

export const useArticleSectionDetails = (args: SectionDetailsArgs) => {
  const { getSectionLinks, getSectionCitations } = useData();
  const key = detailsKey(args);
  const { wikiPageId, sectionTitle, hasLinks, hasCitations } = args;
  const [state, setState] = useState<SectionDetailsState>(() =>
    emptyDetails(key, hasLinks, hasCitations),
  );

  useEffect(() => {
    const controller = new AbortController();

    if (hasLinks) {
      void getSectionLinks({ wikiPageId, sectionTitle })
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
      void getSectionCitations({ wikiPageId, sectionTitle })
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
