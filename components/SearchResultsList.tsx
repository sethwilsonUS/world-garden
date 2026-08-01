"use client";

import { useEffect, useState } from "react";
import { analytics } from "@/lib/analytics";
import { useData } from "@/lib/data-context";
import { ArticleLink } from "@/components/ArticleLink";
import { PlaylistActionButton } from "@/components/PlaylistActionButton";

type SearchResult = {
  wikiPageId: string;
  title: string;
  description: string;
  url: string;
};

const SearchResultsForTerm = ({ term }: { term: string }) => {
  const { search: searchAction } = useData();
  const [results, setResults] = useState<SearchResult[]>([]);
  const [loading, setLoading] = useState(Boolean(term.trim()));
  const [error, setError] = useState<string | null>(null);
  const [statusMessage, setStatusMessage] = useState("");

  useEffect(() => {
    if (!term.trim()) return;

    let cancelled = false;
    // Mount the empty polite region before adding text so AT announces it.
    queueMicrotask(() => {
      if (!cancelled) {
        setStatusMessage(`Searching Wikipedia for ${term}.`);
      }
    });

    searchAction({ term })
      .then((data) => {
        if (!cancelled) {
          const nextResults = data as SearchResult[];
          setResults(nextResults);
          setStatusMessage(
            nextResults.length === 0
              ? `No search results found for ${term}.`
              : `${nextResults.length} search result${nextResults.length === 1 ? "" : "s"} found for ${term}.`,
          );
        }
      })
      .catch((err: unknown) => {
        if (!cancelled) {
          setError(
            err instanceof Error && err.message ? err.message : "Search failed",
          );
          setStatusMessage("");
        }
      })
      .finally(() => {
        if (!cancelled) {
          setLoading(false);
          analytics.searchResultsLoaded();
        }
      });

    return () => {
      cancelled = true;
    };
  }, [term, searchAction]);

  return (
    <div>
      <p
        className="sr-only"
        role="status"
        aria-live="polite"
        aria-atomic="true"
      >
        {statusMessage}
      </p>

      {loading ? (
        <div aria-hidden="true">
          <ul className="list-none p-0 m-0">
            {Array.from({ length: 4 }).map((_, i) => (
              <li
                key={i}
                className="garden-bed px-5 py-4"
                style={{ marginTop: i > 0 ? "8px" : 0 }}
              >
                <div className="skeleton h-[22px] w-[55%] mb-2" />
                <div className="skeleton h-[14px] w-[85%]" />
              </li>
            ))}
          </ul>
        </div>
      ) : error ? (
        <div className="alert-banner alert-error" role="alert">
          <svg
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth={2}
            strokeLinecap="round"
            strokeLinejoin="round"
            width={20}
            height={20}
            aria-hidden="true"
            className="shrink-0"
          >
            <path d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z" />
          </svg>
          <div>
            <p className="font-semibold">Search failed</p>
            <p className="text-sm mt-1">{error}</p>
          </div>
        </div>
      ) : results.length === 0 ? (
        <div className="garden-bed text-center py-12 px-6">
          <svg
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth={1.5}
            strokeLinecap="round"
            strokeLinejoin="round"
            width={48}
            height={48}
            aria-hidden="true"
            className="mx-auto mb-4 text-muted"
          >
            <path d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z" />
          </svg>
          <p className="font-display font-semibold text-lg">No seeds found</p>
          <p className="text-muted text-sm mt-2">
            Try searching for a different topic.
          </p>
        </div>
      ) : (
        <ol
          className="list-none p-0 m-0"
          aria-label={`${results.length} results for "${term}"`}
        >
          {results.map((result, index) => (
            <li
              key={result.wikiPageId}
              className="animate-fade-in-up"
              style={{
                animationDelay: `${index * 0.04}s`,
                marginTop: index > 0 ? "6px" : 0,
              }}
            >
              <div className="flex min-w-0 flex-wrap items-start gap-[12px] rounded-[14px] border border-border bg-surface-2 px-[12px] py-[14px] transition-all duration-150 sm:pl-[18px]">
                <ArticleLink
                  articleTitle={result.title}
                  className="result-link flex min-h-[44px] min-w-0 max-w-full flex-[1_1_240px] items-center gap-[16px] no-underline"
                  aria-label={`${index + 1}. ${result.title}: ${result.description}`}
                  onClick={() => analytics.searchResultClicked()}
                >
                  <span
                    className="flex h-7 w-7 shrink-0 items-center justify-center rounded-lg bg-accent-bg font-mono text-xs font-bold text-accent"
                    aria-hidden="true"
                  >
                    {index + 1}
                  </span>

                  <div className="min-w-0 flex-1">
                    <span className="block [overflow-wrap:anywhere] font-display text-base font-semibold text-foreground">
                      {result.title}
                    </span>
                    {result.description && (
                      <span className="mt-0.5 block [overflow-wrap:anywhere] text-[0.8125rem] leading-normal text-muted">
                        {result.description}
                      </span>
                    )}
                  </div>

                  <svg
                    viewBox="0 0 24 24"
                    fill="none"
                    stroke="currentColor"
                    strokeWidth={2}
                    strokeLinecap="round"
                    strokeLinejoin="round"
                    width={18}
                    height={18}
                    aria-hidden="true"
                    className="shrink-0 text-accent opacity-60"
                  >
                    <path d="M9 5l7 7-7 7" />
                  </svg>
                </ArticleLink>
                <PlaylistActionButton
                  slug={result.title.replace(/ /g, "_")}
                  title={result.title}
                />
              </div>
            </li>
          ))}
        </ol>
      )}
    </div>
  );
};

export const SearchResultsList = ({ term }: { term: string }) => (
  <SearchResultsForTerm key={term} term={term} />
);
