"use client";

import Link from "next/link";
import { useBookmarks } from "@/hooks/useBookmarks";

export default function LibraryPage() {
  const { entries, remove } = useBookmarks();

  return (
    <div className="container mx-auto px-4 pt-10 pb-20">
      <div className="max-w-3xl mx-auto">
        <nav aria-label="Back navigation" className="mb-5">
          <Link
            href="/"
            className="inline-flex items-center gap-1 text-muted text-sm no-underline"
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
            className="font-display text-[1.75rem] font-bold mb-6 text-foreground"
          >
            Reading list
          </h1>

          {entries.length === 0 ? (
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
                className="btn-primary inline-flex mt-5 py-2.5 px-6 text-sm no-underline"
              >
                Start exploring
              </Link>
            </div>
          ) : (
            <ul
              className="list-none p-0 m-0"
              role="list"
            >
              {entries.map((entry) => (
                <li
                  key={entry.slug}
                  className="mb-2"
                >
                  <div className="result-link flex items-center justify-between gap-3 py-3.5 px-4 bg-surface-2 border border-border rounded-xl transition-all duration-200">
                    <Link
                      href={`/article/${encodeURIComponent(entry.slug)}`}
                      className="flex-1 min-w-0 no-underline"
                    >
                      <span className="block font-semibold text-foreground text-[0.9375rem] leading-[1.4]">
                        {entry.title}
                      </span>
                      <time
                        dateTime={new Date(entry.savedAt).toISOString().split("T")[0]}
                        className="block text-xs text-muted mt-0.5"
                      >
                        Saved {new Date(entry.savedAt).toLocaleDateString(undefined, {
                          month: "short",
                          day: "numeric",
                          year: "numeric",
                        })}
                      </time>
                    </Link>
                    <button
                      onClick={() => remove(entry.slug)}
                      aria-label={`Remove ${entry.title} from reading list`}
                      className="linked-article-link inline-flex items-center justify-center w-8 h-8 shrink-0 bg-transparent border border-border rounded-lg cursor-pointer text-muted transition-colors duration-200"
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
