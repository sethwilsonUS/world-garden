"use client";

import Link from "next/link";
import { useEffect, useState, useRef, useCallback } from "react";
import { useData } from "@/lib/data-context";
import { warmSummaryAudio } from "@/lib/audio-prefetch";

type SearchResult = {
  wikiPageId: string;
  title: string;
  description: string;
  url: string;
};

export const SearchResultsList = ({ term }: { term: string }) => {
  const { search: searchAction, fetchArticle } = useData();
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
        if (!cancelled) setLoading(false);
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

  const handleWarmAudio = useCallback(
    (title: string) => {
      const slug = title.replace(/ /g, "_");
      warmSummaryAudio(slug, fetchArticle);
    },
    [fetchArticle],
  );

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
            <Link
              ref={(el) => {
                linkRefs.current[index] = el;
              }}
              href={`/article/${encodeURIComponent(result.title.replace(/ /g, "_"))}`}
              className="result-link flex items-center gap-4 py-3.5 px-[18px] no-underline rounded-[14px] bg-surface-2 border border-border transition-all duration-150"
              aria-label={`${index + 1}. ${result.title}: ${result.description}`}
              onMouseEnter={() => handleWarmAudio(result.title)}
              onFocus={() => handleWarmAudio(result.title)}
            >
              <span
                className="flex items-center justify-center w-7 h-7 rounded-lg bg-accent-bg text-accent text-xs font-bold shrink-0 font-mono"
                aria-hidden="true"
              >
                {index + 1}
              </span>

              <div className="flex-1 min-w-0">
                <span className="block font-display font-semibold text-base text-foreground">
                  {result.title}
                </span>
                {result.description && (
                  <span className="block text-muted text-[0.8125rem] leading-normal mt-0.5">
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
                className="text-accent shrink-0 opacity-60"
              >
                <path d="M9 5l7 7-7 7" />
              </svg>
            </Link>
          </li>
        ))}
      </ol>
    </div>
  );
};
