"use client";

import Link from "next/link";
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
      <Link
        href={`/article/${encodeURIComponent(entry.slug)}`}
        className="result-link block py-3 px-4 bg-surface-2 border border-border rounded-xl no-underline transition-all duration-200"
      >
        <span className="block font-semibold text-foreground text-[0.9375rem] leading-[1.4]">
          {entry.title}
        </span>
        <span className="flex items-center gap-2 mt-1 text-xs text-muted">
          <time dateTime={new Date(entry.lastVisitedAt).toISOString()}>{formatTimeAgo(entry.lastVisitedAt)}</time>
          {hasProgress && (
            <>
              <span aria-hidden="true" className="opacity-40">&middot;</span>
              <span>In progress</span>
            </>
          )}
        </span>
      </Link>
    </li>
  );
};

export const RecentlyListened = () => {
  const { entries } = useHistory();

  if (entries.length === 0) return null;

  const recent = entries.slice(0, 6);

  return (
    <section aria-labelledby="recently-listened-heading" className="mt-12">
      <h2
        id="recently-listened-heading"
        className="font-display font-semibold text-lg text-foreground mb-4 text-center"
      >
        Recently listened
      </h2>
      <ul
        className="list-none p-0 m-0 grid grid-cols-[repeat(auto-fill,minmax(220px,1fr))] gap-2.5"
        role="list"
      >
        {recent.map((entry) => (
          <HistoryItem key={entry.slug} entry={entry} />
        ))}
      </ul>
    </section>
  );
};
