"use client";

import Link from "next/link";
import { ArticleLink } from "@/components/ArticleLink";
import { useHistory, type HistoryEntry } from "@/hooks/useHistory";

export const formatTimeAgo = (timestamp: number): string => {
  const seconds = Math.floor((Date.now() - timestamp) / 1000);
  if (seconds < 60) return "just now";
  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.floor(hours / 24);
  if (days === 1) return "yesterday";
  if (days < 7) return `${days}d ago`;
  return new Date(timestamp).toLocaleDateString(undefined, {
    month: "short",
    day: "numeric",
  });
};

const HistoryItem = ({ entry }: { entry: HistoryEntry }) => {
  const hasProgress = entry.lastSectionKey && entry.lastSectionKey !== "summary";
  return (
    <li>
      <ArticleLink
        articleTitle={entry.title}
        href={`/article/${encodeURIComponent(entry.slug)}`}
        className="result-link flex h-full min-h-11 flex-col justify-between rounded-xl border border-border bg-surface-2 px-4 py-3 no-underline transition-all duration-200"
      >
        <span className="line-clamp-2 block font-semibold leading-[1.4] text-foreground">
          {entry.title}
        </span>
        <span className="mt-1 flex flex-wrap items-center gap-x-2 text-sm text-muted">
          <time dateTime={new Date(entry.lastVisitedAt).toISOString()}>{formatTimeAgo(entry.lastVisitedAt)}</time>
          {hasProgress && (
            <>
              <span aria-hidden="true">&middot;</span>
              <span className="font-semibold text-accent">In progress</span>
            </>
          )}
        </span>
      </ArticleLink>
    </li>
  );
};

export const RecentlyOpened = () => {
  const { entries } = useHistory();

  if (entries.length === 0) return null;

  const recent = entries.slice(0, 4);

  return (
    <section aria-labelledby="recently-opened-heading" className="mt-12">
      <div className="mb-3 flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1">
        <h2
          id="recently-opened-heading"
          className="type-section-title-sm font-display font-semibold text-foreground"
        >
          Jump back in
        </h2>
        <Link
          href="/library"
          className="inline-flex min-h-11 items-center text-[0.9375rem] font-semibold text-accent no-underline hover:text-accent-hover"
        >
          Your Library
        </Link>
      </div>
      <ul
        className="m-0 grid list-none grid-cols-1 gap-3 p-0 sm:grid-cols-2 lg:grid-cols-4"
        role="list"
      >
        {recent.map((entry) => (
          <HistoryItem key={entry.slug} entry={entry} />
        ))}
      </ul>
    </section>
  );
};
