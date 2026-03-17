"use client";

import Link from "next/link";
import { useEffect, useState, useRef, useCallback } from "react";
import { analytics } from "@/lib/analytics";
import { useData } from "@/lib/data-context";
import { usePrefetch } from "@/hooks/usePrefetch";
import { PlaylistActionButton } from "@/components/PlaylistActionButton";

type SearchResult = {
  wikiPageId: string;
  title: string;
  description: string;
  url: string;
};

export const SearchResultsList = ({ term }: { term: string }) => {
  const { search: searchAction } = useData();
  const [results, setResults] = useState<SearchResult[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const listRef = useRef<HTMLOListElement>(null);
  const linkRefs = useRef<(HTMLAnchorElement | null)[]>([]);

  const [prevTerm, setPrevTerm] = useState(term);
  if (term !== prevTerm) {
    setPrevTerm(term);
    if (term.trim()) {
      setLoading(true);
      setError(null);
    } else {
      setLoading(false);
    }
  }

  useEffect(() => {
    if (!term.trim()) return;

    let cancelled = false;

    searchAction({ term })
      .then((data) => {
        if (!cancelled) setResults(data as SearchResult[]);
      })
      .catch((err) => {
        if (!cancelled) setError(err.message ?? "Search failed");
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

  useEffect(() => {
    linkRefs.current = linkRefs.current.slice(0, results.length);
  }, [results.length]);

  useEffect(() => {
    if (!loading && results.length > 0 && linkRefs.current[0]) {
      linkRefs.current[0].focus();
    }
  }, [loading, results]);

  const handleKeyDown = useCallback(
    (e: React.KeyboardEvent) => {
      const num = parseInt(e.key, 10);
      if (num >= 1 && num <= Math.min(9, results.length)) {
        e.preventDefault();
        const link = listRef.current?.querySelector(
          `li:nth-child(${num}) a`,
        ) as HTMLAnchorElement | null;
        link?.click();
        return;
      }

      const currentIndex = linkRefs.current.findIndex(
        (ref) => ref === document.activeElement,
      );
      if (currentIndex === -1) return;

      let nextIndex: number | null = null;
      switch (e.key) {
        case "ArrowDown":
          nextIndex =
            currentIndex < results.length - 1 ? currentIndex + 1 : 0;
          break;
        case "ArrowUp":
          nextIndex =
            currentIndex > 0 ? currentIndex - 1 : results.length - 1;
          break;
        case "Home":
          nextIndex = 0;
          break;
        case "End":
          nextIndex = results.length - 1;
          break;
      }

      if (nextIndex !== null) {
        e.preventDefault();
        linkRefs.current[nextIndex]?.focus();
      }
    },
    [results.length],
  );

  const handleWarmAudio = usePrefetch();

  if (loading) {
    return (
      <div role="status" aria-label="Loading search results">
        <ul className="list-none p-0 m-0" aria-label="Loading">
          {Array.from({ length: 4 }).map((_, i) => (
            <li
              key={i}
              className="garden-bed px-5 py-4"
              style={{ marginTop: i > 0 ? "8px" : 0 }}
            >
              <div
                className="skeleton h-[22px] w-[55%] mb-2"
              />
              <div
                className="skeleton h-[14px] w-[85%]"
              />
            </li>
          ))}
        </ul>
        <p className="sr-only">Loading search results...</p>
      </div>
    );
  }

  if (error) {
    return (
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
    );
  }

  if (results.length === 0) {
    return (
      <div
        className="garden-bed text-center py-12 px-6"
        role="status"
      >
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
        <p className="font-display font-semibold text-lg">
          No seeds found
        </p>
        <p className="text-muted text-sm mt-2">
          Try searching for a different topic.
        </p>
      </div>
    );
  }

  return (
    <div onKeyDown={handleKeyDown}>
      <p className="sr-only" aria-live="polite">
        {results.length} result{results.length !== 1 ? "s" : ""} found. Use
        up and down arrow keys to move between results, or press a number key
        1 through {Math.min(9, results.length)} to jump directly. Press Enter
        to open a result.
      </p>

      <ol
        ref={listRef}
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
            <div className="flex items-center gap-3 rounded-[14px] border border-border bg-surface-2 py-3.5 pl-[18px] pr-3 transition-all duration-150">
              <Link
                ref={(el) => {
                  linkRefs.current[index] = el;
                }}
                href={`/article/${encodeURIComponent(result.title.replace(/ /g, "_"))}`}
                className="result-link flex min-w-0 flex-1 items-center gap-4 no-underline"
                aria-label={`${index + 1}. ${result.title}: ${result.description}`}
                onClick={() => analytics.searchResultClicked()}
                onMouseEnter={() => handleWarmAudio(result.title)}
                onFocus={() => handleWarmAudio(result.title)}
              >
                <span
                  className="flex h-7 w-7 shrink-0 items-center justify-center rounded-lg bg-accent-bg font-mono text-xs font-bold text-accent"
                  aria-hidden="true"
                >
                  {index + 1}
                </span>

                <div className="min-w-0 flex-1">
                  <span className="block font-display text-base font-semibold text-foreground">
                    {result.title}
                  </span>
                  {result.description && (
                    <span className="mt-0.5 block text-[0.8125rem] leading-normal text-muted">
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
              </Link>
              <PlaylistActionButton
                slug={result.title.replace(/ /g, "_")}
                title={result.title}
              />
            </div>
          </li>
        ))}
      </ol>
    </div>
  );
};
