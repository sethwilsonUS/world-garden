"use client";

import { useEffect } from "react";
import Link from "next/link";
import { analytics } from "@/lib/analytics";
import { ArticleLink } from "@/components/ArticleLink";
import { useBookmarks } from "@/hooks/useBookmarks";
import { getBookmarkListViewState } from "@/lib/bookmarks";

export default function LibraryPage() {
  const { entries, remove, isLoaded } = useBookmarks();
  const viewState = getBookmarkListViewState({
    isLoaded,
    entriesCount: entries.length,
  });

  useEffect(() => {
    analytics.libraryPageAccessed();
  }, []);

  return (
    <div className="container mx-auto px-4 pt-10 pb-20">
      <div className="max-w-3xl mx-auto">
        <nav aria-label="Back navigation" className="mb-5">
          <Link
            href="/"
            className="inline-flex min-h-[44px] items-center gap-1 text-muted text-sm no-underline"
          >
            <svg
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth={2}
              strokeLinecap="round"
              strokeLinejoin="round"
              width={14}
              height={14}
              aria-hidden="true"
            >
              <path d="M15 19l-7-7 7-7" />
            </svg>
            Back to home
          </Link>
        </nav>

        <section aria-labelledby="library-heading">
          <h1
            id="library-heading"
            className="type-page-title font-display text-[1.75rem] font-bold mb-6 text-foreground"
          >
            Library
          </h1>

          {viewState === "loading" ? (
            <div className="garden-bed text-center py-12 px-6" role="status">
              <div className="skeleton h-4 w-32 mx-auto" />
              <p className="font-display font-semibold text-lg text-foreground mt-4">
                Loading your Library
              </p>
              <p className="text-muted text-sm mt-2">
                Fetching your saved articles and any guest bookmarks ready for
                this account on this device.
              </p>
            </div>
          ) : viewState === "empty" ? (
            <div className="garden-bed text-center py-12 px-6" role="status">
              <svg
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                strokeWidth={1.5}
                strokeLinecap="round"
                strokeLinejoin="round"
                width={32}
                height={32}
                aria-hidden="true"
                className="text-muted mx-auto mb-4 block"
              >
                <path d="M19 21l-7-5-7 5V5a2 2 0 012-2h10a2 2 0 012 2z" />
              </svg>
              <p className="font-display font-semibold text-lg text-foreground">
                No saved articles yet
              </p>
              <p className="text-muted text-sm mt-2">
                Save articles while browsing and they&rsquo;ll appear here.
              </p>
              <Link
                href="/"
                className="btn-primary mt-5 inline-flex min-h-[44px] max-w-full flex-wrap px-6 py-2.5 text-center text-sm no-underline"
              >
                Start exploring
              </Link>
            </div>
          ) : (
            <ul className="list-none p-0 m-0" role="list">
              {entries.map((entry) => (
                <li key={entry.slug} className="mb-2">
                  <div className="result-link flex min-w-0 flex-wrap items-start justify-between gap-3 rounded-xl border border-border bg-surface-2 px-4 py-3.5 transition-all duration-200">
                    <ArticleLink
                      articleTitle={entry.title}
                      href={`/article/${encodeURIComponent(entry.slug)}`}
                      className="min-h-[44px] min-w-0 max-w-full flex-[1_1_240px] break-words no-underline [overflow-wrap:anywhere]"
                    >
                      <span className="block font-semibold text-foreground text-[0.9375rem] leading-[1.4]">
                        {entry.title}
                      </span>
                      <time
                        dateTime={
                          new Date(entry.savedAt).toISOString().split("T")[0]
                        }
                        className="block text-xs text-muted mt-0.5"
                      >
                        Saved{" "}
                        {new Date(entry.savedAt).toLocaleDateString(undefined, {
                          month: "short",
                          day: "numeric",
                          year: "numeric",
                        })}
                      </time>
                    </ArticleLink>
                    <button
                      onClick={() => remove(entry.slug)}
                      aria-label={`Remove ${entry.title} from your Library`}
                      className="linked-article-link inline-flex h-[44px] w-[44px] shrink-0 cursor-pointer items-center justify-center rounded-lg border border-border bg-transparent text-muted transition-colors duration-200"
                    >
                      <svg
                        viewBox="0 0 24 24"
                        fill="none"
                        stroke="currentColor"
                        strokeWidth={2}
                        strokeLinecap="round"
                        strokeLinejoin="round"
                        width={14}
                        height={14}
                        aria-hidden="true"
                      >
                        <line x1="18" y1="6" x2="6" y2="18" />
                        <line x1="6" y1="6" x2="18" y2="18" />
                      </svg>
                    </button>
                  </div>
                </li>
              ))}
            </ul>
          )}
        </section>
      </div>
    </div>
  );
}
